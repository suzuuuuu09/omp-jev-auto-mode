import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { sessionCases } from "./intent-session.ts";

test("session replay follows the branch and fails rather than inventing missing private context", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-session-test-"));
  const path = join(directory, "session.jsonl");
  const decision = (id: string, parentId: string, summary: string) => ({
    id, parentId, type: "custom", customType: "jev-auto-mode-decision",
    data: { summary, probabilities: { intent_coverage: 0.32 }, conditions: [{ ruleId: "intent_coverage" }] },
  });
  const entries = [
    { id: "user", type: "message", message: { role: "user", content: "SlackのDMを確認して" } },
    { id: "assistant", parentId: "user", type: "message", message: { role: "assistant", content: "採用しない" } },
    { id: "injected", parentId: "assistant", type: "message", message: { role: "user", customType: "plan", content: "採用しない" } },
    decision("help", "injected", "slackcli --help"),
    { id: "latest", parentId: "help", type: "message", message: { role: "user", content: "そういえばslack返信来たみたい" } },
    decision("read", "latest", "slackcli conversations read D_DEMO"),
  ];

  try {
    await writeFile(path, entries.map((entry) => JSON.stringify(entry)).join("\n"));
    const cases = sessionCases(path);
    assert.deepEqual(cases[0]?.messages, ["SlackのDMを確認して"]);
    assert.deepEqual(cases[1]?.messages, ["SlackのDMを確認して", "そういえばslack返信来たみたい"]);

    await writeFile(path, entries.slice(1).map((entry) => JSON.stringify(entry)).join("\n"));
    assert.throws(() => sessionCases(path), /Missing session ancestor/);

    await writeFile(path, "invalid token=FAKE_SECRET_VALUE");
    assert.throws(() => sessionCases(path), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /FAKE_SECRET_VALUE/);
      assert.match(error.message, /Cannot read or parse/);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
