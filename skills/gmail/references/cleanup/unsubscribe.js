// Safe Gmail-native unsubscribe helper.
//
// Preconditions (checked by the caller from message metadata):
// - `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is present.
// - The message authenticates with aligned SPF or DKIM.
// - Gmail itself exposes an exact native "Unsubscribe" control for this message.
//
// This never extracts, opens, navigates to, or follows a URL from an email.
// Gmail performs the protocol-level one-click request from its own interface.
function GMAIL_NATIVE_UNSUBSCRIBE_PLAYWRIGHT({ messageUrl }) {
  if (!/^https:\/\/mail\.google\.com\//.test(messageUrl)) {
    throw new Error("Only a Gmail message URL is allowed");
  }
  return async (page) => {
    await page.goto(messageUrl);
    // Gmail renders its own control beside the sender in the message heading as
    // a link. Do not use a same-named link in the message body/footer.
    const nativeUnsubscribe = page.locator("h3")
      .filter({ hasText: "Unsubscribe" })
      .getByRole("link", { name: "Unsubscribe", exact: true });
    if (await nativeUnsubscribe.count() !== 1) {
      throw new Error("Gmail did not expose one native unsubscribe control; refusing external-link fallback");
    }
    await nativeUnsubscribe.click();
    const dialog = page.getByRole("alertdialog");
    const confirm = dialog.getByRole("button", { name: "Unsubscribe", exact: true });
    if (await confirm.count() !== 1) throw new Error("No Gmail unsubscribe confirmation; refusing to continue");
    await confirm.click();
    await page.waitForTimeout(250);
    if (!page.url().startsWith("https://mail.google.com/")) {
      throw new Error("Unexpected navigation away from Gmail; stop and investigate");
    }
    return { unsubscribed: true };
  };
}

// Run several already-approved, planner-eligible messages in a single Gmail UI
// invocation. A failed item is reported and does not cause an unsafe fallback or
// prevent the following independent item from being attempted.
function GMAIL_NATIVE_UNSUBSCRIBE_BATCH_PLAYWRIGHT(items) {
  if (!Array.isArray(items) || items.some((item) => !item?.messageUrl)) {
    throw new Error("Expected approved items with Gmail messageUrl values");
  }
  return async (page) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const results = [];
    for (const item of items) {
      try {
        if (!/^https:\/\/mail\.google\.com\//.test(item.messageUrl)) throw new Error("non-Gmail URL refused");
        await page.goto(item.messageUrl);
        const native = page.locator("h3").filter({ hasText: "Unsubscribe" })
          .getByRole("link", { name: "Unsubscribe", exact: true });
        for (let attempt = 0; attempt < 30 && await native.count() !== 1; attempt += 1) await sleep(150);
        if (await native.count() !== 1) throw new Error("Gmail native control unavailable");
        await native.click();
        const dialog = page.getByRole("alertdialog");
        const confirm = dialog.getByRole("button", { name: "Unsubscribe", exact: true });
        for (let attempt = 0; attempt < 10 && await confirm.count() !== 1; attempt += 1) await sleep(100);
        if (await confirm.count() !== 1) throw new Error("Gmail confirmation unavailable");
        await confirm.click();
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await sleep(150);
          if (await dialog.count() === 0) break;
        }
        if (await dialog.count() !== 0) throw new Error("confirmation did not close");
        if (!page.url().startsWith("https://mail.google.com/")) throw new Error("unexpected navigation");
        results.push({ id: item.id, status: "unsubscribed" });
      } catch (error) {
        results.push({ id: item.id, status: "refused", reason: error.message });
      }
    }
    return results;
  };
}

module.exports = { GMAIL_NATIVE_UNSUBSCRIBE_PLAYWRIGHT, GMAIL_NATIVE_UNSUBSCRIBE_BATCH_PLAYWRIGHT };
