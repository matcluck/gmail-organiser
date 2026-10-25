// create-filter.js — Fast Gmail filter creation via Playwright-assisted flows
//
// ─── CODEX FAST PATH (target: 1 MCP call per common filter) ─────────────────
// Prefer CODEX_CREATE_LABEL_FILTER_PLAYWRIGHT and
// CODEX_CREATE_SKIP_FILTER_PLAYWRIGHT with browser_run_code_unsafe when that tool
// is available. Gmail's label dropdown rejects synthetic in-page DOM clicks, but
// Playwright locator clicks select labels reliably. The Playwright helpers still
// complete filter creation in one MCP call after browser setup.
//
// Use CODEX_CREATE_LABEL_FILTER / CODEX_CREATE_SKIP_FILTER only as fallback when
// browser_run_code_unsafe is unavailable.
//
// ─── LEGACY STEPWISE PATH (fallback when the fast helper drifts) ─────────────
//   1. browser_navigate(filters URL) + browser_wait_for("Create a new filter")
//   2. browser_evaluate: click span.sA "Create a new filter"
//   3. browser_evaluate: setVal('input.aQa', from) + setVal('input.aP9', doesntHave) — fill fields only
//   3b. browser_click('button:has-text("Create filter")') — MUST use browser_click, NOT evaluate().click() (evaluate click silently fails to navigate)
//   4. browser_wait_for("Skip the Inbox") then browser_evaluate: toggle required checkboxes (skip/label/never-spam/also-apply) + open listbox
//   5. browser_snapshot(filename=...) → Grep for `option "<LabelPath>"` → browser_click(ref)
//   6. browser_evaluate: click final 'Create filter' submit
//   7. browser_wait_for("Create a new filter") to confirm return to filters list
//
// BATCHING: Steps 3 and 4 each fold what used to be 3-4 separate calls into one evaluate().
// PARALLELISM: When a session needs MULTIPLE filters, the queue must be sequential
// (single browser instance), but tool schema loading should be done ONCE upfront.
//
// PERFORMANCE APPROACH:
//   - Use browser_run_code_unsafe() for one-call end-to-end filter creation.
//   - Use Playwright locator clicks for Gmail buttons and label options.
//   - Use in-page evaluate only for fast field filling and checkbox toggles.
//   - Batch checkbox toggling into a single evaluate() call
//   - Avoid snapshot round-trips for label selection.
//
// USAGE: Call createFilter() once per filter. For the two-filter pattern, call it twice.
//
// TWO-FILTER PATTERN (default for most senders):
//   Filter 1: from:<sender> → apply label + never spam (catches everything)
//   Filter 2: from:<sender> + keywords → skip inbox + never spam, no label, NEVER mark read
//   This ensures emails with "Important" in subject stay visible in inbox.
//
// OPTIONS:
//   skipInbox  — boolean, default true
//   markRead   — deprecated; must remain false. No Gmail filter should ever mark mail as read.
//   stayInbox  — boolean, set true to force skipInbox=false (security alerts, bills)
//   doesntHave — string, add to "Doesn't have" field (e.g. "Important")
//   neverSpam  — boolean, default true
//   applyToExisting — boolean, default true

