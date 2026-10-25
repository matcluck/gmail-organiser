# Drivers

`../core/gmail-dom.js` is the only place Gmail's DOM is described. A driver's
whole job is to get that file's text into the page, forward calls, and supply
the one capability the DOM cannot provide itself.

Nothing Gmail-specific belongs in a driver. If you find yourself writing a
selector, a wait, or a "click the third checkbox" in driver code, it belongs in
the core instead - that is the mistake this layout exists to prevent.

## The contract

1. **Inject.** Evaluate the core file's text in the page. It self-installs as
   `window.GmailDom` and is idempotent, so re-inject freely; a full page reload
   (not SPA hash navigation) wipes it, so inject before each operation.
2. **Declare your coordinate frame.** `GmailDom.setFrame({ w, h })` if your
   click tool uses a scaled screenshot frame; `setFrame(null)` for CSS pixels
   (Playwright, DevTools). Everything the core hands back for clicking is in
   that frame.
3. **Call the API** and `await` it.
4. **Serve `needsRealClick`.** Any result may come back as
   `{ ok: true, needsRealClick: { x, y, what } }`. Perform ONE real click at
   `(x, y)` with whatever real-input tool you have, then call
   `GmailDom.resume()`. That is the entire driver-specific surface.

Why it exists: a synthetic click on an option in Gmail's label dropdown opens
and closes the menu without selecting it. Everything else - the panel, the
checkboxes, the Save, the archive pass - is plain DOM and stays in the core.

## API

| Call | Returns |
|---|---|
| `dumpFilters([keywords])` | parsed `{criteria, actions, label, skipInbox, markAsRead, neverSpam}` rows; keywords filter in-page, which keeps the payload under the ~100-item tool-result cap on a big account |
| `dumpLabels([keywords])` | label names (settings then Labels must be open) |
| `senders()` | `{address: count}` for the rendered message list |
| `createFilter(spec)` | `{ok, saved}` - or `{needsRealClick}` when the spec applies a label |
| `resume()` | finishes a filter after its real click |
| `commit(spec)` | saves, waits out the slow write, re-reads the persisted row |
| `archiveSearch(query)` | selects every rendered row and archives it; `{archived, left}` |
| `actions()` / `panelOpen()` | live panel state, for debugging a refusal |

`spec` is the same shape the rest of the skill uses:
`{ from | list, to, subject, hasWords, doesntHave, label, skipInbox, neverSpam = true, alsoApplyToExisting }`.
`skipInbox` must be an explicit boolean, and a spec may not carry both `label`
and `skipInbox: true` - the rule contract splits those into two filters. The
core refuses `markAsRead` and `delete` outright.

`createFilter` never reports success from a closed dialog: it re-reads the
filter list and returns the persisted row, or fails.

## Drivers

- **`playwright.js`** - used by `cli/`. `attach(page)` returns the API with the
  real-click loop already wired, plus `createFilters(specs)` and a paging
  `archiveSearch`. Callers never see `needsRealClick`.
- **`extension.md`** - for an agent whose only page access is a "run JS" tool
  (Claude in Chrome's `javascript_tool`, and similar). Paste the core file once
  per page load, then send one-line calls.

## Adding a driver

Implement two things: *evaluate this text in the page* and *click at (x, y) for
real*. That is the whole port. Do not re-describe Gmail.