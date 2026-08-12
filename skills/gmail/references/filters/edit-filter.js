// edit-filter.js — Fast Gmail filter editor (stable selectors, single-evaluate flow)
//
// FAST PATH (target: 2-3 MCP calls per edit):
//   1. browser_navigate("#settings/filters")
//   2. browser_evaluate(EDIT_FILTER_FLOW, { matchText, fieldUpdates })
//        → finds row by matchText, clicks edit, polls form, applies fieldUpdates,
//          clicks Continue, polls actions page, clicks Update filter, polls return
//   3. (optional) verify with another evaluate that re-reads the filter list
//
// EDIT_FILTER_FLOW(matchText, fieldUpdates):
//   matchText: substring uniquely identifying the filter row (e.g. "sender@example.com" + a hasWords token)
//              Pass an array of strings for multi-token AND match.
//   fieldUpdates: object — keys are label texts, values are new values to SET
//                 e.g. { "Doesn't have": "is:important" }
//                 To APPEND to existing value, prefix with "+ " (e.g. "+ is:important")
//
// EXAMPLE call from agent:
//   browser_evaluate(`
//     async () => {
//       // ... paste EDIT_FILTER_FLOW body, then call:
//       return run(['sender@example.com', 'weekly digest'], { "Doesn't have": "receipt available" });
//     }
//   `)

const EDIT_FILTER_FLOW = `async (matchTokens, fieldUpdates) => {
  const errors = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const t0 = performance.now();

  function findInputByLabel(text) {
    const lab = [...document.querySelectorAll('label')]
      .find(l => l.offsetParent !== null && l.textContent.trim() === text);
    return lab ? document.getElementById(lab.getAttribute('for')) : null;
  }
  function findClickable(text) {
    return [...document.querySelectorAll('a, button, [role="link"], [role="button"]')]
      .find(el => el.textContent.trim() === text && el.offsetParent !== null);
  }
  function setVal(input, value) {
    const proto = window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    input.blur();
  }
  async function pollUntil(fn, label, max = 60) {
    for (let i = 0; i < max; i++) {
      const v = fn();
      if (v) return v;
      await sleep(50);
    }
    errors.push('TIMEOUT: ' + label);
    return null;
  }

  const tokens = Array.isArray(matchTokens) ? matchTokens : [matchTokens];

  // 1. Find the row matching ALL tokens
  const rows = [...document.querySelectorAll('tr')].filter(tr =>
    tr.textContent.includes('Matches:') && tokens.every(t => tr.textContent.includes(t))
  );
  if (rows.length === 0) { errors.push('No filter row matched ' + tokens.join(' + ')); return { errors }; }
  if (rows.length > 1) { errors.push('Ambiguous: ' + rows.length + ' rows match — narrow tokens'); return { errors, ambiguous: rows.length }; }
  const row = rows[0];
  const beforeText = row.textContent.substring(0, 300);

  // 2. Click the EDIT link (first [role="link"] in the row)
  const links = [...row.querySelectorAll('[role="link"]')];
  if (links.length < 2) { errors.push('No edit/delete links in row'); return { errors }; }
  links[0].click();  // edit is index 0, delete is index 1

  // 3. Poll for criteria form to render
  await pollUntil(() => findInputByLabel('Has the words'), 'edit form to render');

  // 4. Apply field updates
  const applied = {};
  for (const [labelText, newValue] of Object.entries(fieldUpdates)) {
    const inp = findInputByLabel(labelText);
    if (!inp) { errors.push('Field not found: ' + labelText); continue; }
    let finalValue = newValue;
    if (typeof newValue === 'string' && newValue.startsWith('+ ')) {
      // Append mode
      const existing = inp.value.trim();
      const toAdd = newValue.substring(2).trim();
      finalValue = existing ? (existing + ' ' + toAdd) : toAdd;
    }
    setVal(inp, finalValue);
    applied[labelText] = { from: inp.value === finalValue ? 'set' : '?', to: finalValue };
  }

  // 5. Click Continue (advance to actions page)
  const continueBtn = findClickable('Continue');
  if (!continueBtn) { errors.push('Continue button not found'); return { errors, applied }; }
  continueBtn.click();

  // 5a. Detect "Confirm creating filter" warning dialog (appears for is:/label:/in:/before:/after:/has:yellow-star
  //     queries, which Gmail says "will never match incoming mail"). Bail with a clear error.
  await sleep(300);
  const warnDialog = [...document.querySelectorAll('[role="alertdialog"]')]
    .find(d => d.offsetParent !== null && d.textContent.includes('Confirm creating filter'));
  if (warnDialog) {
    const cancelBtn = [...warnDialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel');
    cancelBtn?.click();
    return {
      errors: ['Gmail rejected criteria: "is:", "label:", "in:", date or star operators don\\'t work in filters. Cancelled. ' + warnDialog.textContent.substring(0, 200)],
      applied,
    };
  }

  // 6. Poll for actions page (Update filter button appears)
  await pollUntil(() => findClickable('Update filter'), 'actions page after Continue');

  // 7. Click Update filter
  const updateBtn = findClickable('Update filter');
  if (!updateBtn) { errors.push('Update filter button not found'); return { errors, applied }; }
  updateBtn.click();

  // 8. Poll for return to filters list
  await pollUntil(() => findClickable('Create a new filter'), 'return to filters list');

  return {
    errors,
    applied,
    matchedBefore: beforeText,
    totalMs: Math.round(performance.now() - t0),
  };
}`;

