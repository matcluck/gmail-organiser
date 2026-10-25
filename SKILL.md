---
name: gmail-skill
description: Audit and manage Gmail inbox mail, filters and label architecture using connected Gmail tools and browser helpers for unsupported settings. Use for Gmail filter audits, rule-contract checks, missing base filters, unsafe skip rules, filter creation or editing, label hierarchy work, and inbox keyword audits. Default to read-only inspection unless the user explicitly approves Gmail changes.
---

# Gmail Skill Bundle

Use the bundled workflow that matches the request:

- Rule or architecture audit: read `skills/gmail/SKILL.md`, then `skills/gmail-audit-rules/SKILL.md`.
- Inbox keyword audit: read `skills/gmail/SKILL.md`, then `skills/gmail-audit-inbox/SKILL.md`.
- Add or edit filters: read `skills/gmail/SKILL.md`, then `skills/gmail-add-rules/SKILL.md`.
- Add labels: read `skills/gmail/SKILL.md`, then `skills/gmail-add-label/SKILL.md`.
- Colour labels: read `skills/gmail/SKILL.md`, then `skills/gmail-colour-labels/SKILL.md`.

Discover current Gmail tools and follow `skills/gmail/references/core/connected-tools.md`. Prefer connected search, metadata, counts and batch mail changes. Use the authenticated browser only for unsupported operations, especially filter definitions and native unsubscribe. This skill does not add API access; its JavaScript and CLI browser drivers still operate the frontend.

For scripted or repeatable runs outside an agent turn (or when you just want a real terminal instead of a tool call per action), see `cli/README.md` — a Node CLI that wraps the same `references/**` helpers over CDP against an already-authenticated Chrome window.

Read private configuration from `~/.config/skills/gmail-skill/`. Do not place user-specific rules or mailbox data in the skill directory or its repository.

Run audits read-only first. Do not create, edit, delete, forward, archive, relabel, or otherwise change Gmail state unless the user explicitly approves that exact action after reviewing the audit.