// ─── CODEX MCP LOW-CALL HELPERS ─────────────────────────────────────────────
//
// In Codex sessions with Playwright MCP but without a local `playwright` npm
// package, use the browser tools directly with this split:
//
// LABEL FILTER (1 MCP call after browser is connected):
//   browser_run_code_unsafe({
//     code: CODEX_CREATE_LABEL_FILTER_PLAYWRIGHT({
//       from, hasWords, label, skipInbox:false, neverSpam:true,
//       alsoApplyToExisting:true
//     })
//   })
//
// SKIP-ONLY FILTER (1 MCP call after browser is connected):
//   browser_run_code_unsafe({
//     code: CODEX_CREATE_SKIP_FILTER_PLAYWRIGHT({
//       from, hasWords, neverSpam:true, alsoApplyToExisting:true
//     })
//   })
//
// Fallback when browser_run_code_unsafe is unavailable:
//
// LABEL FILTER (1 MCP call after starting on #settings/filters):
//   browser_evaluate(CODEX_CREATE_LABEL_FILTER({
//     from, hasWords, label, skipInbox:false, neverSpam:true,
//     alsoApplyToExisting:true
//   }))
//
// SKIP-ONLY FILTER (1 MCP call after starting on #settings/filters):
//   browser_evaluate(CODEX_CREATE_SKIP_FILTER({ from, hasWords, neverSpam:true }))
//
// Retroactive cleanup:
//   `alsoApplyToExisting` ticks Gmail's "Also apply filter to matching
//   conversations" checkbox. Use it for both label filters and skip-only filters
//   when the user wants matching current Inbox mail cleaned up immediately.
//   For high-risk/large backfills, set it false, then run a separate reviewed
//   Gmail search/archive cleanup:
//     Gmail search: in:inbox from:sender terms...
//     Action: archive matching messages after the persistent skip filter exists.
//
// Do not try to select label dropdown options with page.evaluate() DOM clicks.
// Gmail may close the overlay without selecting the option. Use Playwright's
// page.getByRole('option', { name: label, exact: true }).click().

function makePlaywrightCreateFilter(spec) {
  const normalized = {
    from: spec.from || '',
    to: spec.to || '',
    subject: spec.subject || '',
    hasWords: spec.hasWords || '',
    doesntHave: spec.doesntHave || '',
    label: spec.label || '',
    applyLabel: !!spec.applyLabel,
    skipInbox: !!spec.skipInbox,
    neverSpam: spec.neverSpam !== false,
    alsoApplyToExisting: spec.alsoApplyToExisting !== false && spec.alsoApplyLabelToExisting !== false,
  };

  return `async (page) => {
  const spec = ${JSON.stringify(normalized)};
  const settingsUrl = 'https://mail.google.com/mail/u/0/#settings/filters';
  await page.setViewportSize({ width: 1500, height: 950 });
  if (!page.url().includes('#settings/filters')) {
    await page.goto(settingsUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForFunction(() => document.body.innerText.includes('Create a new filter'), null, { timeout: 15000 });

  await page.locator('span.sA').filter({ hasText: 'Create a new filter' }).last().click();
  await page.waitForSelector('input.aQb', { timeout: 10000 });
  await page.evaluate((spec) => {
    function setVal(sel, val) {
      if (!val) return;
      const el = document.querySelector(sel);
      if (!el) throw new Error('missing input ' + sel);
      const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      nativeInput.set.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setVal('input.aQa', spec.from);
    setVal('input.aQf', spec.to);
    setVal('input.aQd', spec.subject);
    setVal('input.aQb', spec.hasWords);
    setVal('input.aP9', spec.doesntHave);
  }, spec);

  await page.getByRole('button', { name: 'Create filter' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('input.btj[type="checkbox"]')].length >= 8, null, { timeout: 10000 });

  const warning = await page.evaluate(() => {
    const warn = [...document.querySelectorAll('[role="alertdialog"]')]
      .find(d => d.offsetParent !== null && d.textContent.includes('Confirm creating filter'));
    if (!warn) return null;
    const cancel = [...warn.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel');
    cancel?.click();
    return warn.textContent.slice(0, 240);
  });
  if (warning) return { ok: false, error: 'Gmail warning dialog', warning };

  await page.evaluate((spec) => {
    const cbs = [...document.querySelectorAll('input.btj[type="checkbox"]')];
    if (spec.skipInbox && cbs[0] && !cbs[0].checked) cbs[0].click();
    if (!spec.skipInbox && cbs[0]?.checked) cbs[0].click();
    if (cbs[1]?.checked) cbs[1].click(); // Never mark as read.
    if (spec.applyLabel && cbs[3] && !cbs[3].checked) cbs[3].click();
    if (!spec.applyLabel && cbs[3]?.checked) cbs[3].click();
    if (spec.neverSpam) {
      const ns = cbs.find(c => c.parentElement?.textContent?.includes('Never send'));
      if (ns && !ns.checked) ns.click();
    }
    if (spec.alsoApplyToExisting) {
      const also = cbs.find(c => c.parentElement?.textContent?.includes('Also apply'));
      if (also && !also.checked) also.click();
    }
  }, spec);

  if (spec.applyLabel) {
    await page.getByRole('option', { name: 'Choose label...' }).click();
    await page.getByRole('option', { name: spec.label, exact: true }).click({ timeout: 10000 });
    const selected = await page.getByRole('listbox', { name: spec.label }).count();
    if (!selected) return { ok: false, error: 'label selection did not stick', label: spec.label };
  }

  await page.getByRole('button', { name: 'Create filter' }).click();
  await page.waitForURL(/#settings\\/filters/, { timeout: 15000 });
  await page.waitForFunction(() => document.body.innerText.includes('Matches:'), null, { timeout: 15000 });

  const row = await page.evaluate((spec) => {
    const phraseNeedles = spec.hasWords
      ? [...spec.hasWords.matchAll(/"([^"]+)"/g)].map(m => m[1]).filter(Boolean)
      : [];
    const actionNeedle = spec.skipInbox
      ? 'Skip Inbox'
      : spec.applyLabel
        ? 'Apply label "' + spec.label + '"'
        : null;
    return [...document.querySelectorAll('tr')]
      .filter(tr => tr.offsetParent !== null && tr.textContent.includes('Matches:'))
      .map(tr => tr.textContent.trim())
      .find(text =>
        (!spec.from || text.includes(spec.from)) &&
        (!spec.to || text.includes(spec.to)) &&
        (!spec.subject || text.includes(spec.subject)) &&
        (!spec.hasWords || (phraseNeedles.length ? phraseNeedles.every(p => text.includes(p)) : text.includes(spec.hasWords))) &&
        (!actionNeedle || text.includes(actionNeedle)) &&
        (spec.neverSpam === false || text.includes('Never send it to Spam'))
      ) || null;
  }, spec);
  return { ok: !!row, row, spec };
}`;
}

