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

- Discover the currently exposed Gmail tools first. Prefer the connected tools for supported counts, searches, reads, labels and archives; do not open a browser for those operations by default.
- Read `references/core/connected-tools.md` for operation routing, batching, ID types and verification. Tool availability can change between turns; a prior missing connection is not a permanent limitation.
- Use a browser only for an operation the connected tools do not expose, such as persistent filters, label colours or Gmail-native unsubscribe. Snapshot only the settings needed for that operation with `references/core/dump-state.js`.
- Read `~/.config/skills/gmail-skill/filter-overrides.json` if filter contract exceptions matter. If absent, treat overrides as empty.
- Keep browser work sequential; Gmail uses one shared browser session.
- Estimate call cost. Prefer the helpers in `references/filters/create-filter.js` over hand-clicking repeated flows.

## Browser Setup

For unsupported filter definitions or label settings only; native unsubscribe opens the selected message directly using the maintained helper:

1. Navigate to `https://mail.google.com/mail/u/0/#settings/filters`.
2. If not logged in, ask the user to log in manually. Never automate login.
3. Resize to at least `1500x950`; Gmail hides parts of the filter dialog in narrower viewports.
4. Dump only the settings needed for the approved operation. Prefer connected label inventory; use the labels page when verifying the browser label picker:
   - labels: `#settings/labels` + `DUMP_LABELS`
   - filters: `#settings/filters` + `DUMP_FILTERS`

Use the browser control interface provided by the active environment. The optional
CDP CLI is another frontend driver, not Gmail API access; use it only when that
control method is permitted. Do not start a second browser/control channel to
work around restrictions in the active browser tools.

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
- `references/core/connected-tools.md`: start here for connected Gmail routing and supported browser fallback.
- `references/core/gmail-dom.js`: for browser drivers that permit mutable page evaluation. The one
  implementation of everything this skill does inside a Gmail page - dumps,
  filter authoring, archive passes - as pure browser JavaScript with no
  Playwright or tool-specific assumptions. Every driver injects this same file,
  so a DOM gotcha fixed here is fixed for the CLI, for Codex, for a
  browser-extension agent, and for the next session. Do not re-derive a click
  sequence in a session; call this and patch it when it is wrong.
- `references/drivers/README.md`: the driver contract, including the one real
  click Gmail's label dropdown requires (`needsRealClick` -> `resume()`)
- `references/drivers/playwright.js`: Playwright/CDP driver; `attach(page)`
  returns the API with the real-click loop already wired
- `references/drivers/extension.md`: how to drive the core from an agent whose
  only page access is a "run JS in the page" tool. ~2 calls per filter instead
  of the 8-10 that hand-clicking the dialog costs
- `references/core/dump-state.js`: one-call label/filter inventory, plus keyword-scoped `DUMP_FILTERS_MATCHING`/`DUMP_LABELS_MATCHING` variants that avoid the ~100-item tool-result truncation cap on large accounts
- `references/core/dump-inbox.js`: one-call inbox row → real sender address extraction (`DUMP_INBOX_SENDERS`) for when no Gmail connector is installed
- `references/diagnostics/audit-inbox-gaps.mjs`: standalone Node script — cross-references DUMP_INBOX_SENDERS output against DUMP_FILTERS output and computes missing-base/missing-skip/keyword-gap candidates automatically instead of eyeballing the diff by hand
- `references/core/filter-criteria-gotchas.md`: forbidden operators and special characters
- `references/core/stable-selectors.md`: selector patterns
- `references/filters/create-filter.js`: low-call filter creation helpers for CommonJS/Claude callers
- `references/filters/create-filter.mjs`: ESM bridge for ChatGPT's persistent JavaScript runtime
- `references/filters/edit-filter.js`: edit/delete existing filters
- `references/cleanup/bulk-archive.md`: retroactive Inbox cleanup
- `references/cleanup/unsubscribe.js`: Gmail-native one-click unsubscribe helpers for Playwright.
- `references/cleanup/unsubscribe.mjs`: ESM imports and `GMAIL_NATIVE_UNSUBSCRIBE_BATCH_WITH_TAB` for the active browser client.
- `references/cleanup/plan-safe-unsubscribe.mjs`: deterministic eligibility planner
- `references/labels/create-label.js`: label creation
- `references/labels/move-label.js`: re-nest/rename labels, including the two-save workaround for the same-path rename+reparent collision (see Criteria Safety-adjacent gotcha below)
- `references/labels/set-label-color.js`: set one label's colour, or cascade one colour to a label and all its sublabels
- `references/cleanup/archive-by-sender.js`: retroactive Inbox archive by sender, batched, via the confirmed-working per-row-checkbox selection (do not use a toolbar "select all" control — see gotcha below)
- `../../cli/README.md`: standalone terminal CLI wrapping these helpers over CDP — use for scripted/repeatable runs outside an agent turn; `npm test` covers the pure-logic pieces
- `../gmail-add-rules/SKILL.md`: rule creation workflow entrypoint
- `../gmail-add-label/SKILL.md`: label creation and application workflow entrypoint
- `../gmail-colour-labels/SKILL.md`: label colour workflow entrypoint

