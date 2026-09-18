# gmail-skill CLI

A terminal wrapper around this skill's Playwright browser-automation helpers.
It drives the real Gmail web UI over Chrome DevTools Protocol (CDP) — **not**
the Gmail API. Same "automate the web with JavaScript" approach the rest of
the skill uses, just invocable from a shell prompt instead of going through
an agent turn per action, and testable with plain `node --test`.

## Setup (one-time)

1. Start a Chrome instance with a debug port and a *persistent* profile dir,
   so you only log into Gmail once:

   ```sh
   chrome --remote-debugging-port=9222 --user-data-dir="C:/Users/you/.gmail-cli-profile"
   ```

   Sign into Gmail in that window. Leave it running — the CLI connects to
   this existing window/tab rather than launching its own browser.

2. Install dependencies:

   ```sh
   cd cli
   npm install
   ```

   This installs `playwright-core` only (no bundled Chromium download —
   `connectOverCDP` just needs the driver, since it attaches to a browser
   that's already running).

## Usage

```sh
node gmail-cli.js dump-labels [--out labels.json]
node gmail-cli.js dump-filters [--out filters.json]
node gmail-cli.js dump-inbox [--out senders.json]
node gmail-cli.js audit-gaps --filters filters.json --senders senders.json
node gmail-cli.js create-label "Finance/Receipts"
node gmail-cli.js create-filters specs.json
node gmail-cli.js archive sender1@example.com sender2@example.com
node gmail-cli.js set-label-color "Finance" "217, 48, 37" [--cascade]
node gmail-cli.js unsubscribe "https://mail.google.com/mail/u/0/#inbox/<msg-id>"
```

- `--cdp <url>` overrides the CDP endpoint (default `http://127.0.0.1:9222`,
  or the `GMAIL_CLI_CDP` env var).
- `--out <file>` writes JSON output to a file instead of stdout.
- `create-filters specs.json` expects a JSON array of filter specs matching
  `NORMALIZE_FILTER_SPECS` in `../skills/gmail/references/filters/create-filter.js`
  — each needs `from` or `list`, an explicit boolean `skipInbox`, and a
  `label` if (and only if) `skipInbox` is `false`.
- `audit-gaps` is pure JSON logic and does **not** need Chrome running at all
  — feed it a `dump-filters` and `dump-inbox` output pair from any time.

## Tests

```sh
npm test
```

Covers the pure-logic pieces only (`NORMALIZE_FILTER_SPECS`,
`FILTER_ROW_MATCHES_SPEC`, `auditInboxGaps`) — no live Gmail/browser needed.
The browser-driving commands (`create-label`, `archive`, `set-label-color`,
etc.) aren't unit-tested here since they require a real authenticated Gmail
session; they're the same functions already exercised interactively via
`browser_run_code_unsafe` in Claude Code sessions, just re-exported for
direct `require()` instead of copy-pasted as string literals.

## Why this exists instead of every command being reinvented per-session

Every one of this CLI's commands is a thin call into a function that
`skills/gmail/references/**/*.js` already exports (`createLabel`,
`archiveBySenders`, `CREATE_FILTER_BATCH_WITH_PAGE`,
`setLabelColorCascadeToSublabels`, `GMAIL_NATIVE_UNSUBSCRIBE_PLAYWRIGHT`,
...). Those files were originally written as copy-pasteable snippets for
`browser_run_code_unsafe`, which has no `require()` — so a Claude Code
session had to re-inline the same logic from memory into every ad hoc
`browser_run_code_unsafe` call, across sessions, with drift each time. This
CLI is the same logic, `require()`d instead of retyped, so a fix or gotcha
found once (documented in the reference `.js` file) benefits both the CLI
**and** the next `browser_run_code_unsafe` call that copies from the same
source.
