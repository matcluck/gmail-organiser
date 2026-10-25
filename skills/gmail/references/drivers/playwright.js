// drivers/playwright.js — Playwright/CDP driver for ../core/gmail-dom.js.
//
// It injects the core file's own text into the page and forwards calls. The
// only thing it adds is the one capability the DOM cannot provide: a REAL
// mouse click, used to satisfy `needsRealClick` (see drivers/README.md).
//
//   const { attach } = require('./drivers/playwright');
//   const gmail = await attach(page);
//   await gmail.createFilter({ from: 'news@example.com', label: 'Subscriptions/Example', skipInbox: false });
//   await gmail.createFilter({ from: 'news@example.com', skipInbox: true });
//
// createFilter() here is the COMPLETE operation: it drives the real-click loop
// itself, so a caller never has to know the loop exists.

const path = require('path');
const core = require(path.join(__dirname, '..', 'core', 'gmail-dom.js'));

const SOURCE = core.source();

async function inject(page) {
  // Re-injecting is a no-op inside the core (version check), so this is safe to
  // call before every operation — Gmail is an SPA, but a full reload wipes it.
  await page.evaluate(SOURCE);
  return page.evaluate(() => !!window.GmailDom && window.GmailDom.version);
}

async function attach(page, opts = {}) {
  await inject(page);
  // Playwright clicks in CSS pixels, which is the core's default frame.
  await page.evaluate(() => window.GmailDom.setFrame(null));

  const callRaw = async (fn, ...args) => {
    await inject(page);
    return page.evaluate(([f, a]) => window.GmailDom[f](...a), [fn, args]);
  };

  // Drives the real-click loop so callers don't have to.
  const resolveClicks = async (result, budget = 3) => {
    let out = result;
    for (let i = 0; i < budget && out && out.needsRealClick; i++) {
      const { x, y, what } = out.needsRealClick;
      if (opts.verbose) console.error(`[driver] real click for ${what} at ${x},${y}`);
      await page.mouse.click(x, y);
      await page.waitForTimeout(400);
      out = await callRaw('resume');
    }
    if (out && out.needsRealClick) return { ok: false, error: 'real-click loop did not settle', last: out };
    return out;
  };

  return {
    page,
    inject: () => inject(page),
    raw: callRaw,

    dumpFilters: (keywords) => callRaw('dumpFilters', keywords),
    dumpLabels: (keywords) => callRaw('dumpLabels', keywords),
    senders: () => callRaw('senders'),
    actions: () => callRaw('actions'),

    // One call per filter, real-click loop included. Returns the persisted row.
    createFilter: async (spec) => resolveClicks(await callRaw('createFilter', spec)),

    // Specs are applied in order, so a sender's base/tag spec must come before
    // its skip specs — same ordering rule as the Playwright batch helpers.
    createFilters: async (specs) => {
      const results = [];
      for (const spec of specs) {
        const r = await resolveClicks(await callRaw('createFilter', spec));
        results.push({ spec, ...r });
        if (!r.ok && opts.stopOnError !== false) break;
      }
      return results;
    },

    // Repeats until the search is empty or `maxPages` is hit, because one pass
    // only archives the rows Gmail has rendered.
    archiveSearch: async (query, maxPages = 10) => {
      let archived = 0;
      const pages = [];
      for (let i = 0; i < maxPages; i++) {
        const r = await callRaw('archiveSearch', query);
        pages.push(r);
        if (!r.ok) return { ok: false, archived, pages };
        archived += r.archived || 0;
        if (!r.archived || !r.left) break;
      }
      return { ok: true, archived, pages };
    },
  };
}

module.exports = { attach, inject, SOURCE };
