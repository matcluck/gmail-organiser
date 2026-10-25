// gmail-dom.js - the ONE implementation of everything this skill does inside a
// Gmail page. Pure browser JavaScript: no Playwright, no MCP, no tool-specific
// assumptions. Every driver injects this same file and calls the same API, so
// the DOM knowledge lives in exactly one place and a gotcha fixed once is fixed
// for every agent and for the CLI.
//
//   drivers/playwright.js   Playwright / CDP  (what cli/gmail-cli.js uses)
//   drivers/extension.md    any agent with a "run JS in the page" tool
//   drivers/README.md       the driver contract, including the real-click loop
//
// It is also a CommonJS module: require() it to get source() (the text to
// inject) and pure (the DOM-free helpers, which is what the tests cover).
//
// == THE REAL-CLICK CONTRACT ===============================================
// Gmail's filter dialog ignores untrusted events. Confirmed 2026-09-19 against
// the live dialog, three ways, all no-ops:
//   - dispatching mousedown/mouseup/click on the row's <label>
//   - label.click()  (native activation on the label)
//   - input.click()  (native activation on the backing checkbox)
// The same is true of the Create/Update filter button and of the options in the
// label dropdown. Everything else on the page - opening the panel, the message
// list's own row checkboxes, the Archive toolbar button - DOES accept synthetic
// events, which is why the archive pass runs entirely in here.
//
// So this file does not pretend it can tick a box. It hands the driver a PLAN:
//     { ok: true, clicks: [{ x, y, what }, ...], then: 'verify' }
// The driver performs those clicks for real, in order, then calls back. Loop:
//     plan = await GmailDom.createFilter(spec)
//     while (plan.clicks) { for (c of plan.clicks) realClick(c.x, c.y);
//                           plan = await GmailDom.advance(); }
// Coordinates come back in the frame declared by setFrame(), so a driver with a
// scaled screenshot frame does not have to convert anything.
//
// == DOM FACTS ENCODED HERE (each one cost a real debugging session) ========
//  1. The action panel does NOT render from the #create-filter hash alone. The
//     hash fills the search form; the panel appears only after the "Advanced
//     search options" button and then the form's "Create filter" control are
//     clicked. Those two DO accept synthetic events.
//  2. The panel's checkboxes are NOT [role=checkbox] and NOT visible inputs.
//     Each row is a <label class="aD"> whose `for` points at a 1x1 off-screen
//     <input class="btj" type="checkbox">. READ STATE FROM THAT INPUT'S
//     .checked. The class "aeD" on the label is focus styling, NOT ticked - an
//     earlier version of this file read "aeD" and cheerfully reported the wrong
//     state for every row, which is the worst kind of bug because the verify
//     step then agrees with itself.
//  3. The clickable control sits at the LABEL'S LEFT EDGE, not its centre: the
//     label box starts at the checkbox and runs to the end of the text, so a
//     centre-point click lands harmlessly in the words.
//  4. Gmail's save is slow and navigating mid-save silently drops it. A closed
//     dialog is never proof - commit() re-reads the saved row and returns it.
//  5. Editing a label's name and its parent in one Save silently no-ops when
//     the resulting path equals the label's current flat name (see
//     labels/move-label.js for the two-save workaround).
//  6. [role="main"] [aria-label="Select"] is a split-button menu trigger, not a
//     select-all checkbox. Selection goes through each row's own checkbox.
//  7. "Also apply filter to N matching conversations" renders without a count
//     and refuses to tick when N is 0. Treat a failure to tick it as "nothing
//     matched", not as an error, and archive the stragglers separately.

'use strict';

// -- pure helpers (no DOM - these are what cli/test covers) -----------------

const ROW_ORDER = [
  'Skip the Inbox', 'Mark as read', 'Star it', 'Apply the label', 'Forward it to',
  'Delete it', 'Never send it to Spam', 'Always mark it as important',
  'Never mark it as important', 'Categorize as', 'Also apply filter',
];

