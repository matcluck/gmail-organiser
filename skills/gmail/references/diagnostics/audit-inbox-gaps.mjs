#!/usr/bin/env node
// audit-inbox-gaps.mjs — Cross-reference inbox senders against existing Gmail
// filters and compute the interview candidate list automatically, instead of
// eyeballing DUMP_FILTERS vs the inbox by hand.
//
// Built 2026-08-14 after doing this cross-reference manually for a real
// gmail-audit-inbox session (231 filters, 145-message inbox) — the slow part
// wasn't reading Gmail, it was a human re-deriving "does X already have a
// filter, and does the existing skip filter's keyword list actually cover
// this message's subject" sender-by-sender. That's pure logic on two JSON
// blobs; this script does it in one pass and needs no browser.
//
// INPUT: one JSON file (path as argv[2], or stdin) shaped:
//   {
//     "filters": [ ...DUMP_FILTERS output, from core/dump-state.js... ],
//     "senders": [ ...DUMP_INBOX_SENDERS output, from core/dump-inbox.js...
//                  { "name": "...", "email": "...", "subject": "..." } ]
//   }
// filters/senders may each also just be plain arrays saved separately — pass
// --filters=path --senders=path instead of a combined file. See --help.
//
// OUTPUT: JSON array of candidates, each:
//   {
//     email, name, exampleSubjects: [...],
//     status: "missing-base" | "missing-skip" | "keyword-gap" | "covered",
//     matchedFilters: [{criteria, label, skipInbox}...],
//     reason: "human-readable why"
//   }
// Sorted so missing-base / keyword-gap (the clearest, safest wins) sort first,
// "covered" last. Feed non-"covered" entries into the interview batch format
// documented in skills/gmail-audit-inbox/SKILL.md.
//
// USAGE:
//   node audit-inbox-gaps.mjs dump.json
//   node audit-inbox-gaps.mjs --filters=filters.json --senders=senders.json
//   cat dump.json | node audit-inbox-gaps.mjs
//
// This is plain Node — no deps, no browser, safe to iterate on in a real REPL:
//   node --experimental-repl-await
//   > const { auditInboxGaps } = await import('./audit-inbox-gaps.mjs')
//   > auditInboxGaps(filters, senders)

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// GOTCHA (hit while building this 2026-08-14): a value that structurally
// resembles a secret (e.g. a domain with two dots, shaped like a JWT's
// header.payload.signature) can come back from the tool pipeline already
// replaced with a literal placeholder string like "[BLOCKED: JWT token]" or
// "[BLOCKED: Base64 encoded data]" — a content-safety redaction applied
// upstream of this script, baked into the saved JSON. It is not a bug in
// DUMP_FILTERS/DUMP_INBOX_SENDERS and not something to work around by trying
// to recover the real value — treat a "[BLOCKED:" criteria/label value as
// "unknown, re-dump this one sender narrowly if you need it" rather than a
// crash or a real Gmail criteria string.

function domainOf(email) {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at).toLowerCase(); // includes leading '@'
}

// Gmail's from:(...) criteria is an OR-list of exact addresses and/or "@domain"
// tokens. Mirrors what Gmail itself would match at delivery time.
function filterFromTokens(filter) {
  const raw = filter?.criteria?.from
    || filter?.criteria?.raw?.match(/from:\(([^)]+)\)/)?.[1]
    || '';
  return raw.split(/\s+OR\s+/i).map(t => t.trim().toLowerCase()).filter(Boolean);
}

function filterMatchesEmail(filter, email) {
  const emailLower = email.toLowerCase();
  const tokens = filterFromTokens(filter);
  return tokens.some(tok => {
    if (tok.startsWith('@')) return emailLower.endsWith(tok); // "@domain.com" — domain suffix
    if (tok.includes('@')) return emailLower === tok; // full "user@domain.com" — exact address
    // Bare domain with no "@" (e.g. "example.com.au") — Gmail's from: matches
    // this as a substring against the whole address, not just an exact-equal
    // domain. Confirmed 2026-08-14: `from:(example.com.au)` matches
    // `noreply@example.com.au`.
    return emailLower.includes(tok);
  });
}

// Every quoted phrase anywhere in the filter's criteria — covers both
// `hasWords` phrase lists and `subject:("A" OR "B")` style skip conditions.
function triggerPhrases(filter) {
  const raw = filter?.criteria?.raw || '';
  return [...raw.matchAll(/"([^"]+)"/g)].map(m => m[1].toLowerCase());
}