## Low-Call Filter Creation

Prefer `references/filters/create-filter.js` helpers:

- `CREATE_FILTER_BATCH_WITH_TAB`: ChatGPT browser-client entrypoint; pass the claimed Gmail tab and every approved missing filter spec in one tool execution.
- `CODEX_CREATE_FILTER_BATCH_PLAYWRIGHT`: Claude/Playwright callback builder; pass all approved missing specs to one `browser_run_code_unsafe` call.
- `CREATE_FILTER_BATCH_WITH_PAGE`: direct Playwright-page entrypoint when the caller already has a page object.
- `CODEX_CREATE_LABEL_FILTER_PLAYWRIGHT`: create a base/tag or label-applying filter in one `browser_run_code_unsafe` call.
- `CODEX_CREATE_SKIP_FILTER_PLAYWRIGHT`: create a skip-only filter in one `browser_run_code_unsafe` call.
- `CODEX_CREATE_LABEL_FILTER`: create a base/tag or label-applying filter.
- `CODEX_CREATE_SKIP_FILTER`: create a skip-only filter.

Use the batch entrypoint for the active runtime instead of one LLM/tool round trip per filter. Order each sender's base/tag spec immediately before its skip-only specs. The shared runtime normalizes specs, refuses labels on skip-only rules, cancels warning-prone criteria, waits for slow Gmail saves without navigating away, and verifies the exact persisted criteria and action set before continuing.

Batch specs use:

```js
[
  { from: "news@example.com", label: "Subscriptions/Example", skipInbox: false, alsoApplyToExisting: true },
  { from: "news@example.com", skipInbox: true, alsoApplyToExisting: true },
]
```

Use `list: "updates.example.com"` instead of `from` for a stable mailing-list identity. Optional criteria fields are `to`, `subject`, `hasWords`, and `doesntHave`.

For ChatGPT, dynamically import `references/filters/create-filter.mjs` once in the persistent JavaScript session and call `CREATE_FILTER_BATCH_WITH_TAB(tab, specs)` once. For Claude, require `create-filter.js`, build one callback with `CODEX_CREATE_FILTER_BATCH_PLAYWRIGHT(specs)`, and execute that callback once. Do not wrap the batch helper in an LLM-driven per-filter loop.

Keep the single-filter helpers as compatibility fallbacks. Prefer the `*_PLAYWRIGHT` helpers when `browser_run_code_unsafe` is available. Gmail label dropdown options require real Playwright locator clicks; in-page `browser_evaluate` DOM clicks can open and close the dropdown without selecting the label.

All helpers support `alsoApplyToExisting`. Use it when the approved change should immediately affect matching existing conversations. For high-risk or large backfills, leave it off and do a reviewed connector search/archive pass.

After creating labels through the Gmail connector, treat every open Gmail settings
view and label picker as stale. Close any unsaved filter form, perform a real
Gmail tab reload (not only hash-route navigation), then open `#settings/labels`
and re-dump labels. Next open `#settings/filters` and verify the exact full path
in the label picker before opening a filter form. If it is still absent, reload
once more and recheck; then fail closed and report the stale-picker condition.
Never save an incomplete or substitute-label rule.

## Optimize And Patch

Speed is part of correctness for Gmail work. Route supported mail operations to
the connected tools and batch approved actions. For browser-only work, invoke
the maintained runtime-compatible batch helper once for the approved items;
do not reconstruct its steps through separate model calls. Use read-only DOM
evaluation for compact inspection only when that is the runtime's contract.
Do not inject `GmailDom` or execute mutating JavaScript through read-only evaluation.

Targets:

- State dump: connected label inventory; one scoped browser dump for unsupported filter definitions.
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

## Playwright-Layer Guardrails

These apply to any Gmail settings-page automation (labels, filters), not just one workflow:

- **A stuck dialog or open menu breaks unrelated later steps, not just the one that opened it.** An open `[role="alertdialog"]` or a stacked context menu can make Playwright role-locators on background rows return zero matches, or make later `hover()`/`click()` calls fail with "not visible" on elements that worked moments earlier. Reset defensively *before* every attempt (press Escape twice, click a neutral point off any menu), not only in a catch block after a failure — a failed attempt frequently leaves state open for the next one to trip over.
- **Never hardcode a color-picker/dropdown value from memory or from a doc comment.** Query the live `aria-label`/option text at runtime and click by the string actually found. Gmail's label-color grid and similar pickers can differ from a previously-documented palette (off-by-one RGB channels, extra or missing swatches) even within the same account.
- **`browser_run_code_unsafe`'s execution context has no global `setTimeout`.** Use `await page.waitForTimeout(ms)`. This is not just a broken-vs-working distinction: the `ReferenceError` fires *after* a mutating click has already been issued, so the script reports failure while the click may have gone through — and a `page.goto(...)` in the very next call can abort that still-in-flight save, silently reverting it. Always verify a save by re-reading state in a later call, never by trusting "no exception."
- **Editing a label's name AND its parent nesting in the same Save can silently no-op** when the resulting full path string already equals another label's current display name (most commonly: fixing a flat mis-created label like `"Parent/Child"` by renaming it to `Child` while nesting it under `Parent` — the target path `Parent/Child` collides with the flat label's own current name). The dialog closes normally with no visible error. Split into two Saves through a disposable intermediate name instead (`renameAndNestLabel` in `references/labels/move-label.js` does this).
- **Verify a batch action by re-reading a distinguishing multi-token match, not one generic keyword**, especially label/filter criteria edits on an account with more than ~100 filters or labels — a single short token can match an unrelated pre-existing row and report a false "after" state.

## Criteria Safety

Do not use these in Gmail filter criteria: `is:`, `label:`, `in:`, `before:`, `after:`, `category:`, `has:yellow-star`, `older_than:`, `newer_than:`.

Avoid warning-prone special characters in keyword fields: `% [ ] ( ) & # * ! $ £ :`.

Use short quoted phrases from actual subjects/snippets when creating private filters. In public skill docs, use synthetic examples such as `"weekly digest"` or `"receipt available"`.

## Cleanup

Classify current mail before choosing its treatment. Use message content,
meaningful existing labels, and relevant replies to distinguish actionable or
unresolved mail, completed conversations, and reference-only records. Labelling
and Inbox visibility are separate decisions: applying a label does not itself
justify archiving. Keep unclear items visible for review unless the user directs
otherwise.

An Inbox-count goal is a triage target, not authorization to archive everything
else. Do not bulk-archive an unclassified remainder just to reach that count or
use a dated archive label as a substitute for meaningful filing. Follow explicit
user instructions about which mail to archive.

For current mail:

- Use Gmail connector searches with `in:inbox ... -in:spam -in:trash`.
- Choose archive granularity explicitly: `archive_emails(thread_ids)` archives entire conversations (up to 100 distinct threads); `batch_modify_email(message_ids, remove_labels=["INBOX"])` archives only the reviewed messages. Never substitute thread IDs for message IDs or vice versa. Preserve `UNREAD` and other labels.
- Verify by rerunning the same `in:inbox` query. If verification is rate-limited or incomplete, follow "Rate limits and incomplete verification" in `references/core/connected-tools.md`; do not replay changes to obtain verification.

Do not delete, mark read, or unsubscribe unless the user explicitly asks.

## Safe unsubscribe

Only unsubscribe when the user explicitly asks and all of these are true:

1. The message has `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
2. Sender authentication is aligned (SPF or DKIM passes for the visible sender domain).
3. Gmail exposes its own exact `Unsubscribe` control for that message.

Use `references/cleanup/plan-safe-unsubscribe.mjs` on a Gmail metadata batch.
It emits eligible/refused records without exposing unsubscribe URLs. After
explicit approval, pass all eligible records to
`GMAIL_NATIVE_UNSUBSCRIBE_BATCH_PLAYWRIGHT` in one Gmail browser invocation;
the runner records each outcome and continues only with independent safe items.

Read candidate headers with the connected `read_email(format="metadata")` and
run the existing eligibility planner before opening Gmail. Missing headers are
unknown, not proof of eligibility. For the active browser client, import
`references/cleanup/unsubscribe.mjs` and call
`GMAIL_NATIVE_UNSUBSCRIBE_BATCH_WITH_TAB(tab, eligibleItems)` once. It adapts the
documented locator/navigation interface and awaits either synchronous or
asynchronous URL inspection. Preserve original unread status after UI inspection
using the exact observed message IDs; opening a browser message can mark it read.

If an exception occurs after the Gmail confirmation was clicked, do not repeat
the unsubscribe automatically. Inspect the current confirmation/status first;
a reporting failure does not prove the request failed. The batch reports
`outcome-unknown` after a confirmation attempt if verification fails; never
automatically replay that item. `refused` means confirmation was not attempted.

Never extract, open, navigate to, or follow an unsubscribe, preference-centre,
tracking, or any other link inside an email. Do not use a mailto fallback. If
any precondition fails, report the sender as not safely automatable and offer
only a user-directed manual route.

## Skill Maintenance

When discovering reusable Gmail behavior, update this skill or the relevant reference. Keep examples generic and do not commit raw Gmail exports, snapshots, message subjects, account emails, or personal sender lists.

Skill and reference files must be reusable instructions, not worklogs. Do not append session notes, "what I did", timestamps from the current run, raw audit outcomes, user-specific examples, or bottom-of-file progress summaries. Convert discoveries into generic guardrails, examples, or helper code.

If a companion skill uncovers a Gmail workflow issue, patch the core `gmail` skill first, then continue the audit or cleanup.