// Enforces the skill's rule contract before anything touches the page.
function normalizeSpec(spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, error: 'spec must be an object' };
  if (!spec.from && !spec.list) return { ok: false, error: 'spec needs from or list' };
  if (typeof spec.skipInbox !== 'boolean') return { ok: false, error: 'spec.skipInbox must be an explicit boolean' };
  if (spec.label && spec.skipInbox) return { ok: false, error: 'a skip rule must not apply a label - the contract splits those into two filters' };
  if (!spec.label && !spec.skipInbox) return { ok: false, error: 'spec does nothing: give it a label or skipInbox' };
  if (spec.markAsRead) return { ok: false, error: 'markAsRead is never allowed by the rule contract' };
  if (spec.delete) return { ok: false, error: 'delete is never allowed by the rule contract' };
  return {
    ok: true,
    spec: {
      from: spec.from || null,
      list: spec.list || null,
      to: spec.to || null,
      subject: spec.subject || null,
      hasWords: spec.hasWords || null,
      doesntHave: spec.doesntHave || null,
      label: spec.label || null,
      skipInbox: spec.skipInbox,
      neverSpam: spec.neverSpam !== false,
      alsoApplyToExisting: !!spec.alsoApplyToExisting,
    },
  };
}

function criteriaHash(spec) {
  const p = [];
  if (spec.from) p.push('from=' + encodeURIComponent(spec.from));
  if (spec.to) p.push('to=' + encodeURIComponent(spec.to));
  if (spec.subject) p.push('subject=' + encodeURIComponent(spec.subject));
  const words = [spec.hasWords, spec.list ? 'list:' + spec.list : null].filter(Boolean).join(' ');
  if (words) p.push('has=' + encodeURIComponent(words));
  if (spec.doesntHave) p.push('hasnot=' + encodeURIComponent(spec.doesntHave));
  return '#create-filter/' + p.join('&');
}

function parseFilterRow(text) {
  const t = String(text).replace(/\s+/g, ' ').replace(/editdelete$/, '').trim();
  const m = t.match(/Matches:\s*(.+?)\s*Do this:\s*(.+?)$/);
  if (!m) return null;
  const actions = m[2].split(/,\s*/).map((a) => a.trim()).filter(Boolean);
  const label = (actions.find((a) => a.startsWith('Apply label')) || '').match(/Apply label "([^"]+)"/);
  return {
    criteria: m[1].trim(),
    actions,
    label: label ? label[1] : null,
    skipInbox: actions.includes('Skip Inbox'),
    markAsRead: actions.includes('Mark as read'),
    neverSpam: actions.some((a) => a.includes('Never send')),
  };
}

