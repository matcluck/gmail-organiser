---
name: gmail-colour-labels
description: Apply, standardize, audit, or bulk update Gmail label colours using the existing Gmail browser automation helpers. Use when Codex is asked to colour/color Gmail labels, auto-colour labels, standardize a Gmail label palette, set label colours from a mapping, or review Gmail label colour consistency.
---

# Gmail Colour Labels

Use this companion workflow to apply Gmail label colours safely. Also load and follow the core `gmail` skill at `../gmail/SKILL.md` for browser setup, sequential Gmail automation, state dumps, safety rules, and cleanup expectations.

The core `gmail` skill should reference this skill as its label-colour entrypoint.

## Required Inputs

- `../gmail/SKILL.md`
- `../gmail/references/core/dump-state.js`
- `../gmail/references/labels/set-label-color.js`
- Current Gmail labels from settings before making changes

## Workflow

1. Open Gmail with the browser setup from the core `gmail` skill and navigate to the label sidebar or `#settings/labels` as needed.
2. Dump current labels before making changes. Do not persist or commit raw Gmail exports, account emails, or personal label lists.
3. Read `../gmail/references/labels/set-label-color.js` before applying colours.
   - Use the authenticated browser session; do not install or invoke an ad-hoc
     browser package to colour labels.
   - Apply a deterministic, sequential batch and verify each parent-dialog choice.
4. If the user supplied an explicit label-to-colour mapping, apply that mapping exactly, using only Gmail preset RGB values.
5. If the user asked for automatic or standardized colouring, propose a compact mapping first unless the requested policy is already explicit.
   - When preserving an existing parent label colour, still include uncoloured child labels under that parent in the proposed batch so the subtree stays visually consistent.
6. Apply colours sequentially inside one browser session. Prefer one scripted batch over many MCP hover/click calls when possible.
7. Verify by rechecking visible labels or settings state after changes.

Do not create, rename, move, delete, archive, mark read, unsubscribe, or change filters unless the user separately asks. This skill is only for label colours.

## Default Colour Policy

Use Gmail preset colours only. Prefer stable category intent over sender/product branding:

| Intent | RGB |
|---|---|
| Security, login, MFA, account protection | `251, 76, 47` |
| Finance, bills, tax, banking | `22, 167, 101` |
| Purchases, deliveries, receipts | `255, 117, 55` |
| Travel, events, bookings | `30, 83, 184` |
| Work, projects, tools | `45, 162, 187` |
| Personal, community, family | `120, 88, 195` |
| Newsletters, marketing, low-priority subscriptions | `194, 194, 194` |
| Reference, archives, neutral system mail | `231, 231, 231` |

When a label path has parent and child labels, colour only the requested label by default. If Gmail asks whether to apply a parent colour to sublabels, choose the option for the named label only unless the user explicitly requested inheritance.

Before a batch, inspect the currently rendered Gmail palette. The palette may
change: do not attempt an RGB value that Gmail does not offer. For the standard
policy above, use the listed current Gmail presets; if a preset is unavailable,
stop and report the nearest available candidate rather than silently choosing one.

## Rainbow Mode

When the user asks for a rainbow recolour, order top-level labels by their
rendered top-to-bottom sidebar order. Apply this repeating Gmail-preset cycle
to each root and choose the "and its sublabels" option: red `251, 76, 47`,
orange `255, 117, 55`, amber `255, 173, 70`, yellow `251, 233, 131`, green
`66, 214, 146`, green `22, 167, 101`, teal `45, 162, 187`, blue
`30, 83, 184`, purple `120, 88, 195`, magenta `194, 24, 91`.

Use only when the user explicitly requests rainbow mode; it intentionally
overrides the semantic category palette. Re-dump or reload the sidebar when
Gmail virtualizes/collapses labels, and verify the visible roots after the pass.

## Safety Notes

- Ask before bulk recolouring existing labels when no exact mapping was provided.
- Preserve user-assigned colours for labels that are outside the approved mapping.
- If a requested colour is not a Gmail preset, choose the nearest preset and mention the substitution.
- If a label cannot be found, stop and re-dump labels before retrying. Do not guess renamed or nested labels.
