const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const core = require(path.join(__dirname, '..', '..', 'skills', 'gmail', 'references', 'core', 'gmail-dom.js'));
const { normalizeSpec, criteriaHash, parseFilterRow, rowMatchesSpec } = core.pure;

test('normalizeSpec requires a sender identity', () => {
  assert.equal(normalizeSpec({ skipInbox: true }).ok, false);
  assert.equal(normalizeSpec({ from: 'a@b.com', skipInbox: true }).ok, true);
  assert.equal(normalizeSpec({ list: 'updates.example.com', skipInbox: true }).ok, true);
});

test('normalizeSpec requires an explicit skipInbox boolean', () => {
  assert.match(normalizeSpec({ from: 'a@b.com', label: 'X' }).error, /explicit boolean/);
  assert.equal(normalizeSpec({ from: 'a@b.com', label: 'X', skipInbox: false }).ok, true);
});

test('normalizeSpec enforces the two-rule contract', () => {
  const both = normalizeSpec({ from: 'a@b.com', label: 'X', skipInbox: true });
  assert.equal(both.ok, false);
  assert.match(both.error, /must not apply a label/);
});

test('normalizeSpec refuses actions the contract never allows', () => {
  assert.match(normalizeSpec({ from: 'a@b.com', skipInbox: true, markAsRead: true }).error, /markAsRead/);
  assert.match(normalizeSpec({ from: 'a@b.com', skipInbox: true, delete: true }).error, /delete/);
});

test('normalizeSpec refuses a spec that would do nothing', () => {
  assert.match(normalizeSpec({ from: 'a@b.com', skipInbox: false }).error, /does nothing/);
});

test('normalizeSpec defaults neverSpam on and alsoApplyToExisting off', () => {
  const { spec } = normalizeSpec({ from: 'a@b.com', skipInbox: true });
  assert.equal(spec.neverSpam, true);
  assert.equal(spec.alsoApplyToExisting, false);
  assert.equal(normalizeSpec({ from: 'a@b.com', skipInbox: true, neverSpam: false }).spec.neverSpam, false);
});

test('criteriaHash encodes criteria into the create-filter route', () => {
  const h = criteriaHash({ from: 'a@b.com', hasWords: '"weekly digest"' });
  assert.ok(h.startsWith('#create-filter/'));
  assert.ok(h.includes('from=a%40b.com'));
  assert.ok(h.includes('has=%22weekly%20digest%22') || h.includes('has=%22weekly+digest%22'));
});

test('criteriaHash folds a list identity into the has-words field', () => {
  assert.ok(criteriaHash({ list: 'updates.example.com' }).includes('list%3Aupdates.example.com'));
});

test('parseFilterRow splits criteria from actions and strips the row UI text', () => {
  const row = parseFilterRow('Matches: from:(news@example.com) "weekly digest"Do this: Skip Inbox, Never send it to Spameditdelete');
  assert.equal(row.criteria, 'from:(news@example.com) "weekly digest"');
  assert.equal(row.skipInbox, true);
  assert.equal(row.neverSpam, true);
  assert.equal(row.label, null);
  assert.ok(!row.actions.join(' ').includes('editdelete'));
});

test('parseFilterRow extracts an applied label', () => {
  const row = parseFilterRow('Matches: from:(news@example.com)Do this: Apply label "Subscriptions/Example", Never send it to Spam');
  assert.equal(row.label, 'Subscriptions/Example');
  assert.equal(row.skipInbox, false);
});

test('parseFilterRow returns null for a non-filter row', () => {
  assert.equal(parseFilterRow('Create a new filter'), null);
});

test('rowMatchesSpec confirms a saved base/tag rule', () => {
  const row = parseFilterRow('Matches: from:(news@example.com)Do this: Apply label "Subscriptions/Example", Never send it to Spam');
  const { spec } = normalizeSpec({ from: 'news@example.com', label: 'Subscriptions/Example', skipInbox: false });
  assert.equal(rowMatchesSpec(row, spec), true);
});

test('rowMatchesSpec rejects a row that lost its keyword', () => {
  const row = parseFilterRow('Matches: from:(news@example.com)Do this: Skip Inbox, Never send it to Spam');
  const { spec } = normalizeSpec({ from: 'news@example.com', hasWords: '"weekly digest"', skipInbox: true });
  assert.equal(rowMatchesSpec(row, spec), false);
});

test('rowMatchesSpec rejects a row whose label substituted', () => {
  const row = parseFilterRow('Matches: from:(news@example.com)Do this: Apply label "Wrong/Label", Never send it to Spam');
  const { spec } = normalizeSpec({ from: 'news@example.com', label: 'Subscriptions/Example', skipInbox: false });
  assert.equal(rowMatchesSpec(row, spec), false);
});

test('rowMatchesSpec rejects any row that marks mail as read', () => {
  const row = parseFilterRow('Matches: from:(news@example.com)Do this: Skip Inbox, Mark as read, Never send it to Spam');
  const { spec } = normalizeSpec({ from: 'news@example.com', skipInbox: true });
  assert.equal(rowMatchesSpec(row, spec), false);
});

test('the core exports its own source for drivers to inject', () => {
  const src = core.source();
  assert.ok(src.includes('installGmailDom'));
  assert.ok(src.length > 1000);
});
