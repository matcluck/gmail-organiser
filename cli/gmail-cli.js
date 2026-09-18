#!/usr/bin/env node
// gmail-cli.js — thin CLI wrapper around the Playwright-driven Gmail web-UI
// helpers in ../skills/gmail/references/**. This is NOT a Gmail API client —
// it drives the real mail.google.com UI over CDP, in an already-authenticated
// Chrome window, exactly like the browser_run_code_unsafe calls a Claude Code
// session makes, just invocable from a plain terminal without going through
// an agent turn per action.
//
// SETUP (one-time):
//   1. Close all Chrome windows, or start a dedicated profile, with:
//        chrome --remote-debugging-port=9222 --user-data-dir="<a persistent profile dir>"
//      Sign in to Gmail in that window once — the profile dir persists the
//      session, so you don't need to log in again next time.
//   2. cd cli && npm install   (installs playwright-core only — no bundled
//      browser download; connectOverCDP just needs the driver.)
//
// USAGE:
//   node gmail-cli.js dump-labels [--out labels.json]
//   node gmail-cli.js dump-filters [--out filters.json]
//   node gmail-cli.js audit-gaps --filters filters.json --senders senders.json
//   node gmail-cli.js create-label "Finance/Receipts"
//   node gmail-cli.js create-filters specs.json
//   node gmail-cli.js archive sender1@example.com sender2@example.com
//   node gmail-cli.js set-label-color "Finance" "217, 48, 37" --cascade
//   node gmail-cli.js unsubscribe <gmail-message-url>
//
// All commands connect to ws://127.0.0.1:9222 by default; override with
// --cdp <url> or the GMAIL_CLI_CDP env var.

const path = require('node:path');
const fs = require('node:fs');

const REF = (...p) => path.join(__dirname, '..', 'skills', 'gmail', 'references', ...p);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function connect(cdpUrl) {
  const { chromium } = require('playwright-core');
  const browser = await chromium.connectOverCDP(cdpUrl);
  const context = browser.contexts()[0] || (await browser.newContext());
  let page = context.pages().find((p) => p.url().includes('mail.google.com'));
  if (!page) page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
  return { browser, page };
}

function evalString(page, source, ...args) {
  // dump-state.js exports arrow-function SOURCE STRINGS (meant for
  // browser_evaluate), not callable functions. Rehydrate into a real
  // function before handing it to Playwright.
  const fn = new Function(`return (${source})`)();
  return page.evaluate(fn, ...args);
}

async function cmdDumpLabels(page, args) {
  const { DUMP_LABELS } = require(REF('core', 'dump-state.js'));
  await page.goto('https://mail.google.com/mail/u/0/#settings/labels', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Create new label'), null, { timeout: 15000 });
  const labels = await evalString(page, DUMP_LABELS);
  output(labels, args);
}

async function cmdDumpFilters(page, args) {
  const { DUMP_FILTERS } = require(REF('core', 'dump-state.js'));
  await page.goto('https://mail.google.com/mail/u/0/#settings/filters', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Create a new filter'), null, { timeout: 15000 });
  const filters = await evalString(page, DUMP_FILTERS);
  output(filters, args);
}

async function cmdDumpInboxSenders(page, args) {
  await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded' });
  const senders = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('tr.zA'));
    return rows.map((r) => {
      const senderEl = r.querySelector('span[email]');
      const subjectEl = r.querySelector('.y6 span, .bog');
      return {
        name: senderEl ? senderEl.getAttribute('name') : null,
        email: senderEl ? senderEl.getAttribute('email') : null,
        subject: subjectEl ? subjectEl.textContent : null,
      };
    }).filter((s) => s.email);
  });
  output(senders, args);
}

// Pure JSON crunching, no Gmail tab needed — see NO_BROWSER_COMMANDS below.
async function cmdAuditGaps(args) {
  if (!args.filters || !args.senders) throw new Error('Usage: audit-gaps --filters <file> --senders <file>');
  const { auditInboxGaps } = await import(require('node:url').pathToFileURL(REF('diagnostics', 'audit-inbox-gaps.mjs')).href);
  const filters = JSON.parse(fs.readFileSync(args.filters, 'utf8'));
  const senders = JSON.parse(fs.readFileSync(args.senders, 'utf8'));
  const candidates = auditInboxGaps(filters, senders);
  output(candidates, args);
}

