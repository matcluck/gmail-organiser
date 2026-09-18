// dump-inbox.js — One-call Gmail inbox row extraction (sender identity + subject).
//
// Fills a gap dump-state.js doesn't cover: DUMP_LABELS/DUMP_FILTERS only read the
// settings pages. When no Gmail connector is installed (common — check
// mcp list_connectors first), the inbox message list itself must be scraped from
// the DOM to get real sender addresses for filter criteria.
//
// Discovered 2026-08-14 (Chrome-extension javascript_tool runtime, a real mailbox):
// Gmail inbox rows carry a real `email` attribute on the sender span —
// `<span email="addr@example.com" name="Display Name">Display Name</span>`.
// This is a stable, semantic signal (like the `[act="s"]`/`[role="link"]` patterns
// in stable-selectors.md), NOT an obfuscated class name — prefer it over guessing
// `.zA`/`.bog`/`.y6` etc., which rotate between Gmail builds.
//
// USAGE (browser_evaluate / javascript_tool, page already on #inbox or any Gmail
// list/search view):
//   DUMP_INBOX_SENDERS()                         // every row currently in the DOM
//   DUMP_INBOX_SENDERS({ keywords: ['wyze'] })    // only rows whose sender/subject/
//                                                  // row text match (case-insensitive)
//
// TRUNCATION WARNING: large arrays returned through the tool-result pipeline have
// been observed to truncate at ~100 items regardless of how much real data exists
// (confirmed against a 145-message inbox / 231-filter / ~185-label account — see
// the matching note in dump-state.js). For inboxes bigger than ~100 visible rows,
// or once you have specific candidate senders in mind, ALWAYS pass `keywords` to
// stay comfortably under the cap. Don't rely on one unfiltered full-inbox dump.
//
// RECOMMENDED PATTERN (used successfully in the 2026-08-14 inbox audit):
//   1. `get_page_text` on #inbox for the cheap, already-reliable read: display
//      names, subjects, snippets, dates, and any existing label chips, for
//      everything currently rendered (Gmail's own text, no scraping needed).
//   2. Skim that for candidate senders (recurring automated mail, missing/odd
//      labels, mixed marketing+transactional senders).
//   3. Run DUMP_INBOX_SENDERS({ keywords: [...candidate names/domains...] }) ONCE
//      for just those candidates to get their real `from:` addresses.
//   4. Cross-reference against DUMP_FILTERS_MATCHING(keywords) (dump-state.js) to
//      see what's already covered before proposing anything.
//   5. Feed both into audit-inbox-gaps.mjs (references/diagnostics/) to compute
//      missing-base / missing-skip / keyword-gap candidates automatically instead
//      of eyeballing the cross-reference by hand.
//
// KNOWN LIMITATION: Gmail virtualizes the row list — only rows scrolled into (or
// near) the viewport exist in the DOM. A sender near the bottom of a long list can
// come back empty on the first try. Scroll the list (or narrow with a Gmail search
// query before dumping) and re-run if a known candidate is missing.

const DUMP_INBOX_SENDERS = `(opts) => {
  const { keywords = null, limit = 300 } = opts || {};
  const seen = new Set();
  const out = [];
  const spans = [...document.querySelectorAll('span[email]')];
  for (const el of spans) {
    if (out.length >= limit) break;
    const email = (el.getAttribute('email') || '').trim();
    const name = (el.getAttribute('name') || el.textContent || '').trim();
    if (!email) continue;
    const row = el.closest('tr');
    if (!row) continue;
    const rowText = row.textContent.replace(/\\s+/g, ' ').trim();
    if (keywords && keywords.length) {
      const hay = (email + ' ' + name + ' ' + rowText).toLowerCase();
      if (!keywords.some(k => hay.includes(String(k).toLowerCase()))) continue;
    }
    // Best-effort subject: row text minus the leading name/email noise. Good enough
    // to show a human a recognizable example; not parsed for filter criteria.
    const subject = rowText
      .replace(name, '')
      .trim()
      .slice(0, 120);
    const key = email + '|' + subject;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email, subject });
  }
  return out;
}`;

module.exports = { DUMP_INBOX_SENDERS };
