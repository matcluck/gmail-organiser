// Navigate to https://mail.google.com/mail/u/0/#settings/labels first
async function createLabel(page, labelName) {
  const createBtn = page.locator('button').filter({ hasText: 'Create new label' }).first();
  await createBtn.scrollIntoViewIfNeeded({ timeout: 5000 });
  await createBtn.click({ force: true, timeout: 5000 });

  await page.waitForSelector('[role="alertdialog"]', { timeout: 5000 });
  const input = page.getByRole('textbox', { name: 'Please enter a new label name:' });
  await input.fill(labelName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForTimeout(2000);
}

module.exports = { createLabel };
