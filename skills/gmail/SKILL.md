---
name: gmail
description: Shared Gmail automation skill for labels, persistent filters, browser-driven Gmail settings, Gmail connector cleanup, filter criteria safety, and the inbox-first two-rule filter strategy. Use whenever Codex needs to interact with Gmail, create or edit Gmail labels/filters, archive/delete/search mail, audit Gmail state, or support companion skills gmail-add-rules, gmail-add-label, gmail-audit-rules, and gmail-audit-inbox.
---

# Gmail

Use this as the core Gmail operating manual. Companion skills:

- `gmail-audit-rules`: audits existing filters against the contract.
- `gmail-audit-inbox`: audits inbox messages and interviews the user for new/updated rules.
- `gmail-add-rules`: creates base/tag, skip-inbox, and targeted security filters.
- `gmail-add-label`: creates, verifies, and optionally applies labels.
- `gmail-colour-labels`: applies and standardizes Gmail label colours.

If one companion skill triggers, also follow this core skill for Gmail setup, safety, selectors, batching, and cleanup mechanics.

## Session Checklist

Before Gmail work:

- Load browser automation tools when persistent Gmail filters/settings are involved.
- Use the Gmail connector for message search/read/archive/label actions when it is safer or lower-cost.
- Snapshot current Gmail state for audits with `references/core/dump-state.js`.
- Read `~/.config/skills/gmail-skill/filter-overrides.json` if filter contract exceptions matter. If absent, treat overrides as empty.
- Keep browser work sequential; Gmail uses one shared browser session.
- Estimate call cost. Prefer the helpers in `references/filters/create-filter.js` over hand-clicking repeated flows.

## Browser Setup

For persistent Gmail filters and label settings:

1. Navigate to `https://mail.google.com/mail/u/0/#settings/filters`.
2. If not logged in, ask the user to log in manually. Never automate login.
3. Resize to at least `1500x950`; Gmail hides parts of the filter dialog in narrower viewports.
4. Dump labels and filters before audit or bulk edits:
   - labels: `#settings/labels` + `DUMP_LABELS`
   - filters: `#settings/filters` + `DUMP_FILTERS`

If Playwright MCP connects only to `127.0.0.1:9222`, start Chromium with the user's normal profile when needed:

```bash
chromium --remote-debugging-port=9222 --no-first-run --no-default-browser-check
```

Close the browser process you started before finishing.

## Rule Contract

Default to the inbox-first two-rule pattern for recurring senders/lists.

Intent beats sender grouping:

- Security, login, MFA, verification-code, unrecognized-device, password/PIN reset, and account-protection notices default to label `Security` and stay in Inbox, even when sent by a subscription/product service.
- Non-security billing, product, subscription, newsletter, and usage notices use the relevant service subscription label.
- Do not create skip-inbox rules for security/login-code mail unless the user explicitly asks.

Base/tag filter:

- Criteria: `from:<sender>` or `list:<list-id>`
- Actions: apply exactly one label, Never Spam
- Must stay in Inbox
- Must not mark read, skip inbox, delete, forward, or star

Specific skip filter:

- Criteria: same sender/list plus conservative sender-specific keywords
- Actions: Skip Inbox, Never Spam
- Must not apply labels; the base/tag filter labels matching mail
- Must never mark as read

Broad mailing-list skip filter:

- Allowed only for dedicated mailing-list/newsletter senders or stable `list:` IDs where all future mail from that identity should be filtered out of Inbox.
- Criteria: same sender/list as the base/tag filter, with no subject or keyword required.
- Actions: Skip Inbox, Never Spam
- Must not apply labels or mark read; the base/tag filter handles labeling.
- Do not use for mixed senders, security/login, bills, health, finance, human mail, account notices, incidents, or anything likely actionable.

Document deliberate exceptions in `~/.config/skills/gmail-skill/filter-overrides.json`. The file is private, agent-neutral configuration: use schema version 1, an `overrides` array, exact `criteria`, and `expectedActions`. An exception ceases to match if any action changes.

## Core References

Read only the files needed for the current operation:

- `references/README.md`: reference index
- `references/core/dump-state.js`: one-call label/filter inventory
- `references/core/filter-criteria-gotchas.md`: forbidden operators and special characters
- `references/core/stable-selectors.md`: selector patterns
- `references/filters/create-filter.js`: low-call filter creation helpers
- `references/filters/edit-filter.js`: edit/delete existing filters
- `references/cleanup/bulk-archive.md`: retroactive Inbox cleanup
- `references/cleanup/unsubscribe.js`: Gmail-native one-click unsubscribe helper
- `references/labels/create-label.js`: label creation
- `../gmail-add-rules/SKILL.md`: rule creation workflow entrypoint
- `../gmail-add-label/SKILL.md`: label creation and application workflow entrypoint
- `../gmail-colour-labels/SKILL.md`: label colour workflow entrypoint

## Low-Call Filter Creation

Prefer `references/filters/create-filter.js` helpers:

- `CODEX_CREATE_LABEL_FILTER_PLAYWRIGHT`: create a base/tag or label-applying filter in one `browser_run_code_unsafe` call.
- `CODEX_CREATE_SKIP_FILTER_PLAYWRIGHT`: create a skip-only filter in one `browser_run_code_unsafe` call.
- `CODEX_CREATE_LABEL_FILTER`: create a base/tag or label-applying filter.
- `CODEX_CREATE_SKIP_FILTER`: create a skip-only filter.

Prefer the `*_PLAYWRIGHT` helpers when `browser_run_code_unsafe` is available. Gmail label dropdown options require real Playwright locator clicks; in-page `browser_evaluate` DOM clicks can open and close the dropdown without selecting the label.

All helpers support `alsoApplyToExisting`. Use it when the approved change should immediately affect matching existing conversations. For high-risk or large backfills, leave it off and do a reviewed connector search/archive pass.

If labels were created through the Gmail connector while Gmail settings is open, reload `#settings/filters` before opening the label dropdown. The label may exist in the DOM while the overlay is stale.

## Optimize And Patch

Speed is part of correctness for Gmail work. Before repeating a browser action, ask whether it can be batched into one `browser_evaluate` or done server-side with the Gmail connector.

Targets:

- State dump: one evaluate for labels and one evaluate for filters.
- Label/base filter creation: one `browser_run_code_unsafe` call when available.
- Skip-only filter creation: one `browser_run_code_unsafe` call when available.
- Current-mail cleanup: one connector search plus one archive/label batch where practical.

If an existing helper is wrong, brittle, or causes extra calls:

1. Stop using the broken path for repeated work.
2. Debug the minimum reliable DOM/API sequence.
3. Patch the helper or reference under this skill immediately.
4. Syntax-check or otherwise validate the patch.
5. Continue with the updated reusable path.

Do not leave session-only JavaScript as the only copy of a discovered fix. Put reusable Gmail behavior in `references/` or this `SKILL.md`.

## Criteria Safety

Do not use these in Gmail filter criteria: `is:`, `label:`, `in:`, `before:`, `after:`, `category:`, `has:yellow-star`, `older_than:`, `newer_than:`.

Avoid warning-prone special characters in keyword fields: `% [ ] ( ) & # * ! $ £ :`.

Use short quoted phrases from actual subjects/snippets when creating private filters. In public skill docs, use synthetic examples such as `"weekly digest"` or `"receipt available"`.

## Cleanup

For current mail:

- Use Gmail connector searches with `in:inbox ... -in:spam -in:trash`.
- Archive by message IDs; archiving removes `INBOX` only.
- Verify by rerunning the same `in:inbox` query.

Do not delete, mark read, or unsubscribe unless the user explicitly asks.

## Safe unsubscribe

Only unsubscribe when the user explicitly asks and all of these are true:

1. The message has `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
2. Sender authentication is aligned (SPF or DKIM passes for the visible sender domain).
3. Gmail exposes its own exact `Unsubscribe` control for that message.

Use `references/cleanup/unsubscribe.js` and
`GMAIL_NATIVE_UNSUBSCRIBE_PLAYWRIGHT`. Never extract, open, navigate to, or
follow an unsubscribe, preference-centre, tracking, or any other link inside
an email. Do not use a mailto fallback. If any precondition fails, report the
sender as not safely automatable and offer only a user-directed manual route.

## Skill Maintenance

When discovering reusable Gmail behavior, update this skill or the relevant reference. Keep examples generic and do not commit raw Gmail exports, snapshots, message subjects, account emails, or personal sender lists.

Skill and reference files must be reusable instructions, not worklogs. Do not append session notes, "what I did", timestamps from the current run, raw audit outcomes, user-specific examples, or bottom-of-file progress summaries. Convert discoveries into generic guardrails, examples, or helper code.

If a companion skill uncovers a Gmail workflow issue, patch the core `gmail` skill first, then continue the audit or cleanup.