function CODEX_CREATE_LABEL_FILTER_PLAYWRIGHT(spec) {
  return makePlaywrightCreateFilter({
    ...spec,
    applyLabel: true,
    skipInbox: !!spec.skipInbox,
    neverSpam: spec.neverSpam !== false,
  });
}

function CODEX_CREATE_SKIP_FILTER_PLAYWRIGHT(spec) {
  return makePlaywrightCreateFilter({
    ...spec,
    applyLabel: false,
    skipInbox: true,
    neverSpam: spec.neverSpam !== false,
  });
}

const GMAIL_FILTERS_URL = "https://mail.google.com/mail/u/0/#settings/filters";

function NORMALIZE_FILTER_SPECS(specs) {
  if (!Array.isArray(specs) || specs.length === 0) throw new Error("Expected at least one filter spec");
  return specs.map((input, index) => {
    const spec = {
      from: String(input?.from || "").trim(),
      list: String(input?.list || "").trim(),
      to: String(input?.to || "").trim(),
      subject: String(input?.subject || "").trim(),
      hasWords: String(input?.hasWords || "").trim(),
      doesntHave: String(input?.doesntHave || "").trim(),
      label: String(input?.label || "").trim(),
      skipInbox: input?.skipInbox,
      neverSpam: input?.neverSpam !== false,
      alsoApplyToExisting: input?.alsoApplyToExisting !== false,
    };
    if (!spec.from && !spec.list) throw new Error(`Filter ${index + 1} needs from or list`);
    if (typeof spec.skipInbox !== "boolean") throw new Error(`Filter ${index + 1} needs boolean skipInbox`);
    if (spec.skipInbox && spec.label) throw new Error(`Filter ${index + 1} cannot label in a skip-only rule`);
    if (!spec.skipInbox && !spec.label) throw new Error(`Filter ${index + 1} needs a label when it stays in Inbox`);
    return spec;
  });
}

