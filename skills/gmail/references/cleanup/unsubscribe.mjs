// ES module entrypoint for browser-client JavaScript runtimes.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const helpers = require('./unsubscribe.js');
export const {
  GMAIL_NATIVE_UNSUBSCRIBE_PLAYWRIGHT,
  GMAIL_NATIVE_UNSUBSCRIBE_BATCH_PLAYWRIGHT,
} = helpers;
// Adapter for the documented browser-client tab; no page injection or source eval.
export async function GMAIL_NATIVE_UNSUBSCRIBE_BATCH_WITH_TAB(tab, items) {
  return helpers.GMAIL_NATIVE_UNSUBSCRIBE_BATCH_PLAYWRIGHT(items)({
    goto: (url) => tab.goto(url),
    locator: (...args) => tab.playwright.locator(...args),
    getByRole: (...args) => tab.playwright.getByRole(...args),
    url: () => tab.url(),
    waitForTimeout: (ms) => tab.playwright.waitForTimeout(ms),
  });
}
export default helpers;
