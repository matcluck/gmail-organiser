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

module.exports = { GMAIL_NATIVE_UNSUBSCRIBE_PLAYWRIGHT };
