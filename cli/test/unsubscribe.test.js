const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const helperPath = path.join(__dirname, '../../skills/gmail/references/cleanup/unsubscribe.js');
const { GMAIL_NATIVE_UNSUBSCRIBE_BATCH_PLAYWRIGHT: run } = require(helperPath);

function mockPage({ asyncUrl = false, outside = false, nativeCount = 1, confirmAvailableAfter = 0 } = {}) {
  let confirmed = false;
  let clicks = 0; let confirmChecks = 0;
  const native = { count: async () => nativeCount, click: async () => {} };
  const confirm = {
    count: async () => ++confirmChecks > confirmAvailableAfter ? 1 : 0,
    click: async () => { confirmed = true; clicks += 1; },
  };
  const dialog = { getByRole: () => confirm, count: async () => confirmed ? 0 : 1 };
  const url = outside ? 'https://example.com/' : 'https://mail.google.com/mail/u/0/';
  return {
    goto: async () => {},
    waitForTimeout: async () => {},
    locator: () => ({ filter: () => ({ getByRole: () => native }) }),
    getByRole: () => dialog,
    url: () => asyncUrl ? Promise.resolve(url) : url,
    clickCount: () => clicks,
  };
}
const items = [{ id: 'fixture', messageUrl: 'https://mail.google.com/mail/u/0/#all/fixture' }];

for (const asyncUrl of [false, true]) {
  test(`native unsubscribe accepts ${asyncUrl ? 'asynchronous' : 'synchronous'} URL adapters`, async () => {
    const page = mockPage({ asyncUrl });
    assert.deepEqual(await run(items)(page), [{ id: 'fixture', status: 'unsubscribed' }]);
    assert.equal(page.clickCount(), 1);
  });
}
test('unexpected navigation is reported without replaying confirmation', async () => {
  const page = mockPage({ asyncUrl: true, outside: true });
  const result = await run(items)(page);
  assert.equal(result[0].status, 'outcome-unknown');
  assert.equal(result[0].reason, 'unexpected navigation');
  assert.equal(page.clickCount(), 1);
});
test('ES module entrypoint exposes the maintained helpers', async () => {
  const module = await import(pathToFileURL(helperPath.replace(/\.js$/, '.mjs')).href);
  assert.equal(module.GMAIL_NATIVE_UNSUBSCRIBE_BATCH_PLAYWRIGHT, run);
});

test('non-Gmail URLs are refused before confirmation', async () => {
  const page = mockPage();
  const result = await run([{ id: 'fixture', messageUrl: 'https://example.com/' }])(page);
  assert.equal(result[0].status, 'refused');
  assert.equal(page.clickCount(), 0);
});
test('browser tab entrypoint adapts asynchronous URLs without repeating requests', async () => {
  const module = await import(pathToFileURL(helperPath.replace(/\.js$/, '.mjs')).href);
  const page = mockPage({ asyncUrl: true });
  const tab = { goto: (...args) => page.goto(...args), url: () => page.url(), playwright: page };
  assert.deepEqual(await module.GMAIL_NATIVE_UNSUBSCRIBE_BATCH_WITH_TAB(tab, items),
    [{ id: 'fixture', status: 'unsubscribed' }]);
  assert.equal(page.clickCount(), 1);
});

test('slow Gmail confirmation renders once without duplicate submission', async () => {
  const page = mockPage({ confirmAvailableAfter: 25 });
  assert.deepEqual(await run(items)(page), [{ id: 'fixture', status: 'unsubscribed' }]);
  assert.equal(page.clickCount(), 1);
});