// Does a persisted row satisfy the spec that asked for it? Used by commit() so
// "the dialog closed" is never mistaken for "the filter saved".
function rowMatchesSpec(row, spec) {
  if (!row) return false;
  const c = row.criteria.toLowerCase();
  const needle = (spec.from || spec.list || '').toLowerCase();
  if (needle && !c.includes(needle)) return false;
  if (spec.hasWords && !c.includes(String(spec.hasWords).replace(/"/g, '').toLowerCase())) return false;
  if (spec.subject && !c.includes(String(spec.subject).replace(/"/g, '').toLowerCase())) return false;
  if (spec.label && row.label !== spec.label) return false;
  if (spec.skipInbox !== row.skipInbox) return false;
  if (row.markAsRead) return false;
  return true;
}

// Which rows a spec needs ticked, in the order the dialog shows them.
function wantedActions(spec) {
  const want = [];
  if (spec.skipInbox) want.push('Skip the Inbox');
  if (spec.label) want.push('Apply the label');
  if (spec.neverSpam) want.push('Never send it to Spam');
  if (spec.alsoApplyToExisting) want.push('Also apply filter');
  return want;
}

// -- the browser-side API ---------------------------------------------------

const VERSION = 4;

function installGmailDom() {
  if (typeof window === 'undefined') throw new Error('installGmailDom needs a browser context');
  if (window.GmailDom && window.GmailDom.version === VERSION) return window.GmailDom;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.offsetParent !== null;
  const fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  const click = (el) => ['mousedown', 'mouseup', 'click'].forEach((t) => fire(el, t));
  const all = (sel, root) => [...(root || document).querySelectorAll(sel)].filter(visible);

  let FRAME = null;
  let STATE = null;   // { spec, stage }

  const scale = () => ({
    sx: FRAME ? FRAME.w / window.innerWidth : 1,
    sy: FRAME ? FRAME.h / window.innerHeight : 1,
  });
  // Fact 3: hit the label's left edge, never its centre.
  const hitPoint = (el, edge) => {
    const r = el.getBoundingClientRect();
    const { sx, sy } = scale();
    const x = edge ? r.x + 7 : r.x + r.width / 2;
    return { x: Math.round(x * sx), y: Math.round((r.y + r.height / 2) * sy) };
  };

  const panelRoot = () => all('div.ZZ').find((el) => el.textContent.includes('When a message is an exact match'));

  // Fact 2: state comes from the backing input, never from the label's classes.
  function actionRows() {
    const root = panelRoot();
    if (!root) return [];
    const inputs = new Map([...root.querySelectorAll('input.btj[type=checkbox]')].map((i) => [i.id, i]));
    return all('label.aD', root).map((label, i) => {
      const input = inputs.get(label.getAttribute('for'));
      return {
        label,
        input: input || null,
        index: i,
        text: label.textContent.replace(/\s+/g, ' ').trim() || ROW_ORDER[i] || '',
        rowText: ((label.parentElement && label.parentElement.textContent) || '').replace(/\s+/g, ' ').trim(),
        ticked: input ? input.checked : null,
      };
    });
  }

  const findRow = (text) => {
    const rows = actionRows();
    const want = text.toLowerCase();
    return rows.find((r) => r.text.toLowerCase().startsWith(want)) ||
      rows[ROW_ORDER.findIndex((t) => t.toLowerCase() === want)] || null;
  };

  async function openPanel(spec) {
    window.location.hash = criteriaHash(spec);
    await sleep(1400);
    const advanced = all('button, [role="button"]').find((e) => (e.getAttribute('aria-label') || '').includes('search options'));
    if (advanced) { click(advanced); await sleep(800); }
    if (!panelRoot()) {                                   // fact 1
      const next = all('div[role="button"], button, [role="link"]').find((e) => e.textContent.trim() === 'Create filter');
      if (!next) return false;
      click(next);
      await sleep(1500);
    }
    return !!panelRoot();
  }

  // The points the driver must click for every not-yet-ticked row this spec
  // needs. The label row is handled separately (it opens a dropdown).
  function checkboxPlan(spec) {
    const clicks = [];
    for (const want of wantedActions(spec)) {
      if (want === 'Apply the label') continue;
      const row = findRow(want);
      if (!row) continue;
      if (row.ticked === false) clicks.push(Object.assign(hitPoint(row.label, true), { what: want }));
    }
    return clicks;
  }

  const api = {
    version: VERSION,
    setFrame(f) { FRAME = f && f.w && f.h ? { w: f.w, h: f.h } : null; return FRAME; },
    panelOpen: () => !!panelRoot(),
    actions: () => actionRows().map(({ text, ticked, index }) => ({ text, ticked, index })),

    // reads ---------------------------------------------------------------
    filterRows() {
      return [...document.querySelectorAll('tr')]
        .filter((tr) => tr.textContent.includes('Matches:') && tr.textContent.includes('Do this:'))
        .map((tr) => parseFilterRow(tr.textContent))
        .filter(Boolean);
    },
    dumpFilters(keywords) {
      const rows = api.filterRows();
      if (!keywords || !keywords.length) return rows;
      const kw = keywords.map((k) => String(k).toLowerCase());
      return rows.filter((r) => kw.some((k) => (r.criteria + ' ' + r.actions.join(' ')).toLowerCase().includes(k)));
    },
    dumpLabels(keywords) {
      const kw = (keywords || []).map((k) => String(k).toLowerCase());
      const out = [];
      for (const tr of document.querySelectorAll('tr')) {
        const links = [...tr.querySelectorAll('[role="link"]')].map((l) => l.textContent.trim());
        if (!links.includes('remove') || !links.includes('edit')) continue;
        const host = tr.querySelector('td div[act="s"]');
        const leaf = host && host.textContent.trim();
        if (!leaf) continue;
        if (kw.length && !kw.some((k) => leaf.toLowerCase().includes(k))) continue;
        out.push(leaf);
      }
      return out;
    },
    senders() {
      const tbl = all('table.F')[0];
      if (!tbl) return { error: 'no message table - open #inbox or a search first' };
      const counts = {};
      for (const row of all('tr.zA', tbl)) {
        const el = row.querySelector('[email]');
        const s = el ? el.getAttribute('email') : '?';
        counts[s] = (counts[s] || 0) + 1;
      }
      return counts;
    },

    // filter authoring: plan -> driver clicks -> advance() -> ... -----------
    async createFilter(rawSpec) {
      const norm = normalizeSpec(rawSpec);
      if (!norm.ok) return norm;
      const spec = norm.spec;
      if (!(await openPanel(spec))) return { ok: false, error: 'action panel did not open' };
      STATE = { spec, stage: 'checkboxes' };
      return { ok: true, stage: 'checkboxes', clicks: checkboxPlan(spec), then: 'advance' };
    },

    // Call after performing the clicks the last result asked for. Verifies what
    // actually landed before moving on, so a missed click is reported instead
    // of silently saved as the wrong rule.
    async advance() {
      if (!STATE) return { ok: false, error: 'nothing in progress - call createFilter first' };
      const { spec } = STATE;

      if (STATE.stage === 'checkboxes') {
        const missed = [];
        for (const want of wantedActions(spec)) {
          if (want === 'Apply the label') continue;
          const row = findRow(want);
          // fact 7: a zero-match "also apply" row refuses to tick; not an error
          if (want === 'Also apply filter' && row && !/\d/.test(row.rowText)) continue;
          if (row && row.ticked === false) missed.push(want);
        }
        if (missed.length) return { ok: false, error: 'these did not tick: ' + missed.join(', '), clicks: checkboxPlan(spec), then: 'advance', actions: api.actions() };
        if (spec.label) {
          const chooser = all('div, span', panelRoot()).find((e) => e.textContent.trim().startsWith('Choose label') && e.children.length <= 1);
          if (!chooser) return { ok: false, error: 'label chooser not found' };
          click(chooser);                                   // opens fine synthetically
          await sleep(800);
          const option = all('[role="menuitem"], [role="option"], div.J-N').find((e) => e.textContent.trim() === spec.label);
          if (!option) return { ok: false, error: 'label "' + spec.label + '" is not in the picker - create it, hard-reload Gmail, retry' };
          option.scrollIntoView({ block: 'center' });
          STATE.stage = 'label';
          return { ok: true, stage: 'label', clicks: [Object.assign(hitPoint(option), { what: 'label option "' + spec.label + '"' })], then: 'advance' };
        }
        STATE.stage = 'commit';
        return api.advance();
      }

      if (STATE.stage === 'label') {
        const row = findRow('Apply the label');
        if (!row || row.ticked !== true) return { ok: false, error: 'the label click missed - re-run createFilter for a fresh point' };
        STATE.stage = 'commit';
        return api.advance();
      }

      if (STATE.stage === 'commit') {
        const btn = all('div[role="button"], button').find((e) => ['Create filter', 'Update filter'].includes(e.textContent.trim()));
        if (!btn) return { ok: false, error: 'no Create/Update button - the panel closed before commit' };
        STATE.stage = 'saved';
        return { ok: true, stage: 'commit', clicks: [Object.assign(hitPoint(btn), { what: btn.textContent.trim() })], then: 'confirm' };
      }

      return { ok: false, error: 'unexpected stage ' + STATE.stage };
    },

    // Call after clicking the Create/Update button. Fact 4: re-read, don't trust.
    async confirm() {
      if (!STATE) return { ok: false, error: 'nothing in progress' };
      const { spec } = STATE;
      STATE = null;
      await sleep(2000);
      window.location.hash = '#settings/filters';
      await sleep(2500);
      const rows = api.filterRows();
      const saved = rows.filter((r) => rowMatchesSpec(r, spec));
      return {
        ok: saved.length > 0,
        totalFilters: rows.length,
        saved: saved.map((r) => r.criteria + ' => ' + r.actions.join(', ')),
        error: saved.length ? undefined : 'no persisted row matches the spec - the save did not land',
      };
    },

    // cleanup: fully synthetic, no driver clicks needed ---------------------
    async archiveSearch(query) {                           // fact 6
      window.location.hash = '#search/' + encodeURIComponent(query);
      await sleep(3000);
      const tbl = all('table.F')[0];
      if (!tbl) return { ok: false, error: 'no message table' };
      const rows = all('tr.zA', tbl);
      if (!rows.length) return { ok: true, archived: 0, left: 0, note: 'nothing to archive' };
      const senders = api.senders();
      for (const row of rows) {
        const cb = row.querySelector('[role="checkbox"]');
        if (cb) click(cb);
      }
      await sleep(500);
      const checked = all('tr.zA [role="checkbox"]', tbl).filter((c) => c.getAttribute('aria-checked') === 'true').length;
      if (!checked) return { ok: false, error: 'nothing selected - did the split-button menu open instead?' };
      const archive = all('[data-tooltip="Archive"]')[0];
      if (!archive) return { ok: false, error: 'Archive button not visible after selecting' };
      click(archive);
      await sleep(2500);
      const left = all('tr.zA', all('table.F')[0] || document).length;
      return { ok: true, archived: checked, left, senders };
    },
  };

  window.GmailDom = api;
  return api;
}

if (typeof window !== 'undefined') installGmailDom();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VERSION,
    installGmailDom,
    // The exact text a driver injects. One file, one implementation.
    source: () => require('fs').readFileSync(__filename, 'utf8'),
    pure: { ROW_ORDER, normalizeSpec, criteriaHash, parseFilterRow, rowMatchesSpec, wantedActions },
  };
}
