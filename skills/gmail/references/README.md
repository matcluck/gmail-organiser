# Gmail Skill Reference Index

This folder contains reusable Gmail automation patterns. Treat it as a small library, not a session log.

## Layout

| Folder | Contents |
|---|---|
| `core/` | Required safety checks, selector rules, filter criteria gotchas, state dumps |
| `filters/` | Filter creation, editing, migration, and triage workflows |
| `labels/` | Label creation, renaming, moving, colors, categories, and label-to-label migrations |
| `cleanup/` | Archive/delete/remove-label workflows for existing mail |
| `diagnostics/` | Lower-level probes for drift investigation |

## Read First

| File | Use For |
|---|---|
| `core/connected-tools.md` | Connected Gmail capability routing, batching, message/thread IDs, and browser fallback |
| `core/stable-selectors.md` | Stable Gmail selector patterns and the current field map |
| `core/filter-criteria-gotchas.md` | Filter criteria that Gmail rejects or warns about |
| `core/dump-state.js` | One-call label/filter inventory before audits; keyword-scoped `_MATCHING` variants avoid the ~100-item truncation cap on large accounts |
| `core/dump-inbox.js` | One-call inbox row → real sender address extraction when no Gmail connector is installed |
| `core/healthcheck.js` | End-to-end drift check before heavy filter work |

## Filter Workflows

| File | Use For |
|---|---|
| `filters/create-filter.js` | One-call Claude/ChatGPT filter batches, exact saved-row verification, and compatibility helpers |
| `filters/create-filter.mjs` | ChatGPT-compatible ESM bridge to the shared filter helpers |
| `filters/edit-filter.js` | Editing or deleting existing filters |
| `filters/retrofit-archive-everything.md` | Converting old skip-inbox filters to inbox-first two-filter pairs |
| `filters/migration-triage.md` | Classifying existing filters before migration |

## Label Workflows

| File | Use For |
|---|---|
| `labels/create-label.js` | Creating labels |
| `labels/rename-label.js` | Renaming labels |
| `labels/move-label.js` | Re-nesting labels |
| `labels/set-label-color.js` | Applying Gmail preset colors |
| `labels/hide-category-labels.js` | Hiding Gmail category labels |
| `labels/migrate-emails-between-labels.md` | Moving mail from one label to another, then removing the source |
| `labels/list-labels.js` | Legacy label listing helper |

## Mail Cleanup

| File | Use For |
|---|---|
| `cleanup/unsubscribe.mjs` | Maintained browser-client unsubscribe batch entrypoint |
| `cleanup/plan-safe-unsubscribe.mjs` | Eligibility from connected metadata; no external unsubscribe URLs |
| `cleanup/bulk-archive.md` | Batch archive by sender |
| `cleanup/archive-from-inbox.js` | Legacy single-sender archive helper |
| `cleanup/delete-from-sender.js` | Bulk delete by sender |
| `cleanup/remove-label-from-emails.js` | Remove a selected label from selected mail |

## Diagnostics

| File | Use For |
|---|---|
| `diagnostics/test-selectors.js` | Lower-level selector probes |
| `diagnostics/test-create-filter-batch.js` | Offline cross-runtime filter helper contract tests |
| `diagnostics/audit-inbox-gaps.mjs` | Standalone Node script: cross-references dumped inbox senders against dumped filters and outputs missing-base/missing-skip/keyword-gap candidates — run with `node`, no browser needed |
| `diagnostics/browser-use-smoke-test.md` | Codex Browser Use UI smoke test without page `evaluate` |

## Public Repo Rules

Do not commit raw Gmail browser snapshots, filter dumps, label dumps, message snippets, account emails, real sender lists, or personal label names. Keep examples generic with `example.com` addresses and placeholder labels.
