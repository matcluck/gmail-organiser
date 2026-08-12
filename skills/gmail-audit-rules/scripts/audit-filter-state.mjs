#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";

function unique(values) {
  return [...new Set(values)];
}

function normalizeIdentity(value) {
  return value.trim().replace(/^["']|["']$/g, "").toLowerCase();
}

export function extractIdentityTokens(filter) {
  const raw = filter?.criteria?.raw ?? "";
  const identities = [];
  const fromGroup = raw.match(/from:\(([^)]+)\)/i);
  if (fromGroup) {
    identities.push(...fromGroup[1].split(/\s+OR\s+/i).map(normalizeIdentity));
  } else {
    const fromBare = raw.match(/(?:^|\s)from:([^\s]+)/i);
    if (fromBare) identities.push(normalizeIdentity(fromBare[1]));
  }
  const list = raw.match(/(?:^|\s)list:\(([^)]+)\)|(?:^|\s)list:([^\s]+)/i);
  if (list) identities.push(`list:${normalizeIdentity(list[1] ?? list[2])}`);
  return unique(identities.filter(Boolean));
}

export function identitiesMatch(left, right) {
  if (left === right) return true;
  if (left.startsWith("list:") || right.startsWith("list:")) return false;
  const a = left.replace(/^@/, "");
  const b = right.replace(/^@/, "");
  if (a === b) return true;
  if (a.includes("@") && !b.includes("@") && a.endsWith(`@${b}`)) return true;
  if (b.includes("@") && !a.includes("@") && b.endsWith(`@${a}`)) return true;
  return false;
}

function identityOnly(raw) {
  const value = raw.trim();
  return /^from:\([^)]+\)$/i.test(value) || /^from:[^\s]+$/i.test(value) || /^list:(?:\([^)]+\)|\S+)$/i.test(value);
}

function publicFilter(filter, index) {
  return {
    index,
    criteria: filter?.criteria?.raw ?? "",
    actions: filter?.actions ?? [],
    label: filter?.label ?? null,
    identities: extractIdentityTokens(filter),
  };
}

function normalizeLabel(value) {
  return value
    .normalize("NFKC")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function auditLabelTaxonomy(labels) {
  const records = labels.map((label) => typeof label === "string" ? { name: label } : label)
    .filter((label) => typeof label?.name === "string" && label.name.trim())
    .map((label) => ({ ...label, name: label.name.trim() }));
  const names = new Set(records.map((label) => label.name));
  const missingAncestors = new Set();
  const leaves = new Map();
  const financialYearTokens = new Set();
  const spellingCandidates = [];

  for (const label of records) {
    const parts = label.name.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      const ancestor = parts.slice(0, depth).join("/");
      if (!names.has(ancestor)) missingAncestors.add(ancestor);
    }
    const leaf = parts.at(-1);
    if (!leaves.has(leaf.toLowerCase())) leaves.set(leaf.toLowerCase(), []);
    leaves.get(leaf.toLowerCase()).push(label.name);
    for (const match of label.name.matchAll(/\bFY\d{2}(?:-\d{2})?\b/g)) {
      financialYearTokens.add(match[0]);
    }
    if (/\baccomodation\b/i.test(label.name)) {
      spellingCandidates.push({ label: label.name, suggested: label.name.replace(/accomodation/ig, "Accommodation") });
    }
  }

  const duplicateLeafGroups = [...leaves.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort());
  const tokens = [...financialYearTokens].sort();
  const styles = unique(tokens.map((token) => token.includes("-") ? "range" : "single-year"));

  return {
    counts: {
      total: records.length,
      empty: records.filter((label) => label.conversationCount === 0).length,
      missingAncestors: missingAncestors.size,
      duplicateLeafGroups: duplicateLeafGroups.length,
      spellingCandidates: spellingCandidates.length,
    },
    emptyLabels: records.filter((label) => label.conversationCount === 0).map((label) => label.name),
    missingAncestors: [...missingAncestors].sort(),
    duplicateLeafGroups,
    spellingCandidates,
    financialYearNaming: {
      tokens,
      styles,
      mixed: styles.length > 1,
    },
  };
}

function matchesOverride(filter, overrides) {
  const raw = filter?.criteria?.raw ?? "";
  return overrides.some((entry) => {
    if (typeof entry === "string") return entry.trim() === raw;
    return entry && typeof entry.criteria === "string" && entry.criteria.trim() === raw;
  });
}

