---
name: gmail-skill
description: Audit and manage Gmail's browser-only filter settings and label architecture using the matcluck Gmail plugin workflows. Use for Gmail filter audits, rule-contract checks, missing base filters, unsafe skip rules, filter creation or editing, label hierarchy work, and inbox keyword audits. Default to read-only inspection unless the user explicitly approves Gmail changes.
---

# Gmail Skill Bundle

Use the bundled workflow that matches the request:

- Rule or architecture audit: read `skills/gmail/SKILL.md`, then `skills/gmail-audit-rules/SKILL.md`.
- Inbox keyword audit: read `skills/gmail/SKILL.md`, then `skills/gmail-audit-inbox/SKILL.md`.
- Add or edit filters: read `skills/gmail/SKILL.md`, then `skills/gmail-add-rules/SKILL.md`.
- Add labels: read `skills/gmail/SKILL.md`, then `skills/gmail-add-label/SKILL.md`.
- Colour labels: read `skills/gmail/SKILL.md`, then `skills/gmail-colour-labels/SKILL.md`.

Prefer the Gmail connector for messages and label inventory. Use an authenticated browser only for settings that the connector cannot expose, especially Gmail filter definitions.

Run audits read-only first. Do not create, edit, delete, forward, archive, relabel, or otherwise change Gmail state unless the user explicitly approves that exact action after reviewing the audit.