function FILTER_ROW_MATCHES_SPEC(rowText, spec) {
  const compact = String(rowText || "").replace(/\s+/g, " ").trim();
  const match = compact.match(/^Matches:\s*(.*?)\s*Do this:\s*(.*?)(?:editdelete)?$/);
  if (!match) return false;
  const expectedCriteria = [
    spec.from && `from:(${spec.from})`,
    spec.to && `to:(${spec.to})`,
    spec.subject && `subject:(${spec.subject})`,
    spec.list && `list:(${spec.list})`,
    spec.hasWords,
    spec.doesntHave && `-{${spec.doesntHave}}`,
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (match[1].trim() !== expectedCriteria) return false;

  const actions = match[2].replace(/editdelete$/, "").split(/,\s*/).filter(Boolean);
  const expectedActions = [
    spec.skipInbox && "Skip Inbox",
    spec.label && `Apply label "${spec.label}"`,
    spec.neverSpam && "Never send it to Spam",
  ].filter(Boolean);
  return actions.length === expectedActions.length
    && expectedActions.every((expected) => actions.includes(expected));
}

async function WAIT_FOR_FILTER_ROW(page, spec, rowMatches, sleep, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await page.locator("tr").allTextContents({ timeoutMs: 5000 });
    const row = rows.find((text) => rowMatches(text, spec));
    if (row) return row.replace(/\s+/g, " ").trim();
    await sleep(150);
  }
  return null;
}

