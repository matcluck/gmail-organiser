// Navigate to https://mail.google.com/mail/u/0/#settings/labels first
//
// Gmail stores nesting two ways: a `/` in the label name AND/OR the "Nest label under"
// checkbox. When a label is wrongly nested, the fix is to uncheck "Nest label under" —
// the `/` in the name handles the correct hierarchy.

async function unnestLabel(page, displayName) {
  const labelDiv = page.locator('td.alT div.Zsjd8d').filter({
    hasText: new RegExp(`^${displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  });
  const row = labelDiv.locator('xpath=ancestor::tr');
  const editSpan = row.locator('span.alP').filter({ hasText: /^edit$/ });
  await editSpan.scrollIntoViewIfNeeded({ timeout: 10000 });
  await editSpan.click({ force: true, timeout: 10000 });

  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });

  const nestCheckbox = page.getByRole('checkbox', { name: 'Nest label under:' });
  if (await nestCheckbox.isChecked()) {
    await nestCheckbox.click();
  }

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(2000);
}

// To re-nest under a specific parent:
// The combobox is a custom div, NOT a native <select>. Do NOT use selectOption().
async function nestLabelUnder(page, displayName, parentName) {
  // ... same edit click pattern as unnestLabel above ...
  const nestCheckbox = page.getByRole('checkbox', { name: 'Nest label under:' });
  if (!(await nestCheckbox.isChecked())) {
    await nestCheckbox.click();
  }
  const combo = page.getByRole('combobox', { name: 'Nest label under:' });
  await combo.click();
  await page.waitForTimeout(500);
  await page.getByRole('option', { name: parentName, exact: true }).click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(2000);
}

// GOTCHA (2026-08-17): a combined rename+reparent Save silently no-ops when the
// current flat name already equals the target full path (a flat label "Parent/Leaf"
// fixed to name "Leaf" nested under "Parent"). The dialog closes with no error and
// no exception, but nothing changes -- Gmail treats the resulting path as colliding
// with the very row being edited.
//
// FIX: split it into two Saves via a temp name -- rename to temp, confirm the row
// list actually changed, then rename temp -> leaf and set the parent. Never treat
// "dialog closed" as proof of a write; re-read the label list to confirm.
async function renameAndNestLabel(page, currentFlatName, newLeaf, parentLeaf) {
  const tmpName = `${newLeaf}TMP${Date.now() % 100000}`;

  async function editByExactText(exactText) {
    const escaped = exactText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labelDiv = page.locator('td.alT div.Zsjd8d').filter({ hasText: new RegExp(`^${escaped}$`) });
    const row = labelDiv.locator('xpath=ancestor::tr');
    const editSpan = row.locator('span.alP').filter({ hasText: /^edit$/ });
    await editSpan.scrollIntoViewIfNeeded({ timeout: 10000 });
    await editSpan.click({ force: true, timeout: 10000 });
    await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });
    return page.getByRole('alertdialog', { name: 'Edit label' });
  }

  async function saveAndWait(dialog) {
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await dialog.count() === 0) break;
      await page.waitForTimeout(150); // NOT global setTimeout — see note below
    }
    if (await dialog.count() !== 0) throw new Error('Edit label dialog did not close');
    await page.waitForTimeout(500);
  }

  // Step 1: rename to a non-colliding temp name (no nesting change yet)
  let dialog = await editByExactText(currentFlatName);
  await dialog.getByRole('textbox', { name: 'Label name:' }).fill(tmpName);
  await saveAndWait(dialog);

  // Step 2: rename temp -> final leaf, nest under parentLeaf. The "Nest
  // label under" dropdown lists ALL labels by leaf name with indentation
  // prefixed as literal spaces in textContent — if parentLeaf's name is
  // ambiguous (e.g. you're building "Receipts" fresh while an unrelated
  // "Bills > Receipts" label already exists), match the RAW option text
  // with zero leading whitespace to get the top-level one specifically.
  dialog = await editByExactText(tmpName);
  await dialog.getByRole('textbox', { name: 'Label name:' }).fill(newLeaf);
  const nestCheckbox = page.getByRole('checkbox', { name: 'Nest label under:' });
  if (!(await nestCheckbox.isChecked())) await nestCheckbox.click();
  const combo = page.getByRole('combobox', { name: 'Nest label under:' });
  await combo.click();
  await page.waitForTimeout(500);
  const options = page.getByRole('option');
  const count = await options.count();
  let optIndex = -1;
  for (let i = 0; i < count; i++) {
    const raw = await options.nth(i).evaluate(el => el.textContent);
    if (raw.trim() === parentLeaf && !/^\s/.test(raw)) { optIndex = i; break; }
  }
  if (optIndex === -1) throw new Error(`Top-level parent option "${parentLeaf}" not found in nest dropdown`);
  await options.nth(optIndex).click();
  await page.waitForTimeout(300);
  await saveAndWait(dialog);
}

module.exports = { unnestLabel, nestLabelUnder, renameAndNestLabel };
// NOTE: browser_run_code_unsafe's execution context does NOT have a global
// `setTimeout` (confirmed 2026-08-17 — `ReferenceError: setTimeout is not
// defined`), even though it's the same kind of Node process a script would
// normally run in. Use `await page.waitForTimeout(ms)` for all delays, never
// `new Promise(r => setTimeout(r, ms))`. Getting this wrong is dangerous, not
// just broken: the ReferenceError throws AFTER an award/mutating action (e.g.
// right after clicking Save) has already fired, so the click itself may have
// gone through while your script reports failure — and if the next tool call
// does a `page.goto(...)` before Gmail's async save finished propagating, the
// navigation can abort the in-flight save, silently reverting it. Symptom:
// label list shows the OLD value even though nothing in the code "failed"
// other than the polling loop.
