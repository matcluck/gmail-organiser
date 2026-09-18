// archive-by-sender.js — Archive all current-Inbox mail from one or more
// senders, by search + per-row checkbox + toolbar Archive click.
//
// Supersedes the "Select all via header checkbox" step documented in
// bulk-archive.md's Pattern A. That approach is BROKEN — see the gotcha
// below — and this file is the corrected, confirmed-working replacement.
// bulk-archive.md still documents the general pattern and DOM gotchas; this
// file is the reusable, requireable implementation of it.
//
// GOTCHA (confirmed 2026-08-17): `[role="main"] [aria-label="Select"]` is
// NOT a select-all checkbox. It's the split-button dropdown trigger next to
// one (`role="button" aria-haspopup="true"`, containing a decorative
// `role="checkbox"` icon that never reflects real selection state).
// Dispatching mousedown/mouseup/click on it opens the All/None/Read/Unread
// MENU — it does not select anything. Rows silently stay unselected, the
// Archive toolbar button never becomes visible (it only appears once at
// least one row is selected), and every downstream archive click fails with
// what looks like a timing/selector problem but isn't.
//
// FIX: skip the split-button. Each row has its OWN `[role="checkbox"]`
// (inside a `<tr class="zA">`) that DOES register a real click — clicking it
// sets `aria-checked="true"` and reveals the toolbar. Loop the rows and
// click each one's own checkbox. Fine at the batch sizes this is meant for
// (1-10 messages per sender); for a sender with more results than fit on
// one page, this file still only archives the visible page — extend with
// the "Select all N conversations that match this search" banner click if
// you need that.

async function archiveBySenders(page, senders) {
  if (!Array.isArray(senders) || senders.length === 0) {
    throw new Error('senders must be a non-empty array of email addresses');
  }

  const results = [];

  for (const sender of senders) {
    try {
      await page.evaluate((s) => {
        window.location.hash = `#search/from%3A${encodeURIComponent(s)}+in%3Ainbox`;
      }, sender);
      await page.waitForTimeout(900);
      await page.waitForFunction(() => [...document.querySelectorAll('table.F')].some((t) => t.offsetParent !== null), null, { timeout: 5000 }).catch(() => {});

      const rowCount = await page.evaluate(() => {
        const tbl = [...document.querySelectorAll('table.F')].find((t) => t.offsetParent !== null);
        if (!tbl) return -1;
        return [...tbl.querySelectorAll('tr.zA')].filter((r) => r.offsetParent !== null).length;
      });
      if (rowCount === -1) { results.push({ sender, ok: false, error: 'no table' }); continue; }
      if (rowCount === 0) { results.push({ sender, ok: true, count: 0, note: 'nothing to archive' }); continue; }

      await page.evaluate(() => {
        function dispatch(el, type) { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); }
        const tbl = [...document.querySelectorAll('table.F')].find((t) => t.offsetParent !== null);
        const rows = [...tbl.querySelectorAll('tr.zA')].filter((r) => r.offsetParent !== null);
        for (const row of rows) {
          const cb = row.querySelector('[role="checkbox"]');
          if (cb) ['mousedown', 'mouseup', 'click'].forEach((t) => dispatch(cb, t));
        }
      });
      await page.waitForTimeout(300);

      const archived = await page.evaluate(() => {
        function dispatch(el, type) { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })); }
        const archive = [...document.querySelectorAll('[data-tooltip="Archive"]')].find((el) => el.offsetParent !== null);
        if (!archive) return false;
        ['mousedown', 'mouseup', 'click'].forEach((t) => dispatch(archive, t));
        return true;
      });
      if (!archived) { results.push({ sender, ok: false, error: 'no archive button after select', rowCount }); continue; }
      await page.waitForTimeout(700);

      results.push({ sender, ok: true, count: rowCount });
    } catch (error) {
      results.push({ sender, ok: false, error: error.message });
    }
  }
  return results;
}

module.exports = { archiveBySenders };
