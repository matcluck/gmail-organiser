---
name: gmail-audit-inbox
description: Audit Gmail inbox messages for recurring senders that need base/tag filters or conservative skip-inbox keyword filters, then interview the user in batches of up to 8 proposed rule changes. Use for gmail:audit-inbox, /gmail:audit-inbox, "audit my inbox", "filter out inbox noise", "look at my inbox and interview me", or requests to find Gmail messages that should automatically skip inbox.
---

# Gmail Audit Inbox

Use this workflow skill to inspect current Inbox mail and interview the user before changing rules. Also load and follow the core `gmail` skill at `../gmail/SKILL.md` for Gmail connector use, browser setup, rule contract, criteria safety, and filter creation.

The core `gmail` skill should reference this skill as its inbox-audit entrypoint.

## Required Inputs

- Gmail connector inbox search/read results
- `../gmail/references/core/dump-state.js`
- `../gmail/references/filters/inbox-keyword-audit.md`
- `../gmail/references/core/filter-criteria-gotchas.md`
- `~/.config/skills/gmail-skill/filter-overrides.json`, if present

## Workflow

1. Search Inbox excluding spam/trash. Start with current Inbox unless the user asks for a wider window.
2. Group messages by sender/list identity, existing label, and apparent intent.
3. Ignore or default-keep actionable categories: human mail, health, appointments, bills, security, verification/login, closures/incidents, finance, government, and anything requiring response.
4. Compare recurring automated senders against existing base/tag and specific skip filters.
5. Suppress low-value candidates where the current message already has the recommended label, should remain in Inbox, and no missing or unsafe persistent rule needs a decision.
6. Prepare an interview batch with up to 8 candidates, numbered `1.` through `8.` so the user can answer with compact decisions like `1 keep, 2 skip`.
   - Use low-cognitive decision mode: infer the safest category and propose a default action for each item.
   - End the batch with compact reply shortcuts so the user can approve or override without rethinking labels from scratch.
7. Ask for decisions before broad changes unless the user has already authorized safe obvious updates.
8. Apply approved changes sequentially with the core `gmail` helpers.
9. Verify persistent filter rows and current Inbox cleanup searches.
10. After a round is applied and verified, continue the audit by presenting the next numbered batch of candidates. Stop only when there are no more useful candidates or the user asks to pause.

## Interview Format

Use this compact format for each candidate:

```text
1. **Sender name** (`sender@example.com`)
Examples: "subject 1", "subject 2"

Recommended: label `Label/Path`, keep inbox
Why: security/account/bill/actionable/etc.
Other easy replies: archive · label+archive · skip future · ignore sender
```

Keep each batch to 8 candidates or fewer. Number every candidate starting at `1.` in each new round.

At the end of every batch, include:

```text
Reply shortcuts: `ok all`, `1 archive`, `2 skip future`, `3 label Purchases/Foo`, `4 keep`.
```

If a candidate has an obvious recommended default, phrase it so the user can simply say `ok all except 3 archive`.

Do not include a candidate when all of these are true:

- The message already has the recommended label.
- The safest recommendation is keep Inbox.
- There is no missing base/tag filter, missing security filter, unsafe filter, duplicate label cleanup, or current-mail cleanup decision needed.

In that case, silently treat the item as already handled. Mention it only in a brief audit summary if useful, not in the decision batch.

## Decision Rules

- Default to the inbox-first two-rule pattern.
- Create or confirm a base/tag filter before creating a skip-only filter.
- Skip filters do not apply labels and never mark read.
- Use conservative sender-specific keywords from actual messages for mixed senders.
- For dedicated mailing-list/newsletter senders or stable `list:` IDs where all future mail should be filtered out of Inbox, an approved broad skip-only second rule may use only the sender/list criterion with no subject or keyword.
- Do not propose broad skip-only rules for mixed senders, security/login, bills, health, finance, human mail, account notices, incidents, or anything likely actionable.
- If a sender is pure unsubscribe/manual cleanup, do not create rules unless the user asks.
- If labels were just created through the connector, reload Gmail settings before using the filter label dropdown.
- Reduce user decision load by mapping each candidate into one of these default actions:
  - `keep`: security, verification/login, government, bills, health, appointments, incidents, human/actionable.
  - `label+keep`: useful account, finance, purchase, certification, travel, or project mail that should stay visible.
  - `label+archive`: receipts, old confirmations, completed transactions, and filed reference mail.
  - `skip future`: recurring non-actionable notifications where a base/tag filter already exists or will be created first.
  - `archive current`: unsubscribe/manual cleanup or one-off stale messages where no future rule is needed.
  - `ignore sender`: unwanted mail where unsubscribe/manual cleanup is better than a rule.
- For subscription/service senders, split security from product/account mail:
  - Security, login, MFA, verification code, unrecognized device, password/PIN reset, and account-protection notices default to `Security` + keep Inbox.
  - Non-security billing, product, subscription, newsletter, and usage notices use the service subscription label.
  - Do not propose skip rules for security/login code mail unless the user explicitly asks.

## Applying Approved Changes

For approved candidates:

1. Create missing labels first.
2. Create or verify the base/tag filter.
3. Create or edit the approved skip filter:
   - mixed sender: phrase-specific skip filter
   - dedicated mailing list/newsletter: broad sender/list skip-only filter if the user approved filtering all future mail
4. Use `alsoApplyToExisting` when the approved change should immediately affect existing conversations, or do a reviewed connector archive pass for large/high-risk backfills.
5. Verify with:
   - settings filter row extraction
   - `in:inbox` search for the skip criteria
   - all-mail/label search for expected archived labelled messages
6. Present the next numbered interview batch after verification, unless the user asked to stop or no further candidates remain.

Do not delete, mark read, or unsubscribe unless explicitly requested.
