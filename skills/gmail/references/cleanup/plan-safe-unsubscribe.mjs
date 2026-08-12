#!/usr/bin/env node

// Turn Gmail metadata into a fail-closed unsubscribe plan. It never reads or
// emits a List-Unsubscribe URL; execution is only through Gmail's native UI.

function headerMap(message) {
  const headers = message?.payload?.headers ?? message?.headers ?? [];
  const map = new Map();
  for (const header of headers) {
    if (!header?.name || typeof header.value !== "string") continue;
    const key = header.name.toLowerCase();
    map.set(key, `${map.get(key) ?? ""}\n${header.value}`.trim());
  }
  return map;
}

function addressDomain(value = "") {
  const address = value.match(/[\w.+-]+@([\w.-]+)/)?.[1];
  return address?.toLowerCase() ?? null;
}

function alignedAuthentication(headers, fromDomain) {
  const auth = headers.get("authentication-results") ?? "";
  if (!fromDomain) return false;
  const escaped = fromDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dkim = new RegExp(`dkim=pass[^;]*header\\.i=@(?:[\\w.-]+\\.)?${escaped}\\b`, "i").test(auth);
  const spf = new RegExp(`spf=pass[^;]*smtp\\.mailfrom=[^;@\\s]+@(?:[\\w.-]+\\.)?${escaped}\\b`, "i").test(auth);
  return dkim || spf;
}

export function planSafeUnsubscribe(messages) {
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
  return messages.map((message) => {
    const headers = headerMap(message);
    const from = headers.get("from") ?? message.from_ ?? "";
    const domain = addressDomain(from);
    const oneClick = /\blist-unsubscribe\s*=\s*one-click\b/i.test(headers.get("list-unsubscribe-post") ?? "");
    const authenticated = alignedAuthentication(headers, domain);
    const id = message.id;
    if (!id) return { id: null, status: "refused", reason: "message id missing" };
    if (!oneClick) return { id, status: "refused", reason: "one-click List-Unsubscribe header missing" };
    if (!authenticated) return { id, status: "refused", reason: "aligned sender authentication missing" };
    return {
      id,
      sender: from,
      status: "eligible",
      messageUrl: `https://mail.google.com/mail/#all/${id}`,
    };
  });
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""));
  const messages = Array.isArray(input) ? input : input.messages ?? input.emails ?? input.responses;
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, items: planSafeUnsubscribe(messages) }, null, 2)}\n`);
}

const invokedPath = globalThis.process?.argv?.[1];
if (invokedPath && import.meta.url === new URL(`file://${invokedPath.replace(/\\/g, "/")}`).href) await main();
