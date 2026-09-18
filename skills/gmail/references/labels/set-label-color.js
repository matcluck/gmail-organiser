// Navigate to inbox first. The label sidebar has hidden menu buttons that appear on hover.
//
// GOTCHAS:
// - div.pM has aria-hidden="true" and zero size — scroll the parent .TN via page.evaluate()
// - CSS.escape() is NOT available in Playwright's Node context — use XPath selectors
// - JS .click() doesn't trigger Gmail's jsaction system — must use Playwright's hover()+click()
// - "Label color" is a submenu — HOVER to open it, don't click
// - Color gridcells have accessible names like "RGB (251, 76, 47)" — visible text is just "a"
// - Parent labels with children trigger a dialog — use page.getByRole('radio', ...) at page level
//
// Gmail preset colors (24 total, 4x6 grid):
// Row 1: (251,76,47)  (255,117,55) (255,173,70) (251,233,131) (66,214,146)  (22,167,101)
// Row 2: (179,239,211)(162,220,193)(152,215,228)(45,162,187)  (73,134,231)  (182,207,245)
// Row 3: (185,154,255)(227,215,255)(246,145,178)(251,211,224) (242,178,168) (255,200,175)
// Row 4: (255,222,181)(235,219,222)(204,166,172)(194,194,194) (231,231,231) (253,237,193)
//
// GOTCHA (confirmed 2026-08-17): the two swatches above marked (73,134,231)
// blue and (185,154,255) purple DO NOT reliably exist under those exact RGB
// strings — clicking `getByRole('gridcell', { name: 'RGB (73, 134, 231)' })`
// timed out every time, including after a full page.reload(). The real,
// clickable blue swatch's aria-label is "RGB (74, 134, 232)" — off by one in
// every channel from the documented value — and no purple matching anything
// close to (185,154,255) was present in this account's grid at all; a usable
// purple was "RGB (120, 88, 195)" from a wider ~29-swatch set the grid
// actually rendered (includes darker/more saturated extras beyond the basic
// 24: (30,83,184), (0,114,134), (120,88,195), (194,24,91), (217,48,37),
// (102,102,102), plus a couple of near-duplicate rounding variants). Do not
// trust hardcoded RGB triples from this comment block for anything other
// than a starting guess — always confirm by querying the live grid:
//   const cells = page.getByRole('gridcell');
//   const names = await cells.evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
// then click by the exact string found, not by a value typed from memory.
//
// GOTCHA (confirmed 2026-08-17): if a `setLabelColor` call throws (e.g. the
// gridcell click times out) WITHOUT reaching the end of the function, the
// label's right-click/3-dot context menu and the "Label color" submenu are
// left open. The next call's "hover the TN row to reveal menu button" step
// then opens a SECOND menu stacked on top of the still-open first one, and
// role-based locators like `getByRole('menuitem', { name: 'Label color' })`
// become ambiguous or resolve to a hidden/wrong-layer element — surfacing as
// confusing "element is not visible" errors on steps that worked moments
// earlier. Before every retry (and at the start of any batch), close stale
// state defensively: `await page.keyboard.press('Escape')` twice, then click
// a neutral point off any menu (e.g. `page.mouse.click(400, 5)`), before
// touching the target label again. A `page.reload()` also works but is
// slower and shouldn't be needed if the Escape+neutral-click reset runs
// before each attempt rather than only after a failure.
//
// GOTCHA (confirmed 2026-08-17): for a label that already has sublabels,
// clicking a color swatch does NOT apply immediately — it opens a SECOND,
// separate `[role="alertdialog"]` titled "Changing color on multiple
// labels" with two radios: `Only label "X"` and `Label "X" and its
// sublabels` (plus Cancel / "Set color" buttons). This dialog can take
// longer than the ~800ms this file's original `setLabelColor` waits before
// checking `dialog.isVisible()` — poll for it (e.g. up to 10x 300ms) rather
// than checking once. The radio elements have NO aria-label (both come back
// null) — match by the associated `<label for=...>` text instead:
//   const labelText = await radio.evaluate(el => {
//     const lbl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
//     return lbl ? lbl.textContent : null;
//   });
// If you're recoloring a parent with already-distinctly-colored children
// (e.g. a rainbow tree), you almost always want "Only label" — the
// sublabels option overwrites EVERY child to the same single color with no
// further confirmation.
//
// PATTERN: "one color, whole tree inherits" (confirmed working 2026-08-17).
// This is the common case — pick one swatch for the parent, every child
// (regardless of how many, regardless of their current colors) matches it
// in a single Save. No per-child looping needed at all.
async function setLabelColorCascadeToSublabels(page, parentLabelName, rgb) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.mouse.click(400, 5); // drop focus off any stale menu — see gotcha above
  await page.waitForTimeout(200);

  await page.evaluate((name) => {
    const btns = document.querySelectorAll('div.pM');
    for (const btn of btns) {
      if (btn.getAttribute('data-label-name') === name) {
        btn.closest('.TN').scrollIntoView({ block: 'center' });
        break;
      }
    }
  }, parentLabelName);
  await page.waitForTimeout(400);

  const menuBtn = page.locator(`//div[contains(@class,"pM")][@data-label-name="${parentLabelName}"]`);
  const tnDiv = menuBtn.locator('xpath=ancestor::div[contains(@class,"TN")][1]').first();
  await tnDiv.hover({ force: true, timeout: 3000 });
  await page.waitForTimeout(400);
  await menuBtn.click({ force: true, timeout: 3000 });
  await page.waitForTimeout(700);

  const lcItem = page.locator(`xpath=//div[@role="menuitem" and contains(., "Label color")]`).first();
  await lcItem.hover({ force: true, timeout: 3000 });
  await page.waitForTimeout(700);

  const cell = page.getByRole('gridcell', { name: `RGB (${rgb})` }).first();
  await cell.click({ force: true, timeout: 5000 });

  // The "Changing color on multiple labels" dialog only appears for a
  // parent that HAS children, and can take longer than a flat ~800ms wait —
  // poll for it instead of checking once.
  let dialogVisible = false;
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    dialogVisible = await page.locator('[role="alertdialog"]').isVisible().catch(() => false);
    if (dialogVisible) break;
  }
  if (!dialogVisible) return; // childless label — color already applied directly, nothing more to do

  const radios = page.getByRole('radio');
  const count = await radios.count();
  let picked = false;
  for (let i = 0; i < count; i++) {
    const r = radios.nth(i);
    const labelText = await r.evaluate(el => {
      const id = el.id;
      const lbl = id ? document.querySelector(`label[for="${id}"]`) : null;
      return lbl ? lbl.textContent : null; // radios have no aria-label — match the <label for=...>
    });
    if (labelText === `Label "${parentLabelName}" and its sublabels`) {
      await r.click();
      picked = true;
      break;
    }
  }
  if (!picked) throw new Error(`sublabels radio not found for "${parentLabelName}"`);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Set color' }).click();
  await page.waitForTimeout(1200);
}

