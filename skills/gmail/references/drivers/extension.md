# Driver: browser extension / JS-eval agent

For an agent whose only page access is "run this JavaScript in the tab" —
Claude in Chrome's `javascript_tool`, a DevTools console, any equivalent — plus
some way to click at a coordinate (a computer-use tool, or the human).

This is the cheap path. Injecting once costs one call; after that every
operation is a one-line call, instead of the eight-to-ten screenshot-and-click
round trips that hand-driving the filter dialog takes.

## 1. Inject once per page load

Read `../core/gmail-dom.js` and paste its entire text as the JS to evaluate. It
self-installs as `window.GmailDom` and returns the installed API. Gmail is an
SPA, so this survives hash navigation — including the core's own jumps to
`#settings/filters` — and only a real reload wipes it. Re-injecting is a no-op,
so re-inject whenever a call reports `GmailDom is not defined`.

## 2. Declare your click frame

If your click tool works in a scaled screenshot frame (Claude in Chrome reports
`coordinate frame: 863x1400` on every screenshot), tell the core:

```js
GmailDom.setFrame({ w: 863, h: 1400 })
```

Coordinates it hands back are then already in your tool's frame — no scaling,
no screenshot needed to locate anything. Skip this (or pass `null`) if your
clicks are in CSS pixels.

## 3. Call it

```js
await GmailDom.dumpFilters(["aliexpress", "strava"])
await GmailDom.archiveSearch('in:inbox from:(news@example.com)')
await GmailDom.createFilter({ from: 'news@example.com', skipInbox: true })
```

Skip-only filters finish in that one call and return the persisted row.

## 4. Serve the one real click

A filter that applies a label comes back as:

```json
{ "ok": true, "needsRealClick": { "x": 339, "y": 320, "what": "label option \"Subscriptions/Example\"" } }
```

Click once at exactly that point with your real-input tool, then:

```js
await GmailDom.resume()
```

`resume()` verifies the label actually took before saving, so a missed click is
reported rather than silently saved as a label-less rule.

## Worked example — one base/tag filter plus its skip rule

```js
// call 1: inject (paste core file text)
// call 2:
GmailDom.setFrame({ w: 863, h: 1400 });
await GmailDom.createFilter({ from: 'news@example.com', label: 'Subscriptions/Example', skipInbox: false, alsoApplyToExisting: true })
// -> { needsRealClick: { x, y } }
// call 3: real click at (x, y)
// call 4:
await GmailDom.resume()
// -> { ok: true, saved: ['from:(news@example.com) => Apply label "Subscriptions/Example", Never send it to Spam'] }
// call 5:
await GmailDom.createFilter({ from: 'news@example.com', skipInbox: true, alsoApplyToExisting: true })
// -> { ok: true, saved: [...] }
```

Five calls for a complete two-rule sender, and every DOM detail came from the
core rather than from the agent's memory.

## When a call refuses

- `could not tick: neverSpam` — the panel moved. `GmailDom.actions()` prints
  every row with its live ticked state; fix the core, not this driver.
- `label "X" is not in the picker` — the label was created through the Gmail
  connector and the picker is stale. Hard-reload Gmail, then retry.
- `no Create/Update button - the panel closed before commit` — something
  dismissed the dialog mid-sequence. Start the spec again; nothing was saved.
- `real click missed` from `resume()` — the coordinates were stale or the frame
  is wrong. Re-run `createFilter` for a fresh point.