async function cmdCreateLabel(page, args) {
  const labelName = args._[1];
  if (!labelName) throw new Error('Usage: create-label "<Parent/Child>"');
  const { createLabel } = require(REF('labels', 'create-label.js'));
  await page.goto('https://mail.google.com/mail/u/0/#settings/labels', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Create new label'), null, { timeout: 15000 });
  await createLabel(page, labelName);
  output({ created: labelName }, args);
}

async function cmdCreateFilters(page, args) {
  const specFile = args._[1];
  if (!specFile) throw new Error('Usage: create-filters <specs.json>  (array of filter specs — see NORMALIZE_FILTER_SPECS)');
  const { CREATE_FILTER_BATCH_WITH_PAGE } = require(REF('filters', 'create-filter.js'));
  const specs = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const results = await CREATE_FILTER_BATCH_WITH_PAGE(page, specs);
  output(results, args);
}

async function cmdArchive(page, args) {
  const senders = args._.slice(1);
  if (senders.length === 0) throw new Error('Usage: archive <sender1@example.com> [sender2@example.com ...]');
  const { archiveBySenders } = require(REF('cleanup', 'archive-by-sender.js'));
  await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded' });
  const results = await archiveBySenders(page, senders);
  output(results, args);
}

async function cmdSetLabelColor(page, args) {
  const [, labelName, rgb] = args._;
  if (!labelName || !rgb) throw new Error('Usage: set-label-color "<Label>" "r, g, b" [--cascade]');
  const { setLabelColor, setLabelColorCascadeToSublabels } = require(REF('labels', 'set-label-color.js'));
  await page.goto('https://mail.google.com/mail/u/0/#inbox', { waitUntil: 'domcontentloaded' });
  if (args.cascade) {
    await setLabelColorCascadeToSublabels(page, labelName, rgb);
  } else {
    await setLabelColor(page, labelName, rgb);
  }
  output({ labelName, rgb, cascaded: !!args.cascade }, args);
}

async function cmdUnsubscribe(page, args) {
  const messageUrl = args._[1];
  if (!messageUrl) throw new Error('Usage: unsubscribe <gmail-message-url>');
  const { GMAIL_NATIVE_UNSUBSCRIBE_PLAYWRIGHT } = require(REF('cleanup', 'unsubscribe.js'));
  const result = await GMAIL_NATIVE_UNSUBSCRIBE_PLAYWRIGHT({ messageUrl })(page);
  output(result, args);
}

function output(data, args) {
  const json = JSON.stringify(data, null, 2);
  if (args.out) {
    fs.writeFileSync(args.out, json);
    console.error(`Wrote ${args.out}`);
  } else {
    console.log(json);
  }
}

const COMMANDS = {
  'dump-labels': cmdDumpLabels,
  'dump-filters': cmdDumpFilters,
  'dump-inbox': cmdDumpInboxSenders,
  'audit-gaps': cmdAuditGaps,
  'create-label': cmdCreateLabel,
  'create-filters': cmdCreateFilters,
  archive: cmdArchive,
  'set-label-color': cmdSetLabelColor,
  unsubscribe: cmdUnsubscribe,
};

// Commands that only crunch local JSON and never touch a Gmail tab — skip
// the CDP connection entirely so they work without Chrome running at all.
const NO_BROWSER_COMMANDS = new Set(['audit-gaps']);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || !COMMANDS[command]) {
    console.error(`Usage: node gmail-cli.js <${Object.keys(COMMANDS).join('|')}> [...args] [--cdp <url>] [--out <file>]`);
    process.exit(1);
  }

  if (NO_BROWSER_COMMANDS.has(command)) {
    await COMMANDS[command](args);
    return;
  }

  const cdpUrl = args.cdp || process.env.GMAIL_CLI_CDP || 'http://127.0.0.1:9222';
  const { browser, page } = await connect(cdpUrl);
  try {
    await COMMANDS[command](page, args);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { parseArgs, connect, COMMANDS };