async function setLabelColor(page, labelName, rgb) {
  // Step 1: Scroll label into view
  await page.evaluate((name) => {
    const btns = document.querySelectorAll('div.pM');
    for (const btn of btns) {
      if (btn.getAttribute('data-label-name') === name) {
        btn.closest('.TN').scrollIntoView({ block: 'center' });
        break;
      }
    }
  }, labelName);
  await page.waitForTimeout(300);

  // Step 2: Hover the TN row to reveal menu button (use xpath for data-label-name)
  const menuBtn = page.locator(`//div[contains(@class,"pM")][@data-label-name="${labelName}"]`);
  const tnDiv = menuBtn.locator('xpath=ancestor::div[contains(@class,"TN")][1]').first();
  await tnDiv.hover({ force: true, timeout: 3000 });
  await page.waitForTimeout(300);

  // Step 3: Click menu button
  await menuBtn.click({ force: true, timeout: 3000 });
  await page.waitForTimeout(500);

  // Step 4: HOVER "Label color" (it's a submenu — must hover, NOT click)
  const lcItem = page.locator(`xpath=//div[@role="menuitem" and contains(., "Label color")]`).last();
  await lcItem.hover({ force: true, timeout: 3000 });
  await page.waitForTimeout(500);

  // Step 5: Click color cell
  const cell = page.getByRole('gridcell', { name: `RGB (${rgb})` }).first();
  await cell.click({ force: true, timeout: 3000 });
  await page.waitForTimeout(800);

  // Step 6: Handle sublabels dialog (appears for parent labels with children)
  const dialog = page.locator('[role="alertdialog"]');
  if (await dialog.isVisible().catch(() => false)) {
    await page.getByRole('radio', { name: `Label "${labelName}" and its` }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Set color' }).click();
    await page.waitForTimeout(800);
  }
}

// Fast batch path for Codex sessions where Playwright MCP lacks a one-call
// code runner but Chromium is available on a remote debugging port.
//
// Usage:
//   1. Start Chromium with --remote-debugging-port=9222 using the normal profile.
//   2. Run:
//      npx -y -p playwright node - <<'NODE'
//      const { chromium } = require('playwright');
//      const { setLabelColorsOverCDP } = require('/abs/path/to/set-label-color.js');
//      (async () => {
//        const result = await setLabelColorsOverCDP({
//          cdpUrl: 'http://127.0.0.1:9222',
//          updates: [
//            { labelName: 'Security', rgb: '251, 76, 47' },
//            { labelName: 'Finance/Example Bank', rgb: '22, 167, 101' },
//          ],
//        });
//        console.log(JSON.stringify(result, null, 2));
//      })().catch(err => { console.error(err); process.exit(1); });
//      NODE
//
// This keeps the whole colour pass to one shell command after browser setup.
async function setLabelColorsOverCDP({ cdpUrl = 'http://127.0.0.1:9222', updates, chromium: injectedChromium }) {
  if (!Array.isArray(updates) || updates.length === 0) {
    throw new Error('updates must be a non-empty array');
  }

  const chromium = injectedChromium || require('playwright').chromium;
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0];
  const existingPage = context.pages().find(p => p.url().includes('mail.google.com'));
  const page = existingPage || await context.newPage();

  try {
    await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.locator('div.pM[data-label-name]').first().waitFor({ state: 'attached', timeout: 15000 });

    const results = [];
    for (const { labelName, rgb } of updates) {
      await setLabelColor(page, labelName, rgb);
      const applied = await page.evaluate((name) => {
        const node = [...document.querySelectorAll('div.pM[data-label-name]')]
          .find(el => el.getAttribute('data-label-name') === name);
        if (!node) return null;
        const colorNode = node.closest('.TN')?.querySelector('[style*="background-color"]');
        return colorNode ? getComputedStyle(colorNode).backgroundColor : null;
      }, labelName);
      results.push({ labelName, rgb, applied });
    }

    return { ok: true, results };
  } finally {
    await browser.close();
  }
}

module.exports = { setLabelColor, setLabelColorsOverCDP, setLabelColorCascadeToSublabels };
