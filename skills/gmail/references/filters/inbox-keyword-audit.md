# Inbox Keyword Audit

Use this for `gmail:audit-inbox` or when the user asks to inspect inbox messages and decide whether skip-filter keywords should be updated.

## Goal

Find recurring, already-labelled inbox messages that should have been skipped by an existing specific skip filter but did not match its current keywords.

## Inputs

- Current inbox messages from the Gmail connector, excluding spam/trash and normally excluding promotions unless the user asks otherwise.
- Current filter dump from `references/core/dump-state.js` -> `DUMP_FILTERS`.
- `~/.config/skills/gmail-skill/filter-overrides.json`, if present.

## Workflow

1. Collect recent inbox messages in batches.
2. Group by sender/domain and existing label.
3. Ignore human, health, bills, security, appointments, and anything likely actionable.
4. For each recurring automated sender, compare inbox subjects/snippets against existing skip filters for the same sender/list identity.
5. Recommend keyword additions only when they are conservative and sender-specific for mixed senders. For dedicated mailing-list/newsletter senders or stable `list:` IDs where all future mail should skip Inbox, recommend a broad sender/list skip-only rule only after user approval.
6. Do not use forbidden Gmail filter operators or warning-prone special characters; follow `references/core/filter-criteria-gotchas.md`.
7. Do not add `Mark as read`.
8. Do not add labels to specific skip filters; the base/tag rule labels everything.
9. Before editing filters, present a compact batch plan unless the user has already authorized applying safe updates.
10. After creating or editing an approved skip filter, apply the same criteria to existing matching Inbox messages by archiving them, unless the user explicitly opts out.

## Interview First

Inbox keyword auditing is preference-dependent. Before making broad skip changes, interview the user with grouped candidates and ask for one of:

- `skip`
- `keep inbox`
- `ask each time`

Never infer that a category is noise just because it is automated. Security, login, verification, health, appointments, bills, and closure/incident notices default to `keep inbox` unless the user explicitly says otherwise.

## Applying Approved Skips

For groups the user marks `skip`:

- Prefer editing an existing phrase-specific skip filter by adding conservative keywords for mixed senders.
- For dedicated mailing-list/newsletter senders or stable `list:` IDs, a broad sender/list skip-only rule with Skip Inbox + Never Spam is allowed when the user approves filtering all future mail from that identity.
- If no skip filter exists but a base/tag filter exists, create the approved skip filter with Skip Inbox + Never Spam only.
- Do not create skip-only filters for senders that do not already have a base/tag filter; create or confirm the base/tag rule first.
- Do not use broad sender/list skip-only rules for mixed senders, security/login, bills, health, finance, human mail, account notices, incidents, or anything likely actionable.
- Use precise criteria for mixed senders so wanted notices stay in inbox. For example, if the user wants facility marketing and routine updates skipped but temporary closures kept, match only the routine/update subjects and leave closure keywords unmatched.
- Apply the same approved skip criteria to existing inbox messages after the filter update. Prefer the core `gmail` helper's `alsoApplyToExisting` option for normal-sized approved changes. For high-risk or large backfills, leave `alsoApplyToExisting` off, then use the Gmail connector to search `in:inbox` with the exact approved criteria and archive those message IDs after review.
- Archiving is not marking read and is not deleting. It only removes the `INBOX` label.
- Verify with the same `in:inbox` search after archiving.
- If the approved criteria intentionally leaves exceptions in inbox, verify at least one exception query when practical. Example: if pool updates should skip but temporary closures should remain visible, verify the closure query still returns matching inbox messages.

## Output Format

Group findings by action:

- `update keywords`: sender, existing label, current surfaced examples, proposed keyword additions.
- `leave in inbox`: actionable or uncertain messages.
- `needs user decision`: ambiguous marketing vs useful updates.

Keep proposed keywords short, plain text, and reusable. Prefer phrases visible in multiple examples or highly distinctive sender language.