export function auditInboxGaps(filters, senders) {
  const byEmail = new Map();
  for (const s of senders) {
    if (!s?.email) continue;
    const key = s.email.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, { name: s.name, email: s.email, examples: [] });
    if (s.subject) byEmail.get(key).examples.push(s.subject);
  }

  const candidates = [];
  for (const { name, email, examples } of byEmail.values()) {
    const matched = filters.filter(f => filterMatchesEmail(f, email));
    if (matched.length === 0) {
      candidates.push({
        email, name, exampleSubjects: examples, status: 'missing-base',
        matchedFilters: [], reason: 'No filter matches this sender at all.',
      });
      continue;
    }

    const baseFilters = matched.filter(f => f.label && !f.skipInbox);
    const skipFilters = matched.filter(f => f.skipInbox);

    if (baseFilters.length === 0) {
      candidates.push({
        email, name, exampleSubjects: examples, status: 'missing-base',
        matchedFilters: matched.map(f => ({ criteria: f.criteria?.raw, label: f.label, skipInbox: f.skipInbox })),
        reason: skipFilters.length
          ? 'Only a skip-only filter matches — contract requires a base/tag filter to exist first.'
          : 'Matching filter(s) exist but none apply a label / keep this sender organized.',
      });
      continue;
    }

    if (skipFilters.length === 0) {
      candidates.push({
        email, name, exampleSubjects: examples, status: 'covered',
        matchedFilters: baseFilters.map(f => ({ criteria: f.criteria?.raw, label: f.label })),
        reason: 'Base/tag filter exists; no skip filter (fine if this sender should stay in Inbox).',
      });
      continue;
    }

    // Base + skip both exist. Check whether each EXAMPLE subject we actually
    // saw in the inbox would have matched one of the skip filters' trigger
    // phrases. If a skip filter has phrases but this subject matches none of
    // them, the message sat in Inbox despite a skip rule existing for this
    // sender — a keyword-gap candidate (exactly what happened with Amazon's
    // "Dispatched" vs its "Shipped" keyword on 2026-08-14).
    const allPhrases = skipFilters.flatMap(triggerPhrases);
    const uncaughtExamples = allPhrases.length
      ? examples.filter(ex => !allPhrases.some(p => ex.toLowerCase().includes(p)))
      : []; // skip filter has no phrases (broad skip-all) — nothing to gap-check

    if (allPhrases.length && uncaughtExamples.length) {
      candidates.push({
        email, name, exampleSubjects: uncaughtExamples, status: 'keyword-gap',
        matchedFilters: skipFilters.map(f => ({ criteria: f.criteria?.raw, phrases: triggerPhrases(f) })),
        reason: `Skip filter exists but its keywords didn't match ${uncaughtExamples.length} example subject(s) seen in Inbox — consider adding a phrase.`,
      });
      continue;
    }

    candidates.push({
      email, name, exampleSubjects: examples, status: 'covered',
      matchedFilters: matched.map(f => ({ criteria: f.criteria?.raw, label: f.label, skipInbox: f.skipInbox })),
      reason: 'Base and skip filters both exist and cover the examples seen.',
    });
  }

  const order = { 'missing-base': 0, 'keyword-gap': 1, 'missing-skip': 2, covered: 3 };
  candidates.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  return candidates;
}

function loadJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage:
  node audit-inbox-gaps.mjs dump.json
  node audit-inbox-gaps.mjs --filters=filters.json --senders=senders.json
  cat dump.json | node audit-inbox-gaps.mjs`);
    return;
  }

  const filtersArg = args.find(a => a.startsWith('--filters='));
  const sendersArg = args.find(a => a.startsWith('--senders='));

  let filters, senders;
  if (filtersArg && sendersArg) {
    filters = loadJson(filtersArg.slice('--filters='.length));
    senders = loadJson(sendersArg.slice('--senders='.length));
  } else {
    const combined = args[0] && !args[0].startsWith('--') ? loadJson(args[0]) : await readStdin();
    filters = combined.filters || [];
    senders = combined.senders || [];
  }

  const candidates = auditInboxGaps(filters, senders);
  console.log(JSON.stringify(candidates, null, 2));
}

// Only run as a CLI when invoked directly (not when imported for its exports).
// pathToFileURL (not a manual `file://${path}` template) so this also works on
// Windows, where argv[1] uses backslashes and a drive letter that don't
// string-match a file:// URL without proper encoding.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err); process.exitCode = 1; });
}