// ─── Legacy: simple From-only edit (still supported) ─────────────────────────
// EDIT_FILTER_FLOW with fieldUpdates={ "From": "newaddr@example.com" } does the same.

// ─── DELETE a filter by matching its criteria text ──────────────────────────
// Delete link is index 1 (second [role="link"]) inside the row.
// Confirms in a Gmail alertdialog (NOT a native browser dialog).
const DELETE_FILTER_FLOW = `async (matchTokens) => {
  const errors = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tokens = Array.isArray(matchTokens) ? matchTokens : [matchTokens];

  const rows = [...document.querySelectorAll('tr')].filter(tr =>
    tr.textContent.includes('Matches:') && tokens.every(t => tr.textContent.includes(t))
  );
  if (rows.length !== 1) { errors.push('Match count: ' + rows.length); return { errors }; }
  const links = [...rows[0].querySelectorAll('[role="link"]')];
  if (links.length < 2) { errors.push('No delete link'); return { errors }; }
  links[1].click();  // delete

  // Wait for confirmation dialog
  for (let i = 0; i < 40; i++) {
    if (document.querySelector('[role="alertdialog"]')) break;
    await sleep(50);
  }
  const ok = [...document.querySelectorAll('[role="alertdialog"] button')].find(b => b.textContent.trim() === 'OK');
  if (!ok) { errors.push('OK button not found in confirm dialog'); return { errors }; }
  ok.click();

  // Wait for row to disappear
  for (let i = 0; i < 40; i++) {
    const stillThere = [...document.querySelectorAll('tr')].some(tr =>
      tr.textContent.includes('Matches:') && tokens.every(t => tr.textContent.includes(t))
    );
    if (!stillThere) return { errors, deleted: true };
    await sleep(50);
  }
  errors.push('Row still present after delete');
  return { errors, deleted: false };
}`;

module.exports = { EDIT_FILTER_FLOW, DELETE_FILTER_FLOW, UPDATE_FILTER_ACTIONS_PLAYWRIGHT };

