# Connected Gmail and browser routing

Discover the tools exposed in the current turn. Confirm a newly available
connection with one relevant read such as `list_labels`; do not persist an
account's connection status in this skill. Reuse an already confirmed connection.
The names below identify operations, not permission to mutate mail.

| Task | Preferred connected operation | Important boundary |
|---|---|---|
| Inbox/label totals | `list_labels(label_names=["INBOX"])` | Distinguish messagesTotal/messagesUnread from threadsTotal/threadsUnread. |
| Audit examples | `search_emails` | Put operators in `query`; page using returned tokens. Report coverage if partial. |
| IDs for approved cleanup | `search_email_ids` | Use returned immutable IDs; never convert Gmail UI tokens into API IDs. |
| Sender and unsubscribe headers | `read_email(format="metadata")` | Fetch full MIME only when needed; metadata reads avoid opening/marking messages read. |
| Multiple message/thread reads | `batch_read_email` / `batch_read_email_threads` | At most 100; current batch message reads return full MIME, not metadata-only. |
| Labels by name | `apply_labels_to_emails` / `create_label` | Names are accepted; missing labels require approved creation. |
| Large reviewed label backfill | `bulk_label_matching_emails` | Server-side query plus label; `archive=true` only when both actions were approved. This does not create a future rule. |
| Archive conversations | `archive_emails(thread_ids)` | Up to 100 distinct threads; removes INBOX from every message in each thread. |
| Archive selected messages | `batch_modify_email(message_ids, remove_labels=["INBOX"])` | Leaves unrelated messages in a mixed thread alone. Preserve UNREAD and all other labels. |
| Persistent filters | An actual exposed filter tool, otherwise browser helpers | The current Gmail tools do not expose filter list/create/edit/delete. Do not infer them from the public Gmail API. |
| Unsubscribe | Metadata planner, then Gmail-native browser batch | Current tools have no unsubscribe action. Keep one-click/authentication/native-control checks. |
| Rename/nest/colour labels | An actual exposed tool, otherwise browser helpers | Label creation is not label rename or colour support. |

For searches, `label_ids` takes exact system IDs or custom IDs returned by
`list_labels`, not display names or operators. For name-based labelling prefer
`apply_labels_to_emails` to an extra ID-lookup round trip.

## Efficient audit and application

1. Collect bounded search summaries and relevant label inventory. Group by
   actual sender/list and intent; read metadata only for shortlisted candidates.
2. Dump unsupported filter definitions once, narrowed to those candidates.
   Run the existing offline gap helper on normalized sender/filter records.
   Its keyword hints are candidates, not proof of Gmail boolean-query semantics.
3. Interview the user using the inbox-audit skill. Keep archive-current,
   skip-future, label and unsubscribe decisions separate.
4. Batch each approved connected operation. Independent read-only calls may
   run together; dependent mutations and browser work remain sequential. Never
   pass more than the advertised batch limit; paginate before claiming completion.
5. Re-run each cleanup's exact `in:inbox` query; verify labels on reviewed IDs
   or an all-mail/label search. A changed total alone does not prove which mail
   changed. Do not remove UNREAD unless explicitly requested.

When only some messages in a conversation match, choose message-scoped cleanup.
Use whole-thread archive only when the reviewed authorization covers the whole
conversation. Preview an unexpectedly broad result before changing it; do not
assume a composed Gmail query has the intended AND/OR grouping.

## Rate limits and incomplete verification

If a read or verification request returns HTTP 429, or HTTP 403 explicitly
identifying a rate/quota limit, stop broad reads. Respect any retry delay from
the service, then make one bounded verification retry using only the changed
message IDs and any related thread/label state needed to verify the operation.
Use smaller batches within the tool's limits. Do not assume every 403 is a rate
limit; an access or permission denial needs its stated cause addressed.

Reuse the already-fetched inventory for unchanged messages instead of repeatedly
reading the full mailbox. Describe it as earlier evidence, not fresh verification.
Check Inbox membership, intended labels, and preserved unread state on the changed
IDs. A changed total or failed search does not prove that those changes succeeded.

If the narrowed retry also fails, stop verification retries and report exactly
which changes were verified and which remain unverified. A verification failure
does not prove a mutation failed: never repeat a mutation merely to obtain a
successful verification response. When the mutation outcome itself is uncertain,
inspect current state before deciding whether any retry is warranted.

## Browser-only operations

The skill's JS and optional CDP CLI are frontend automation. They reduce model
round trips by running deterministic batches; they are not a Gmail API client.
Use only the browser interface supported by the active environment.

For an active browser-client tab, import the maintained `.mjs` entrypoint once:

```js
// Resolve the installed reference path; do not paste or regenerate its source.
const filters = await import(filterModuleUrl);
await filters.CREATE_FILTER_BATCH_WITH_TAB(tab, approvedFilterSpecs);
const unsubscribe = await import(unsubscribeModuleUrl);
await unsubscribe.GMAIL_NATIVE_UNSUBSCRIBE_BATCH_WITH_TAB(tab, eligibleItems);
```

These are separate operations: call only the helper the user approved. Obtain
`eligibleItems` from `plan-safe-unsubscribe.mjs` using connected metadata, with a
Gmail message URL observed in the tools/browser. Do not guess mappings between
API message IDs, thread IDs and opaque browser tokens. The planner's generated
Gmail URL may be used; browser UI must still resolve the intended sender.

When page evaluation is read-only, use it only for compact DOM inspection.
Do not inject `GmailDom`, assign page globals, dispatch synthetic events or call
mutating DOM helpers. Use the locator-based entrypoints instead. Do not use
`eval`, `new Function`, source-string reconstruction, or a different control
channel to evade the runtime's limitations. Take a targeted state check after
actions; avoid repeatedly returning full mailbox snapshots.

Preserve original unread state if opening a browser message changes it. Use exact
observed message IDs for restoration through the connector, rather than marking
an entire sender or mixed thread unread. After a confirmation attempt followed
by a reporting/verification error, the batch returns `outcome-unknown`; inspect
state and never automatically resubmit it. A closed dialog confirms only that
Gmail accepted the request, not that a sender will stop sending immediately.