// One deterministic runtime used by both Claude Playwright callbacks and
// ChatGPT browser-client tabs. It waits for the exact persisted filter row;
// never navigate away merely because Gmail has not finished saving yet.
async function RUN_GMAIL_FILTER_BATCH(runtime, specs, rowMatches, waitForRow) {
  const { page, navigate } = runtime;
  const sleep = (ms) => page.waitForTimeout(ms);
  const waitUntil = async (check, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await check();
      if (value) return value;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const setAction = async (text, required, optional = false) => {
    if (!required) return;
    const control = page.locator("label.aD").filter({ hasText: text });
    const count = await control.count();
    if (optional && count === 0) return;
    if (count !== 1) throw new Error(`Action control not unique: ${text}`);
    await control.click();
    await sleep(100);
  };
  const fillIfPresent = async (name, value) => {
    await page.getByRole("textbox", { name, exact: true }).fill(value || "");
  };

  const results = [];
  for (const spec of specs) {
    try {
      await navigate(GMAIL_FILTERS_URL);
      const createLink = page.locator("span.sA").filter({ hasText: "Create a new filter" }).last();
      await waitUntil(async () => await createLink.count() === 1, 15000, "Gmail filter settings");
      await createLink.click();
      await waitUntil(async () => await page.locator("input.aQb").count() === 1, 10000, "criteria form");

      await fillIfPresent("From", spec.from);
      await fillIfPresent("To", spec.to);
      await fillIfPresent("Subject", spec.subject);
      await fillIfPresent("Has the words", [spec.list && `list:(${spec.list})`, spec.hasWords].filter(Boolean).join(" "));
      await fillIfPresent("Doesn't have", spec.doesntHave);
      await sleep(600);

      const advance = page.getByRole("button", { name: "Create filter", exact: true });
      await waitUntil(async () => await advance.isEnabled(), 5000, "enabled Create filter button");
      await advance.click();

      const actionState = await waitUntil(async () => {
        const dialogs = await page.locator('[role="alertdialog"]').all();
        const warningTexts = [];
        for (const dialog of dialogs) {
          if (await dialog.isVisible()) warningTexts.push(await dialog.innerText({ timeoutMs: 5000 }));
        }
        if (warningTexts.some((text) => text.includes("Confirm creating filter"))) return "warning";
        if (await page.locator('input.btj[type="checkbox"]').count() >= 8) return "actions";
        return null;
      }, 10000, "filter actions form");
      if (actionState === "warning") {
        const warning = page.locator('[role="alertdialog"]').filter({ hasText: "Confirm creating filter" });
        const cancel = warning.getByRole("button", { name: "Cancel", exact: true });
        if (await cancel.count() === 1) await cancel.click();
        throw new Error("Gmail rejected warning-prone filter criteria");
      }

      await setAction("Skip the Inbox", spec.skipInbox);
      await setAction("Apply the label", Boolean(spec.label));
      await setAction("Never send it to Spam", spec.neverSpam);
      if (spec.label) {
        const listbox = page.getByRole("listbox").first();
        await listbox.click();
        const option = page.getByRole("option", { name: spec.label, exact: true });
        await waitUntil(async () => await option.count() === 1 && await option.isVisible(), 5000, `label ${spec.label}`);
        await option.click();
        await waitUntil(async () => (await listbox.innerText({ timeoutMs: 5000 })).trim() === spec.label, 5000, `selected label ${spec.label}`);
      }
      await setAction("Also apply", spec.alsoApplyToExisting, true);
      await sleep(300);

      const submit = page.getByRole("button", { name: "Create filter", exact: true });
      await waitUntil(async () => await submit.isEnabled(), 5000, "enabled filter submit button");
      await submit.click();

      // Label filters can take several seconds to persist. Poll the exact row on
      // the current page first so a recovery navigation cannot cancel the save.
      let row = await waitForRow(page, spec, rowMatches, sleep, 10000);
      if (!row) {
        await navigate(GMAIL_FILTERS_URL);
        await waitUntil(async () => await createLink.count() === 1, 15000, "filter list recovery");
        row = await waitForRow(page, spec, rowMatches, sleep, 5000);
      }
      if (!row) throw new Error("Saved filter row did not match the requested criteria and actions");
      results.push({ from: spec.from || null, list: spec.list || null, hasWords: spec.hasWords || null, status: "created", row });
    } catch (error) {
      results.push({ from: spec.from || null, list: spec.list || null, hasWords: spec.hasWords || null, status: "failed", reason: error.message });
      break;
    }
  }
  return results;
}

function CODEX_CREATE_FILTER_BATCH_PLAYWRIGHT(specs) {
  const normalized = NORMALIZE_FILTER_SPECS(specs);
  const serializedSpecs = JSON.stringify(normalized);
  return `async (page) => {
    const GMAIL_FILTERS_URL = ${JSON.stringify(GMAIL_FILTERS_URL)};
    const rowMatches = ${FILTER_ROW_MATCHES_SPEC.toString()};
    const waitForRow = ${WAIT_FOR_FILTER_ROW.toString()};
    const runBatch = ${RUN_GMAIL_FILTER_BATCH.toString()};
    if (page.setViewportSize) await page.setViewportSize({ width: 1500, height: 950 });
    return runBatch({ page, navigate: (url) => page.goto(url) }, ${serializedSpecs}, rowMatches, waitForRow);
  }`;
}

async function CREATE_FILTER_BATCH_WITH_PAGE(page, specs) {
  const normalized = NORMALIZE_FILTER_SPECS(specs);
  return RUN_GMAIL_FILTER_BATCH(
    { page, navigate: (url) => page.goto(url) },
    normalized,
    FILTER_ROW_MATCHES_SPEC,
    WAIT_FOR_FILTER_ROW,
  );
}

// ChatGPT browser-client entrypoint. Pass the claimed Gmail tab and every
// already-approved filter spec; one tool execution creates and verifies them.
async function CREATE_FILTER_BATCH_WITH_TAB(tab, specs) {
  const normalized = NORMALIZE_FILTER_SPECS(specs);
  return RUN_GMAIL_FILTER_BATCH(
    { page: tab.playwright, navigate: (url) => tab.goto(url) },
    normalized,
    FILTER_ROW_MATCHES_SPEC,
    WAIT_FOR_FILTER_ROW,
  );
}

const CODEX_PREPARE_FILTER_ACTIONS = `async (spec) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errors = [];

  function setVal(sel, val) {
    const el = document.querySelector(sel);
    if (!el) { errors.push('missing input ' + sel); return false; }
    const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    nativeInput.set.call(el, val || '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  async function waitFor(fn, label, tries = 80) {
    for (let i = 0; i < tries; i++) {
      const v = fn();
      if (v) return v;
      await sleep(75);
    }
    errors.push('timeout: ' + label);
    return null;
  }
  function clickCreateFilterLink() {
    const el = [...document.querySelectorAll('span.sA, a, span')]
      .find(s => s.textContent?.trim() === 'Create a new filter' && s.offsetParent !== null);
    if (!el) { errors.push('Create a new filter link not found'); return false; }
    el.click();
    return true;
  }
  function clickCreateFilterButton() {
    const b = [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === 'Create filter' && !b.disabled && b.offsetParent !== null);
    if (!b) { errors.push('Create filter button not found'); return false; }
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    b.click();
    return true;
  }

  clickCreateFilterLink();
  await waitFor(() => document.querySelector('input.aQb'), 'criteria form');
  if (spec.from) setVal('input.aQa', spec.from);
  if (spec.to) setVal('input.aQf', spec.to);
  if (spec.subject) setVal('input.aQd', spec.subject);
  if (spec.hasWords) setVal('input.aQb', spec.hasWords);
  if (spec.doesntHave) setVal('input.aP9', spec.doesntHave);
  clickCreateFilterButton();

  await waitFor(() => [...document.querySelectorAll('input.btj[type="checkbox"]')].length >= 8, 'actions form');
  const warnDialog = [...document.querySelectorAll('[role="alertdialog"]')]
    .find(d => d.offsetParent !== null && d.textContent.includes('Confirm creating filter'));
  if (warnDialog) {
    const cancel = [...warnDialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel');
    cancel?.click();
    return { ok: false, errors: errors.concat('Gmail warning dialog: ' + warnDialog.textContent.slice(0, 180)) };
  }

  const cbs = [...document.querySelectorAll('input.btj[type="checkbox"]')];
  if (spec.skipInbox && cbs[0] && !cbs[0].checked) cbs[0].click();
  if (cbs[1]?.checked) cbs[1].click(); // Never mark as read.
  if (spec.applyLabel && cbs[3] && !cbs[3].checked) cbs[3].click();
  if (!spec.applyLabel && cbs[3]?.checked) cbs[3].click();
  if (spec.neverSpam !== false) {
    const ns = cbs.find(c => c.parentElement?.textContent?.includes('Never send'));
    if (ns && !ns.checked) { ns.scrollIntoView({ block: 'center' }); ns.click(); }
  }
  if (spec.alsoApplyToExisting || spec.alsoApplyLabelToExisting) {
    const also = cbs.find(c => c.parentElement?.textContent?.includes('Also apply'));
    if (also && !also.checked) { also.scrollIntoView({ block: 'center' }); also.click(); }
  }
  if (spec.applyLabel) {
    const lb = document.querySelector('[role="listbox"]');
    lb?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    lb?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  }
  return { ok: errors.length === 0, errors, url: location.href };
}`;

const CODEX_SUBMIT_FILTER = `() => {
  const b = [...document.querySelectorAll('button')]
    .find(b => b.textContent.trim() === 'Create filter' && !b.disabled && b.offsetParent !== null);
  b?.click();
  return { clicked: !!b };
}`;

const CODEX_SELECT_LABEL_OPTION = `(label) => {
  const sleepUntil = (fn, tries = 20) => {
    for (let i = 0; i < tries; i++) {
      const v = fn();
      if (v) return v;
    }
    return null;
  };
  const selected = () => [...document.querySelectorAll('[role="listbox"]')]
    .map(x => x.textContent.trim())
    .find(t => t === label);

  const lb = document.querySelector('[role="listbox"]');
  lb?.scrollIntoView({ block: 'center' });
  lb?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  lb?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));

  const options = [...document.querySelectorAll('[role="option"]')];
  const opt = options.find(o => o.textContent.trim() === label)
    || options.find(o => o.getAttribute('title') === label);
  if (!opt) return { selected: false, reason: 'label option not found: ' + label };

  opt.scrollIntoView({ block: 'center' });
  const clickOption = target => {
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    target.click();
  };

  clickOption(opt);
  let selectedText = selected();
  if (!selectedText) {
    const r = opt.getBoundingClientRect();
    const atPoint = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (atPoint) clickOption(atPoint.closest('[role="option"]') || atPoint);
    selectedText = sleepUntil(selected);
  }
  return { selected: selectedText === label, label, selectedText: selectedText || null };
}`;

const CODEX_CREATE_LABEL_FILTER = `async (spec) => {
  const result = await (${CODEX_PREPARE_FILTER_ACTIONS})({
    ...spec,
    applyLabel: true,
    skipInbox: !!spec.skipInbox,
    neverSpam: spec.neverSpam !== false,
    alsoApplyToExisting: spec.alsoApplyToExisting !== false && spec.alsoApplyLabelToExisting !== false,
  });
  if (!result.ok) return result;

  const selected = (${CODEX_SELECT_LABEL_OPTION})(spec.label);
  if (!selected.selected) return { ...result, ok: false, errors: result.errors.concat(selected.reason || 'label selection failed'), selected };

  const submit = (${CODEX_SUBMIT_FILTER})();
  return { ...result, selected, submitted: submit.clicked };
}`;

const CODEX_CREATE_SKIP_FILTER = `async (spec) => {
  const result = await (${CODEX_PREPARE_FILTER_ACTIONS})({
    ...spec,
    skipInbox: true,
    applyLabel: false,
    alsoApplyToExisting: spec.alsoApplyToExisting !== false,
    neverSpam: spec.neverSpam !== false,
  });
  if (!result.ok) return result;
  const submit = (${CODEX_SUBMIT_FILTER})();
  return { ...result, submitted: submit.clicked };
}`;

module.exports = {
  CODEX_CREATE_LABEL_FILTER_PLAYWRIGHT,
  CODEX_CREATE_SKIP_FILTER_PLAYWRIGHT,
  CODEX_CREATE_FILTER_BATCH_PLAYWRIGHT,
  CREATE_FILTER_BATCH_WITH_PAGE,
  CREATE_FILTER_BATCH_WITH_TAB,
  NORMALIZE_FILTER_SPECS,
  FILTER_ROW_MATCHES_SPEC,
  WAIT_FOR_FILTER_ROW,
  RUN_GMAIL_FILTER_BATCH,
  CODEX_PREPARE_FILTER_ACTIONS,
  CODEX_SELECT_LABEL_OPTION,
  CODEX_SUBMIT_FILTER,
  CODEX_CREATE_LABEL_FILTER,
  CODEX_CREATE_SKIP_FILTER,
};

// ─── STEP-BY-STEP INSTRUCTIONS FOR AGENTS ────────────────────────────────────

// 1. Navigate fresh to filters settings:
//    browser_navigate("https://mail.google.com/mail/u/0/#settings/filters")
//    browser_wait_for(selector="a[href*='cf='][class*='link']", timeout=3000)

// 2. Click "Create a new filter" link via JS:
//    IMPORTANT: It's a <span class="sA">, NOT span.e5 or an <a> tag. Use this:
//    browser_evaluate(`
//      [...document.querySelectorAll('span.sA')].find(s => s.textContent.includes('Create a new filter'))?.click()
//    `)
//    browser_wait_for(text="Has the words", time=3)

// 3. Fill criteria fields in one evaluate() call:
//    NOTE: Gmail inputs have NO `name` attribute — use class selectors:
//      .aQa = From · .aQf = To · .aQd = Subject · .aQb = Has the words · .aP9 = Doesn't have
//    browser_evaluate(`
//      function setVal(sel, val) {
//        const el = document.querySelector(sel);
//        if (!el || !val) return;
//        const nativeInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
//        nativeInput.set.call(el, val);
//        el.dispatchEvent(new Event('input', { bubbles: true }));
//        el.dispatchEvent(new Event('change', { bubbles: true }));
//      }
//      setVal('input.aQa', '<SENDER_EMAIL>');
//      setVal('input.aP9', '<DOESNT_HAVE_VALUE_OR_EMPTY>');
//    `)
//
//    VIEWPORT REQUIREMENT: The create-filter dialog renders `display:none` if the viewport
//    is too narrow. Resize to at least 1500x950 before opening the dialog:
//      browser_resize(width=1500, height=950)

// 4. Click "Create filter" button (to advance to actions page):
//    ⚠️ CRITICAL: Use browser_click, NOT evaluate().click() for this step.
//    evaluate().click() on the criteria-page "Create filter" button does NOT navigate
//    The button JS can fire while Gmail ignores the transition. Use:
//
//    browser_click(target='button:has-text("Create filter")', element="Create filter button")
//    // Verify URL changed to #create-filter/from=... before proceeding
//    browser_wait_for(text="Skip the Inbox", time=4)

// 5. Toggle required checkboxes (skip inbox, apply label, never spam, also-apply)
//    AND open label dropdown in ONE evaluate(). Saves 3-4 round trips.
//    IMPORTANT: Never-spam checkbox is found via parentElement.textContent — NOT closest('label').
//    The structure is <div><input/><generic>Never send it to Spam</generic></div>, no <label> tag.
//
//    browser_evaluate(`
//      const cbs = [...document.querySelectorAll('input.btj[type="checkbox"]')];
//      const skipInbox = <true/false>;
//      const markRead  = false; // hard rule: never mark mail as read
//      const neverSpam = true;  // almost always true
//      const alsoApply = true;  // retroactively apply the filter to existing emails
//      if (skipInbox && !cbs[0]?.checked) cbs[0].click();
//      if (cbs[1]?.checked) cbs[1].click(); // Mark as read must stay off
//      if (!cbs[3]?.checked) cbs[3].click();  // Apply label
//      if (neverSpam) {
//        const ns = cbs.find(c => c.parentElement?.textContent?.includes('Never send'));
//        if (ns && !ns.checked) { ns.scrollIntoView({block:'center'}); ns.click(); }
//      }
//      if (alsoApply) {
//        const last = cbs[cbs.length - 1];
//        if (last && !last.checked) { last.scrollIntoView({block:'center'}); last.click(); }
//      }
//      // Open the label dropdown
//      const lb = document.querySelector('[role="listbox"]');
//      lb?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
//      lb?.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
//    `)
//    browser_wait_for(text="apply the label", time=1)
//
//    NOTE: We tick "Also apply to matching conversations" HERE (before label selection)
//    rather than in a separate step 7. Saves one round trip. Order doesn't matter to Gmail.

// 6. Select label — prefer the one-call PLAYWRIGHT helper above. If you are on
//    the legacy stepwise path, use browser_click on the option from a snapshot.
//    Gmail's overlay intercepts synthetic DOM clicks — do NOT click the option
//    via evaluate(). It will appear to fire but the selection won't stick.
//
//    browser_snapshot(filename="<scratch-snapshot.md>")
//    Grep the scratch snapshot for: option "<LeafLabelName>"   → get ref value (e.g. ref=e86252)
//    browser_click(ref=<ref>)
//    // Playwright's browser_click handles the overlay correctly; evaluate().click() does not.

// 7. Submit (also-apply was already ticked in step 5):
//    browser_evaluate(`
//      [...document.querySelectorAll('button')]
//        .find(b => b.textContent.trim() === 'Create filter' && !b.disabled)?.click();
//    `)
//    browser_wait_for(text="Create a new filter", time=3)
//    // Success = returned to filters list page

// ─── FILTER DECISION GUIDE ───────────────────────────────────────────────────
//
// Use TWO-FILTER PATTERN for: newsletters, marketing, notifications, subscriptions
//   Filter 1: from:<sender>              → label + never spam
//   Filter 2: from:<sender> + keywords   → skip inbox + never spam, no label, never mark read
//
// Use SINGLE FILTER (stay in inbox) for:
//   - Security alerts (Google, CrowdStrike, Bitwarden) → label only, never spam
//   - Bills / payment reminders → label only
//   - Health / medical → label only
//   - Anything needing a response
//
// Use SINGLE FILTER (skip inbox) for:
//   - Pure transactional receipts where you never need to act (order confirmations)

// ─── LABEL DISPLAY NAME NOTES ────────────────────────────────────────────────
// In the dropdown, Gmail shows the FULL path: "Mailing Lists/Newsletter"
// The JS selector searches for exact match OR endsWith match on the leaf name.
// If a label name is ambiguous (e.g. two labels ending in "Misc"), use exact full path.

// ─── DOM GOTCHAS ─────────────────────────────────────────────────────────────
// - "Restaurants" is a reserved Gmail system label — use "Dining" instead
// - CSS.escape() is NOT available in Playwright Node context — use XPath for data-label-name
// - The listbox overlay rejects synthetic in-page clicks for option selection — use Playwright locator clicks
// - Label display names in settings show only the leaf name, not full path
// - After submit, Gmail redirects to #settings/filters — wait for that before next filter