export function auditFilterState({ filters, labels = [], overrides = [] }) {
  if (!Array.isArray(filters)) throw new TypeError("filters must be an array");
  if (!Array.isArray(labels)) throw new TypeError("labels must be an array");
  if (!Array.isArray(overrides)) throw new TypeError("overrides must be an array");

  const indexed = filters.map((filter, index) => ({ filter, index }));
  const active = indexed.filter(({ filter }) => !matchesOverride(filter, overrides));
  const overridden = indexed.filter(({ filter }) => matchesOverride(filter, overrides));
  const safeBase = active.filter(({ filter }) =>
    filter?.label && !filter.skipInbox && !filter.markAsRead && !filter.delete &&
    !filter.forward && !filter.star && filter.neverSpam
  );
  const skipOnly = active.filter(({ filter }) =>
    filter?.skipInbox && !filter.label && !filter.markAsRead && !filter.delete &&
    !filter.forward && !filter.star && filter.neverSpam
  );

  const baseTokens = safeBase.map(({ filter }) => extractIdentityTokens(filter));
  const hasBase = (filter) => {
    const tokens = extractIdentityTokens(filter);
    return tokens.length > 0 && baseTokens.some((candidate) =>
      tokens.some((token) => candidate.some((base) => identitiesMatch(token, base)))
    );
  };

  const marksRead = active.filter(({ filter }) => filter?.markAsRead);
  const destructiveOrForwarding = active.filter(({ filter }) => filter?.delete || filter?.forward);
  const specificAppliesLabel = active.filter(({ filter }) => filter?.skipInbox && filter?.label);
  const baseMissingNeverSpam = active.filter(({ filter }) =>
    filter?.label && !filter.skipInbox && !filter.neverSpam
  );
  const missingNeverSpam = active.filter(({ filter }) =>
    !filter?.neverSpam && !filter?.delete && !filter?.forward
  );
  const skipCandidates = active.filter(({ filter }) => filter?.skipInbox);
  const missingBase = skipCandidates.filter(({ filter }) => !hasBase(filter));
  const broadSkips = skipOnly.filter(({ filter }) => identityOnly(filter?.criteria?.raw ?? ""));
  const specificSkips = skipOnly.filter(({ filter }) => !identityOnly(filter?.criteria?.raw ?? ""));
  const multiPhraseAnd = specificSkips.filter(({ filter }) => {
    const raw = filter?.criteria?.raw ?? "";
    return [...raw.matchAll(/"([^"]+)"/g)].length > 1 && !/\bOR\b/i.test(raw);
  });
  const securitySkipRisk = skipCandidates.filter(({ filter }) =>
    /\b(?:secure\s+link|log[ -]?in|sign[ -]?in|verification|verify|mfa|2fa|one[ -]?time|password|passcode|pin|unrecognized|new device)\b/i
      .test(filter?.criteria?.raw ?? "")
  );

  const exactGroups = new Map();
  for (const item of active) {
    const key = JSON.stringify([
      item.filter?.criteria?.raw ?? "",
      [...(item.filter?.actions ?? [])].sort(),
    ]);
    if (!exactGroups.has(key)) exactGroups.set(key, []);
    exactGroups.get(key).push(item);
  }
  const exactDuplicates = [...exactGroups.values()].filter((group) => group.length > 1);

  const skipIdentityGroups = new Map();
  for (const item of skipOnly) {
    const key = extractIdentityTokens(item.filter).sort().join("|");
    if (!key) continue;
    if (!skipIdentityGroups.has(key)) skipIdentityGroups.set(key, []);
    skipIdentityGroups.get(key).push(item);
  }
  const overlappingSkipGroups = [...skipIdentityGroups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([identity, group]) => ({
      identity,
      broadRulePresent: group.some(({ filter }) => identityOnly(filter?.criteria?.raw ?? "")),
      filters: group.map(({ filter, index }) => publicFilter(filter, index)),
    }));

  const knownLabels = new Set(labels.map((label) =>
    normalizeLabel(typeof label === "string" ? label : label?.name ?? "")
  ));
  const missingLabelReferences = labels.length === 0 ? [] : active.filter(({ filter }) =>
    filter?.label && !knownLabels.has(normalizeLabel(filter.label))
  );

  const classified = new Set([
    ...marksRead, ...destructiveOrForwarding, ...specificAppliesLabel,
    ...baseMissingNeverSpam, ...missingNeverSpam, ...safeBase, ...skipOnly,
  ].map(({ index }) => index));
  const unclassified = active.filter(({ index }) => !classified.has(index));

  const view = (items) => items.map(({ filter, index }) => publicFilter(filter, index));
  return {
    counts: {
      total: filters.length,
      override: overridden.length,
      okBase: safeBase.filter(({ filter }) => filter.label !== "Security").length,
      okSecuritySpecific: safeBase.filter(({ filter }) => filter.label === "Security").length,
      okSpecificSkip: specificSkips.filter(({ filter }) => hasBase(filter)).length,
      okMailingListSkipCandidate: broadSkips.filter(({ filter }) => hasBase(filter)).length,
      missingBase: missingBase.length,
      baseMissingNeverSpam: baseMissingNeverSpam.length,
      specificAppliesLabel: specificAppliesLabel.length,
      marksRead: marksRead.length,
      missingNeverSpam: missingNeverSpam.length,
      destructiveOrForwarding: destructiveOrForwarding.length,
      unclassified: unclassified.length,
      exactDuplicateGroups: exactDuplicates.length,
      overlappingSkipIdentityGroups: overlappingSkipGroups.length,
      broadSubsumesSpecificGroups: overlappingSkipGroups.filter((group) => group.broadRulePresent).length,
      multiPhraseAndCriteria: multiPhraseAnd.length,
      securitySkipRisk: securitySkipRisk.length,
    },
    findings: {
      overrides: view(overridden),
      marksRead: view(marksRead),
      destructiveOrForwarding: view(destructiveOrForwarding),
      missingBase: view(missingBase),
      baseMissingNeverSpam: view(baseMissingNeverSpam),
      specificAppliesLabel: view(specificAppliesLabel),
      missingNeverSpam: view(missingNeverSpam),
      broadSkipReview: view(broadSkips),
      multiPhraseAndCriteria: view(multiPhraseAnd),
      securitySkipRisk: view(securitySkipRisk),
      exactDuplicates: exactDuplicates.map(view),
      overlappingSkipGroups,
      missingLabelReferences: view(missingLabelReferences),
      unclassified: view(unclassified),
    },
    taxonomy: auditLabelTaxonomy(labels),
  };
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""));
  process.stdout.write(`${JSON.stringify(auditFilterState(input), null, 2)}\n`);
}

const invokedPath = globalThis.process?.argv?.[1];
const invokedUrl = invokedPath ? pathToFileURL(realpathSync(invokedPath)).href : null;
if (invokedUrl && import.meta.url.toLowerCase() === invokedUrl.toLowerCase()) {
  await main();
}
