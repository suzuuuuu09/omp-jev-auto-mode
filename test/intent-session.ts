import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DEFAULT_INTENT_OPTIONS, extractRecentIntent, messageText } from "../src/intent.ts";

interface SessionEntry {
  id?: string;
  parentId?: string;
  type?: string;
  customType?: string;
  data?: { summary?: string; probabilities?: Record<string, number>; conditions?: { ruleId: string }[] };
  message?: { role?: string; content?: unknown; customType?: string };
}

interface SessionCase {
  id: string;
  messages: string[];
  command: string;
  expected: string;
  historicalProbability: number | undefined;
  askedRuleIds: string[];
}

// Private text stays in memory: callers log only case IDs, lengths, and scores.
export function sessionCases(path: string) {
  let entries: SessionEntry[];
  try {
    entries = readFileSync(path, "utf8").trim().split("\n").map((line) => JSON.parse(line) as SessionEntry);
  } catch {
    throw new Error("Cannot read or parse the local session");
  }
  const byId = new Map(entries.filter((entry) => entry.id).map((entry) => [entry.id, entry]));
  const cases: SessionCase[] = [];

  for (const record of entries) {
    if (record.customType !== "jev-auto-mode-decision") continue;
    const command = record.data?.summary ?? "";
    if (command !== "slackcli --help" && !command.startsWith("slackcli conversations read ")) continue;

    const branch: SessionEntry[] = [];
    const seen = new Set<string | undefined>();
    assert.ok(record.parentId && byId.has(record.parentId), "Missing decision ancestor");
    let entry = byId.get(record.parentId);
    while (entry) {
      assert.ok(!seen.has(entry.id), "Session branch contains a cycle");
      seen.add(entry.id);
      branch.push(entry);
      assert.ok(!entry.parentId || byId.has(entry.parentId), "Missing session ancestor");
      entry = byId.get(entry.parentId);
    }
    branch.reverse();

    const messages = branch
      .filter((item) => item.type === "message" && item.message?.role === "user" && !item.message.customType)
      .map((item) => messageText(item.message?.content))
      .filter(Boolean)
      .slice(-DEFAULT_INTENT_OPTIONS.maxMessages);
    const id = command === "slackcli --help" ? "session-help" : "session-indirect-read";
    if (cases.some((item) => item.id === id)) continue;
    if (id === "session-indirect-read" && messages.at(-1) !== "そういえばslack返信来たみたい") continue;

    assert.ok(messages.join("\n\n") === extractRecentIntent(branch), "Session requires truncation; cannot preserve exact turn boundaries");
    const askedRuleIds = record.data?.conditions?.map((condition) => condition.ruleId);
    assert.ok(askedRuleIds, "Missing recorded questions");
    assert.ok(askedRuleIds.includes("intent_coverage"), "Missing recorded intent question");
    const historicalProbability = record.data?.probabilities?.intent_coverage;
    assert.ok(
      typeof historicalProbability === "number" && Number.isFinite(historicalProbability)
        && historicalProbability >= 0 && historicalProbability <= 1,
      "Missing recorded intent probability",
    );
    cases.push({
      id, messages, command, expected: id === "session-help" ? "related" : "ambiguous",
      historicalProbability, askedRuleIds,
    });
  }

  assert.equal(cases.length, 2, "Both Slack source decisions are required");
  return cases;
}