// For action changes, do not use accessible checkbox names: Gmail does not expose
// them reliably in all browser automation runtimes. Use the stable `input.btj`
// order and explicit before/after verification instead:
//
// 0 Skip Inbox, 1 Mark as read, 2 Star, 3 Apply label, 4 Forward,
// 5 Delete, 6 Never Spam, 7 Always important, 8 Never important,
// 9 Categorize, 10 Also apply to existing.
//
// Required procedure for a deterministic action update:
// 1. Match exactly one filter row by criteria plus distinguishing action text.
// 2. Open Edit and Continue, then wait for `input.btj[type="checkbox"]`.
// 3. Read all checkbox states; set only approved indexes with `check`/`uncheck`.
// 4. When applying a label, open the first action-page listbox and select its
//    exact full path using a real Playwright option click.
// 5. Submit Update filter and re-dump the row. Require exact criteria and action
//    equality before proceeding to the next mutation.
//
// Never use this index map outside Gmail's filter action screen. If the checkbox
// count is below 10 or the observed actions disagree with the map, stop and patch
// the helper before making another mutation.

// UPDATE_FILTER_ACTIONS_PLAYWRIGHT returns one Playwright callback for a complete,
// atomic action edit.  Use it in a single browser invocation. `matchTokens` must
// identify exactly one row, `actions` maps visible Gmail action labels to required
// boolean states, and `applyLabel` is optional.
//
// The inputs themselves are offscreen in Gmail. This helper clicks their visible
// label[for] element and verifies input.checked before submitting.
function UPDATE_FILTER_ACTIONS_PLAYWRIGHT(spec) {
  return async (page) => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const tokens = Array.isArray(spec.matchTokens) ? spec.matchTokens : [spec.matchTokens];
    const rows = page.locator('tr').filter({ hasText: 'Matches:' });
    const matches = [];
    for (let i = 0; i < await rows.count(); i++) {
      const row = rows.nth(i);
      const text = await row.innerText();
      if (tokens.every(token => text.includes(String(token)))) matches.push(i);
    }
    if (matches.length !== 1) throw new Error(`Expected one matching filter, found ${matches.length}`);
    const row = rows.nth(matches[0]);
    await row.getByRole('link', { name: 'edit', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('input.btj[type="checkbox"]').waitFor();

    for (const [labelText, required] of Object.entries(spec.actions || {})) {
      const labels = page.locator('label.aD').filter({ hasText: new RegExp(`^${labelText.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}$`) });
      if (await labels.count() !== 1) throw new Error(`Action label not unique: ${labelText}`);
      const inputId = await labels.first().getAttribute('for');
      const input = page.locator(`#${inputId}`);
      if ((await input.isChecked()) !== Boolean(required)) await labels.first().click();
      if ((await input.isChecked()) !== Boolean(required)) throw new Error(`Action state did not persist: ${labelText}`);
    }
    if (spec.applyLabel) {
      const listbox = page.getByRole('listbox').first();
      await listbox.click();
      await page.getByRole('option', { name: spec.applyLabel, exact: true }).click();
      if ((await listbox.innerText()).trim() !== spec.applyLabel) throw new Error(`Label selection did not persist: ${spec.applyLabel}`);
    }
    await page.getByRole('button', { name: 'Update filter', exact: true }).click();
    await sleep(400);
    if (await page.getByRole('link', { name: 'Create a new filter', exact: true }).count() !== 1) throw new Error('Gmail did not return to the filter list');
    return { updated: true, matchTokens: tokens };
  };
}

// ATOMIC BATCH RULE
// Gmail positions the actual checkbox inputs offscreen. Toggle the visible
// `label[for=<input id>]`, not the hidden `input.btj`, then read `input.checked`
// to verify the result.
//
// Browser sessions can release or navigate a Gmail tab between separate agent
// calls. For any action mutation, execute navigate -> uniquely match -> edit ->
// mutate -> submit -> verify in one browser-code invocation. Do not retain a
// modal, locator, checkbox, or row reference across calls. A batch may contain
// several independent operations, but every operation must navigate fresh and
// report its own before/after row text. Stop the batch on the first failed
// precondition; never guess a matching row or retry by broadening criteria.
