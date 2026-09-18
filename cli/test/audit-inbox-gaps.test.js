const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let auditInboxGaps;
test.before(async () => {
  ({ auditInboxGaps } = await import(
    pathToFileURL(path.join(__dirname, '..', '..', 'skills', 'gmail', 'references', 'diagnostics', 'audit-inbox-gaps.mjs')).href
  ));
});

test('sender with no matching filter at all is missing-base', () => {
  const filters = [];
  const senders = [{ email: 'new@sender.com', name: 'New', subject: 'Hello' }];
  const [candidate] = auditInboxGaps(filters, senders);
  assert.equal(candidate.status, 'missing-base');
});

test('sender matched only by a skip-only filter is still missing-base', () => {
  const filters = [{ criteria: { raw: 'from:(a@b.com)' }, label: null, skipInbox: true }];
  const senders = [{ email: 'a@b.com', name: 'A', subject: 'Promo' }];
  const [candidate] = auditInboxGaps(filters, senders);
  assert.equal(candidate.status, 'missing-base');
});

test('sender with a base label filter and no skip filter is covered', () => {
  const filters = [{ criteria: { raw: 'from:(a@b.com)' }, label: 'Purchases/A', skipInbox: false }];
  const senders = [{ email: 'a@b.com', name: 'A', subject: 'Receipt' }];
  const [candidate] = auditInboxGaps(filters, senders);
  assert.equal(candidate.status, 'covered');
});

test('subject not covered by any skip-filter trigger phrase is a keyword-gap', () => {
  const filters = [
    { criteria: { raw: 'from:(a@b.com)' }, label: 'Purchases/A', skipInbox: false },
    { criteria: { raw: 'from:(a@b.com) subject:("Shipped")' }, label: null, skipInbox: true },
  ];
  const senders = [{ email: 'a@b.com', name: 'A', subject: 'Your order was Dispatched' }];
  const [candidate] = auditInboxGaps(filters, senders);
  assert.equal(candidate.status, 'keyword-gap');
  assert.deepEqual(candidate.exampleSubjects, ['Your order was Dispatched']);
});

test('subject covered by an existing skip-filter phrase is covered', () => {
  const filters = [
    { criteria: { raw: 'from:(a@b.com)' }, label: 'Purchases/A', skipInbox: false },
    { criteria: { raw: 'from:(a@b.com) subject:("Shipped")' }, label: null, skipInbox: true },
  ];
  const senders = [{ email: 'a@b.com', name: 'A', subject: 'Your order was Shipped' }];
  const [candidate] = auditInboxGaps(filters, senders);
  assert.equal(candidate.status, 'covered');
});

test('a bare-domain filter matches by substring, matching DUMP_FILTERS behavior', () => {
  const filters = [{ criteria: { raw: 'from:(example.com.au)' }, label: 'Dining/Example', skipInbox: false }];
  const senders = [{ email: 'noreply@example.com.au', name: 'Example Diner', subject: 'Order confirmation' }];
  const [candidate] = auditInboxGaps(filters, senders);
  assert.equal(candidate.status, 'covered');
});

test('candidates are sorted missing-base, keyword-gap, missing-skip, covered', () => {
  const filters = [
    { criteria: { raw: 'from:(covered@b.com)' }, label: 'X', skipInbox: false },
  ];
  const senders = [
    { email: 'covered@b.com', name: 'Covered', subject: 'Hi' },
    { email: 'missing@b.com', name: 'Missing', subject: 'Hi' },
  ];
  const candidates = auditInboxGaps(filters, senders);
  assert.equal(candidates[0].status, 'missing-base');
  assert.equal(candidates[candidates.length - 1].status, 'covered');
});
