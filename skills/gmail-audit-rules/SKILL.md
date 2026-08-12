---
name: gmail-audit-rules
description: Audit existing Gmail filters against the inbox-first two-rule contract, identify missing base filters, unsafe skip filters, mark-as-read violations, missing Never Spam, duplicate/ambiguous filters, and documented override exceptions. Use for gmail:audit-rules, /gmail:audit-rules, "audit Gmail rules", "check my Gmail filters", or any request to review existing Gmail filter configuration.
---

# Gmail Audit Rules

Use this workflow skill for existing filter audits. Also load and follow the core `gmail` skill at `../gmail/SKILL.md` for browser setup, state dumps, filter mechanics, criteria safety, and cleanup rules.

The core `gmail` skill should reference this skill as its rule-audit entrypoint.

## Required Inputs

- `../gmail/references/core/dump-state.js`
- `../gmail/references/filters/existing-rule-audit.md`
- `scripts/audit-filter-state.mjs`
- `../gmail/references/core/filter-criteria-gotchas.md`
- `~/.config/skills/gmail-skill/filter-overrides.json`, if present

## Workflow

1. Start from Gmail settings and dump labels plus filters with `DUMP_LABELS` and `DUMP_FILTERS`.
2. Read `~/.config/skills/gmail-skill/filter-overrides.json`; if absent, treat overrides as empty. Pass its complete schema-versioned object to `scripts/audit-filter-state.mjs` as `overrides`.
3. Classify filters deterministically with `scripts/audit-filter-state.mjs`; use `../gmail/references/filters/existing-rule-audit.md` to interpret review-only cases.
4. Report counts first, then only concrete exceptions that need decisions or edits.
5. Do not paste raw Gmail exports into chat.
6. If edits are approved, use `../gmail/references/filters/create-filter.js` and `edit-filter.js`.
7. Verify changed filter rows after edits.

## Contract Summary

- Base/tag filters apply exactly one label, stay in inbox, and use Never Spam.
- Targeted security/login/MFA/verification rules may label `Security`, stay in Inbox, and use Never Spam.
- Specific skip filters skip inbox and use Never Spam, with no label.
- No filter marks mail as read.
- Delete/forward/star filters require explicit review or an override.
- Any intentional non-standard rule belongs in `~/.config/skills/gmail-skill/filter-overrides.json` and must match both criteria and expected actions.

## Output

Use this order:

1. Audit counts by category.
2. High-risk findings: mark-as-read, delete/forward, missing base for skip filters.
3. Contract drift: specific filters applying labels, missing Never Spam, duplicates.
4. Questions or proposed fixes.

Keep the response compact enough for the user to make decisions.
