# Existing Rule Audit

Use this for `gmail:audit-rules` or when the user asks whether current Gmail filters conform to the desired pattern.

## Inputs

- `references/core/dump-state.js` -> `DUMP_FILTERS`
- `references/core/dump-state.js` -> `DUMP_LABELS`
- `~/.config/skills/gmail-skill/filter-overrides.json`, if present

Read the override file before classifying anything. If it is missing, treat overrides as empty. Each override must include exact criteria and expected actions so that a changed forwarding recipient or action is reported again.

## Rule Contract

- Every recurring sender/list group has a base/tag filter.
- A base/tag filter applies exactly one label, stays in inbox, does not mark as read, does not delete/forward/star, and uses `Never send it to Spam`.
- Targeted security/login/MFA/verification rules may apply label `Security`, stay in inbox, and use `Never send it to Spam` even when they are narrower than the service's non-security base rule.
- A phrase-specific skip filter may skip inbox and use `Never send it to Spam`.
- A broad mailing-list skip filter may use only the same sender/list criterion as the base/tag rule, skip inbox, and use `Never send it to Spam` when the sender/list identity is dedicated to mailing-list/newsletter mail.
- Skip filters must not apply a label; the base/tag filter handles labeling.
- No Gmail filter should ever mark mail as read.
- Any exception must be documented in `~/.config/skills/gmail-skill/filter-overrides.json`.

## Audit Checks

Classify current filters into:

- `ok_base`: base/tag filters that satisfy the contract.
- `ok_security_specific`: targeted security rules that label `Security`, stay in inbox, and satisfy the contract.
- `ok_specific_skip`: phrase-specific skip filters that satisfy the contract.
- `ok_mailing_list_skip`: broad mailing-list/newsletter skip filters that satisfy the contract.
- `override`: filters matching the exact criteria and expected actions in `filter-overrides.json`.
- `missing_base`: sender/list groups with specific filters but no base/tag filter.
- `base_missing_never_spam`: base/tag filters without `Never send it to Spam`.
- `specific_applies_label`: specific skip filters that apply a label.
- `marks_read`: any filter with `Mark as read`.
- `missing_never_spam`: non-delete/non-forward filters without `Never send it to Spam`.
- `destructive_or_forwarding`: delete/forward filters for manual review.
- `unclassified`: anything that does not fit the above.

Report counts first, then list only the concrete exceptions that need decisions or edits. Do not paste full raw Gmail exports into chat.
