#!/usr/bin/env node

// Read a JSON array of label names (or objects with a `name` field) from stdin
// and emit a fail-closed financial-year rename plan. This is deliberately a
// planner: applying the plan still requires an explicit Gmail browser action.

function canonicalFinancialYear(match, shortStart, shortEnd) {
  if (shortEnd) return `FY20${shortStart}-${shortEnd}`;
  const end = Number(shortStart);
  return `FY${String(2000 + end - 1)}-${String(shortStart).padStart(2, "0")}`;
}

export function standardizeFinancialYearLabel(name) {
  if (typeof name !== "string") throw new TypeError("label name must be a string");
  return name.replace(/\bFY(\d{2})(?:-(\d{2}))?\b/g, canonicalFinancialYear);
}

export function buildPlan(labels) {
  if (!Array.isArray(labels)) throw new TypeError("labels must be an array");
  const names = labels.map((item) => typeof item === "string" ? item : item?.name)
    .filter((name) => typeof name === "string" && name.trim());
  const existing = new Set(names);
  const changes = names.map((from) => ({ from, to: standardizeFinancialYearLabel(from) }))
    .filter(({ from, to }) => from !== to);
  const targets = new Set();
  for (const { from, to } of changes) {
    if (existing.has(to) && to !== from) throw new Error(`Target label already exists: ${to}`);
    if (targets.has(to)) throw new Error(`Two labels would collide at: ${to}`);
    targets.add(to);
  }
  return { schemaVersion: 1, changes };
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""));
  process.stdout.write(`${JSON.stringify(buildPlan(input), null, 2)}\n`);
}

const invokedPath = globalThis.process?.argv?.[1];
if (invokedPath && import.meta.url === new URL(`file://${invokedPath.replace(/\\/g, "/")}`).href) await main();
