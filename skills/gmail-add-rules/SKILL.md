---
name: gmail-add-rules
description: Add Gmail persistent filters using the inbox-first two-rule pattern. Use when Codex is asked to create Gmail rules, add filters for a sender or mailing list, label all mail from a sender, create skip-inbox keyword rules, or implement "base/tag plus skip" Gmail automation. Also use for explicit requests like "gmail-add-rules", "Gmail Add Rules", "add a Gmail rule", "add a skip rule", or "make future emails from this sender skip inbox".
---

# Gmail Add Rules

Use this companion workflow to add Gmail filters safely. Also load and follow the core `gmail` skill at `../gmail/SKILL.md` for browser setup, connector use, criteria safety, helper scripts, current-mail cleanup, and verification.

The core `gmail` skill should reference this skill as its rule-creation entrypoint.

## Required Inputs

- `../gmail/SKILL.md`
- `../gmail/references/core/dump-state.js`
- `../gmail/references/filters/create-filter.js`
- `../gmail/references/core/filter-criteria-gotchas.md`
- `~/.config/skills/gmail-skill/filter-overrides.json`, if present
- Example messages or exact sender/list/subject criteria from the user or Gmail connector

## Default Rule Shapes

Base/tag filter:

- Criteria: `from:<sender>` or `list:<list-id>`
- Actions: apply exactly one label, Never Spam
- Must stay in Inbox
- Must not mark read, skip inbox, delete, forward, or star

Specific skip filter:

- Criteria: same sender/list plus one conservative phrase from actual mail
- Actions: Skip Inbox, Never Spam
- Must not apply labels; the base/tag rule labels the message
- Must never mark as read

Broad mailing-list skip filter:

- Criteria: same sender/list as the base/tag filter, with no subject or keyword required
- Actions: Skip Inbox, Never Spam
- Allowed only for dedicated mailing-list/newsletter senders or stable `list:` IDs where all future mail from that identity should be filtered out of Inbox
- Must not apply labels; the base/tag rule labels the message
- Must never mark as read

Targeted security filter:

- Criteria: sender/list plus a security/login/MFA/verification subject or phrase
- Actions: apply `Security`, Never Spam
- Must stay in Inbox
- Use when security mail comes from a mixed product sender and should be visible

## Workflow

1. Identify the sender or mailing-list identity from actual messages. Prefer exact `from:` address unless a stable `list:` identity is present.
2. Identify the label. Use an existing label when possible. If the label is missing, create it through the Gmail connector or core Gmail label helper before opening the filter label dropdown.
3. Dump current filters before editing and check for an existing base/tag filter, matching skip rule, or targeted security rule.
4. Read `~/.config/skills/gmail-skill/filter-overrides.json`; only use a non-standard rule if it is already documented or the user explicitly approves documenting it.
5. Build one ordered spec array containing each missing base/tag filter followed by its approved skip filters. Run it once with the active runtime's batch helper from `../gmail/references/filters/create-filter.js`.
6. For each approved skip rule:
   - For mixed senders, create phrase-specific skip rules separately. Use one phrase-specific skip filter per independently skippable subject pattern.
   - For dedicated mailing-list/newsletter senders or stable `list:` IDs, a broad skip-only second rule with no subject/keyword is allowed after the base/tag rule exists.
7. For security/login/MFA/verification mail, create or confirm a targeted `Security` label rule that keeps Inbox. Do not add skip-inbox unless the user explicitly asks.
8. Apply approved changes to existing matching Inbox mail when appropriate:
   - Base/tag rule: label existing matches when the user wants current mail filed too.
   - Skip rule: archive existing Inbox messages that exactly match the approved skip criteria.
   - Security rule: label matching current messages but keep them in Inbox.
9. Require the batch result to verify each saved filter row by exact criteria and actions. Sender-only verification is not enough. Stop on the first failed spec; do not retry blindly.
10. Verify current Inbox cleanup with the same `in:inbox` search criteria used for the skip rule.

## Decision Rules

- Ask before creating broad skip-inbox rules unless the user has already approved the exact category.
- Do not create skip-only filters for senders without a base/tag filter; create or confirm the base/tag rule first.
- Broad skip-only filters without subject/keyword are allowed only for dedicated mailing-list/newsletter senders or stable `list:` IDs where all future mail should be filtered out of Inbox.
- Do not use broad skip-only filters for mixed senders, security/login, bills, health, finance, human mail, account notices, incidents, or anything likely actionable.
- Do not mark mail as read. Unread state is user-facing triage state.
- Do not add labels to skip-only filters.
- Avoid forbidden filter operators: `is:`, `label:`, `in:`, date ranges, Gmail categories, and stars.
- Avoid warning-prone special characters in filter criteria.
- Keep phrases short, quoted, and copied from actual subjects/snippets.
- If adding multiple skip patterns for the same sender, create separate skip filters instead of grouping unrelated quoted phrases in one rule.
- For list-based rules, preserve and verify the `list:` criterion after edits.

## Two-Filter Examples

Dedicated newsletter sender where every future message should skip Inbox:

```text
Rule 1:
from:(newsletter@example.com)
-> Apply label "Mailing Lists/Example", Never Spam

Rule 2:
from:(newsletter@example.com)
-> Skip Inbox, Never Spam
```

Stable mailing-list ID where every future list message should skip Inbox:

```text
Rule 1:
list:(updates.example.com)
-> Apply label "Mailing Lists/Example Updates", Never Spam

Rule 2:
list:(updates.example.com)
-> Skip Inbox, Never Spam
```

Mixed product sender where only routine receipts should skip Inbox:

```text
Rule 1:
from:(billing@example.com)
-> Apply label "Subscriptions/Example Service", Never Spam

Rule 2:
from:(billing@example.com) "Your receipt"
-> Skip Inbox, Never Spam
```

Mixed account sender where security notices must stay visible:

```text
Rule 1:
from:(account@example.com)
-> Apply label "Subscriptions/Example Service", Never Spam

Rule 2:
from:(account@example.com) "monthly summary"
-> Skip Inbox, Never Spam

Security rule:
from:(account@example.com) subject:(New sign-in)
-> Apply label "Security", Never Spam
```

Do not create a broad skip-only second rule for the mixed account sender. Keep security, billing, health, finance, human, and actionable notices in Inbox unless the user explicitly chooses otherwise.

## Verification Checklist

- Base/tag row exists with expected sender/list, expected label, and Never Spam.
- Skip row exists with expected sender/list, exact phrase, Skip Inbox, and Never Spam.
- Broad mailing-list skip row exists with expected sender/list, Skip Inbox, Never Spam, and no label when that rule shape was approved.
- Targeted security row exists with expected sender/list, expected security criteria, `Security`, and Never Spam.
- No changed row marks read, deletes, forwards, stars, or applies labels on a skip-only rule.
- Matching approved skip messages no longer appear in Inbox.
- Intended security/account messages still appear in Inbox with `Security`.

## Output

Keep the result concise:

- List each rule created or confirmed.
- State current Inbox cleanup performed.
- State verification result.
- Mention any skipped or ambiguous rule that still needs a user decision.
