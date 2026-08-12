// dump-state.js — Single-call dumps of Gmail labels and filters as JSON.
//
// Lets the LLM read the entire current configuration in one round trip.
// Saves dozens of probes during audits.

// ─── DUMP_LABELS ────────────────────────────────────────────────────────────
// Navigate first: browser_navigate("https://mail.google.com/mail/u/0/#settings/labels")
// browser_wait_for(text="Create new label")
// Then: browser_evaluate(<DUMP_LABELS>, filename="labels.json")
//
// Returns: array of { name, conversationCount, parent, isUserLabel }
const DUMP_LABELS = `() => {
  const labels = [];
  const hierarchy = [];
  // Find all rows with both "remove" and "edit" links — these are user labels
  const rows = [...document.querySelectorAll('tr')].filter(tr => {
    const links = [...tr.querySelectorAll('[role="link"]')].map(l => l.textContent.trim());
    return links.includes('remove') && links.includes('edit');
  });
  const margins = [...new Set(rows.map(row => {
    const host = row.querySelector('td div[act="s"]');
    return Number.parseFloat(host?.style.marginLeft || '0') || 0;
  }))].sort((a, b) => a - b);
  for (const row of rows) {
    // Label name + count is in the first <td>
    const td = row.querySelector('td');
    if (!td) continue;
    const host = td.querySelector('div[act="s"]');
    const leaf = host?.textContent.trim();
    if (!leaf) continue;
    const margin = Number.parseFloat(host.style.marginLeft || '0') || 0;
    const level = Math.max(0, margins.indexOf(margin));
    hierarchy.length = level;
    const parent = level > 0 ? hierarchy[level - 1] || null : null;
    const name = parent ? parent + '/' + leaf : leaf;
    hierarchy[level] = name;
    const count = td.textContent.match(/(\\d+)\\s+conversations?/);
    labels.push({
      name,
      conversationCount: count ? Number(count[1]) : 0,
      leaf,
      parent,
    });
  }
  return labels.sort((a, b) => a.name.localeCompare(b.name));
}`;

// ─── DUMP_FILTERS ───────────────────────────────────────────────────────────
// Navigate: browser_navigate("https://mail.google.com/mail/u/0/#settings/filters")
// browser_wait_for(text="Create a new filter")
// Then: browser_evaluate(<DUMP_FILTERS>, filename="filters.json")
//
// Returns: array of { criteria: {from, to, subject, list, hasWords, raw}, actions: [...], label, skipInbox, markAsRead, neverSpam, delete, forward, star }
//
// Verified against a large filter and label set:
//   - from:(...) handles OR-joined multi-domain lists fine ("from:(@a.com OR @b.com)")
//   - subject:(...) parses cleanly when the subject contains no ')' (no nested-paren cases seen)
//   - list:(...) and bare list:value both extract into criteria.list
//   - actions seen: "Apply label \"...\"", "Skip Inbox", "Mark as read", "Never send it to Spam", "Forward to ...", "Star it", "Delete it"
//   - The "editdelete" trailing UI text is correctly stripped — no leaks into the last action
//
// Known limitation: criteriaRaw uses [^)]+ for from/to/subject extraction, so a filter
// whose subject literally contains a ')' would truncate.
const DUMP_FILTERS = `() => {
  const filters = [];
  const rows = [...document.querySelectorAll('tr')].filter(tr =>
    tr.textContent.includes('Matches:') && tr.textContent.includes('Do this:')
  );
  for (const row of rows) {
    const text = row.textContent;
    // Parse "Matches: <criteria>\\nDo this: <actions>"
    const m = text.match(/Matches:\\s*(.+?)\\s*Do this:\\s*(.+?)(?:\\s*editdelete)?$/s);
    if (!m) continue;
    const criteriaRaw = m[1].trim();
    const actionsRaw = m[2].trim();

    // Parse criteria parts
    const criteria = { raw: criteriaRaw };
    const fromM = criteriaRaw.match(/from:\\(([^)]+)\\)/);
    if (fromM) criteria.from = fromM[1];
    const toM = criteriaRaw.match(/to:\\(([^)]+)\\)/);
    if (toM) criteria.to = toM[1];
    const subjM = criteriaRaw.match(/subject:\\(([^)]+)\\)/);
    if (subjM) criteria.subject = subjM[1];
    // list: operator — both wrapped "list:(domain)" and bare "list:domain" forms
    const listM = criteriaRaw.match(/list:\\(([^)]+)\\)/) || criteriaRaw.match(/list:(\\S+)/);
    if (listM) criteria.list = listM[1];
    // Quoted phrases not inside from:/to:/subject: are "has words"
    const quotes = [...criteriaRaw.matchAll(/"([^"]+)"/g)].map(m => m[1])
      .filter(q => !criteriaRaw.includes('from:(' + q) && !criteriaRaw.includes('to:(' + q) && !criteriaRaw.includes('subject:(' + q));
    if (quotes.length) criteria.hasWords = quotes;

    // Parse actions (comma-separated)
    const actions = actionsRaw.split(/,\\s*/).map(a => a.trim()).filter(Boolean);
    const labelM = actions.find(a => a.startsWith('Apply label'));
    const label = labelM?.match(/Apply label "([^"]+)"/)?.[1];

    filters.push({
      criteria,
      actions,
      label,
      skipInbox: actions.some(a => a === 'Skip Inbox'),
      markAsRead: actions.some(a => a === 'Mark as read'),
      neverSpam: actions.some(a => a.includes('Never send')),
      delete: actions.some(a => a === 'Delete it'),
      forward: actions.some(a => a.startsWith('Forward')),
      star: actions.some(a => a === 'Star it'),
    });
  }
  return filters;
}`;

// ─── DUMP_BOTH ──────────────────────────────────────────────────────────────
// Two navigations + two evaluates. Use when starting any audit:
//
//   browser_navigate(labels URL); browser_wait_for("Create new label")
//   labels = browser_evaluate(DUMP_LABELS, filename="labels.json")
//   browser_navigate(filters URL); browser_wait_for("Create a new filter")
//   filters = browser_evaluate(DUMP_FILTERS, filename="filters.json")
//
// Then read the two JSON files. The LLM has the full config in one cheap pass.

module.exports = { DUMP_LABELS, DUMP_FILTERS };
