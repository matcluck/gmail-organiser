const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  NORMALIZE_FILTER_SPECS,
  FILTER_ROW_MATCHES_SPEC,
} = require(path.join(__dirname, '..', '..', 'skills', 'gmail', 'references', 'filters', 'create-filter.js'));

test('NORMALIZE_FILTER_SPECS requires from or list', () => {
  assert.throws(() => NORMALIZE_FILTER_SPECS([{ skipInbox: true }]), /needs from or list/);
});

test('NORMALIZE_FILTER_SPECS requires an explicit boolean skipInbox', () => {
  assert.throws(
    () => NORMALIZE_FILTER_SPECS([{ from: 'a@b.com', label: 'X' }]),
    /needs boolean skipInbox/,
  );
});

test('NORMALIZE_FILTER_SPECS forbids labeling a skip-only rule', () => {
  assert.throws(
    () => NORMALIZE_FILTER_SPECS([{ from: 'a@b.com', skipInbox: true, label: 'X' }]),
    /cannot label a skip-only rule|cannot label in a skip-only rule/,
  );
});

test('NORMALIZE_FILTER_SPECS requires a label when staying in inbox', () => {
  assert.throws(
    () => NORMALIZE_FILTER_SPECS([{ from: 'a@b.com', skipInbox: false }]),
    /needs a label when it stays in Inbox/,
  );
});

test('NORMALIZE_FILTER_SPECS accepts a valid label filter and defaults neverSpam/alsoApplyToExisting true', () => {
  const [spec] = NORMALIZE_FILTER_SPECS([{ from: 'a@b.com', skipInbox: false, label: 'Purchases/X' }]);
  assert.equal(spec.from, 'a@b.com');
  assert.equal(spec.label, 'Purchases/X');
  assert.equal(spec.neverSpam, true);
  assert.equal(spec.alsoApplyToExisting, true);
});

test('NORMALIZE_FILTER_SPECS accepts a valid skip-only filter', () => {
  const [spec] = NORMALIZE_FILTER_SPECS([{ from: 'a@b.com', skipInbox: true, hasWords: '"Shipped"' }]);
  assert.equal(spec.skipInbox, true);
  assert.equal(spec.label, '');
});

test('FILTER_ROW_MATCHES_SPEC matches a well-formed label-filter row', () => {
  // Real Gmail settings rows concatenate the trailing "edit"/"delete" link
  // text with no separating whitespace — FILTER_ROW_MATCHES_SPEC's regex
  // relies on that (no `\s*` before the "editdelete" literal).
  const spec = { from: 'a@b.com', skipInbox: false, label: 'Purchases/X', neverSpam: true };
  const row = 'Matches: from:(a@b.com) Do this: Apply label "Purchases/X", Never send it to Spameditdelete';
  assert.equal(FILTER_ROW_MATCHES_SPEC(row, spec), true);
});

test('FILTER_ROW_MATCHES_SPEC rejects a row missing an expected action', () => {
  const spec = { from: 'a@b.com', skipInbox: false, label: 'Purchases/X', neverSpam: true };
  const row = 'Matches: from:(a@b.com) Do this: Apply label "Purchases/X" editdelete';
  assert.equal(FILTER_ROW_MATCHES_SPEC(row, spec), false);
});

test('FILTER_ROW_MATCHES_SPEC rejects a row with mismatched criteria', () => {
  const spec = { from: 'a@b.com', skipInbox: true, neverSpam: true };
  const row = 'Matches: from:(other@b.com) Do this: Skip Inbox, Never send it to Spam editdelete';
  assert.equal(FILTER_ROW_MATCHES_SPEC(row, spec), false);
});

test('list filters clear Gmail prefilled sender and every unused criterion', async () => {
  const { RUN_GMAIL_FILTER_BATCH } = require(path.join(__dirname, '..', '..', 'skills', 'gmail', 'references', 'filters', 'create-filter.js'));
  const values = { From: 'list:(stale.example)', To: 'old@example.com', Subject: 'stale', 'Has the words': 'stale', "Doesn't have": 'stale' };
  const create = { count: async () => 1, click: async () => {}, filter() { return this; }, last() { return this; } };
  const page = {
    waitForTimeout: async () => {},
    locator: () => create,
    getByRole: (role, options) => role === 'textbox'
      ? { fill: async value => { values[options.name] = value; } }
      : { isEnabled: async () => { throw new Error('fixture-stop-before-submit'); } },
  };
  const specs = NORMALIZE_FILTER_SPECS([{ list: 'newsletter.example', skipInbox: true }]);
  const results = await RUN_GMAIL_FILTER_BATCH({ page, navigate: async () => {} }, specs, () => false, async () => null);
  assert.equal(results[0].reason, 'fixture-stop-before-submit');
  assert.deepEqual(values, { From: '', To: '', Subject: '', 'Has the words': 'list:(newsletter.example)', "Doesn't have": '' });
});