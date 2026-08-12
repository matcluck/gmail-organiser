---
name: gmail-add-label
description: Create, verify, and optionally apply Gmail labels. Use when Codex is asked to add a Gmail label, create a nested label path, ensure a label exists before creating filters, label current messages from a search, or implement explicit requests like "gmail-add-label", "Gmail Add Label", "make a Gmail label", or "label these emails".
---

# Gmail Add Label

Use this companion workflow to create and apply Gmail labels safely. Also load and follow the core `gmail` skill at `../gmail/SKILL.md` for Gmail connector use, browser setup, label creation references, cleanup expectations, and safety rules.

The core `gmail` skill should reference this skill as its label-creation entrypoint.

## Required Inputs

- `../gmail/SKILL.md`
- `../gmail/references/core/dump-state.js` when browser verification is needed
- `../gmail/references/labels/create-label.js` when browser label creation is needed
- `../gmail/references/labels/set-label-color.js` when creating a nested child label under a coloured parent
- Gmail connector label list/search results when applying labels to current mail

## Workflow

1. Normalize the requested label path exactly enough to avoid duplicates:
   - Preserve user-provided capitalization unless an existing nearby label clearly uses a convention.
   - Use `/` for nested labels, for example `Category/Example Service`.
   - Do not rename or merge existing labels unless explicitly asked.
2. Check whether the label already exists. Prefer Gmail connector `_list_labels`; use Gmail settings label dump when browser state is already open or the connector is insufficient.
3. Create the missing label:
   - Prefer the Gmail connector `_create_label` for ordinary labels.
   - Use the core Gmail browser helper only when connector creation is unavailable or when settings-state verification is already required.
4. For a nested child label, copy the parent label colour to the new child when the parent has an existing colour:
   - Example: after creating `Category/Child`, inspect `Category` and apply the same Gmail preset colour to `Category/Child`.
   - Use `../gmail/references/labels/set-label-color.js` and follow `../gmail-colour-labels/SKILL.md` for colour changes.
   - If the parent is uncoloured, leave the child uncoloured unless the user requested a colour or standard palette.
   - Apply colour only to the newly created/requested child label, not the whole subtree, unless explicitly asked.
5. If the user asked to apply the label to existing mail, search first with the exact approved Gmail query, read a small sample when risk is non-trivial, then apply the label by message ID or with connector bulk labelling.
6. If the user asked to archive while labelling, confirm that archive is intended unless their wording clearly says archive, skip inbox, file away, or label and archive.
7. Verify label creation and current-message application:
   - Re-list labels or dump settings labels.
   - Re-run the search with `label:<Label/Path>` when applying to current messages.
   - For nested child labels with inherited colour, verify the child colour matches the parent colour.
8. Do not create or edit filters unless the user separately asks; hand off to `gmail-add-rules` for persistent rules.

## Financial-year normalization

For a repeatable financial-year label migration, use
`scripts/standardize-fy-labels.mjs` as a planner. It reads a JSON label inventory
from stdin and emits only collision-checked `from`/`to` changes. The convention is
`FYyyyy-yy` (for example, `FY2024-25`); a legacy `FY25` means the financial year
ending in 2025 and becomes `FY2024-25`.

Apply each approved planned change with
`../gmail/references/labels/rename-label.js` and
`RENAME_LABEL_PLAYWRIGHT` in one Gmail settings invocation, then re-dump labels.
Do not restructure parent paths as part of a formatting-only migration.

## Safety Rules

- Never delete, mark read, unsubscribe, forward, star, or change filters from this skill alone.
- Do not apply labels to large or ambiguous result sets without sampling or user confirmation.
- Do not use label IDs in final user-facing descriptions; use display names.
- For labels created while Gmail settings is already open, reload settings before selecting that label in a filter dropdown.
- If a label path is ambiguous because both parent and child labels exist, verify the exact full path before applying it.
- Do not overwrite an existing child label colour unless the user asks to normalize or inherit from the parent.

## Common Patterns

Create only:

1. Confirm or create the label.
2. If it is a new child label and the parent is coloured, apply the parent colour to the child.
3. Report whether it was new or already existed.

Create and apply to current mail:

1. Confirm or create the label.
2. Search with the approved query.
3. Apply the label to matching messages.
4. Verify labelled results.

Create before filter work:

1. Confirm or create the label.
2. If it is a new child label and the parent is coloured, apply the parent colour to the child.
3. Reload Gmail settings if the browser filter UI is open.
4. Continue with `gmail-add-rules`.

## Output

Keep the result compact:

- Label created or already present.
- Query used for any current-message labelling.
- Number of messages labelled or archived.
- Colour inherited from parent, if applicable.
- Verification result.
