import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createInitialState,
  evaluateToolCall,
  type DecisionDeps,
  type GateContext,
} from "../src/extension.ts";
import { DEFAULT_SETTINGS, JevAutoModeStore } from "../src/settings.ts";
import {
  dangerousReasons,
  isReadOnlyCommandChain,
  protectedPathReason,
} from "../src/policy.ts";

test("uncertain calls require user confirmation by default", () => {
  assert.equal(DEFAULT_SETTINGS.uncertain, "ask");
  assert.equal(DEFAULT_SETTINGS.gateScope, "all");
});

test("OMP extension files are protected", () => {
  assert.ok(protectedPathReason("/home/suzu/.omp/agent/extensions/test.ts"));
});

test("ordinary search and Git inspection stay on the fast path", () => {
  for (const command of ["rg foo src", "git diff", "git log -5", "git show HEAD"]) {
    assert.equal(isReadOnlyCommandChain(command), true, command);
  }
  assert.equal(isReadOnlyCommandChain("git status && rm -rf build"), false);
});

test("global uncertainty and threshold settings survive saving and loading", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-jev-"));
  const agentDir = join(root, "agent");
  try {
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "jev-auto-mode.json"), JSON.stringify({ enabled: true }));
    const store = new JevAutoModeStore({ agentDir });
    const result = await store.loadSettings();
    assert.equal(result.enabled, true);

    await store.saveSettings({ ...result, uncertain: "deny", thresholds: { local_scope: 0.95 } });
    const saved = await store.loadSettings();
    assert.equal(saved.uncertain, "deny");
    assert.equal(saved.thresholds.local_scope, 0.95);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("commands that can write or execute code require judgment", () => {
  for (const command of [
    "sort -o /tmp/result.txt input.txt",
    "git diff --output=/tmp/result.patch",
    "find . -exec touch /tmp/x +",
    "rg --pre=sh pattern input.txt",
    "xxd -r input.hex /tmp/result.bin",
    "lsfoo",
    "rg '--pre=sh' pattern input.txt",
    "sort -o/tmp/result.txt input.txt",
    "xxd -re input.hex /tmp/result.bin",
  ]) {
    assert.equal(isReadOnlyCommandChain(command), false, command);
    if (!command.includes("lsfoo")) assert.ok(dangerousReasons(command).length > 0, command);
  }
});

test("only explicitly scoped local deletions skip Jev judgment", async () => {
  const context: GateContext = {
    cwd: "/tmp/omp-workspace",
    hasUI: true,
    sessionManager: { getBranch: () => [] },
    ui: {
      notify: () => {},
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      editor: async () => undefined,
      setStatus: () => {},
    },
  };
  let judgments = 0;
  const deps: DecisionDeps = {
    engine: {
      id: "test",
      judge: async () => {
        judgments += 1;
        return { verdict: "allow", rationale: "test" };
      },
    },
    record: () => {},
    now: Date.now,
  };

  await evaluateToolCall(
    { toolName: "bash", input: { command: "find build -type f -delete" } },
    context,
    createInitialState(),
    deps,
  );
  assert.equal(judgments, 0);

  await evaluateToolCall(
    { toolName: "bash", input: { command: "find . -delete" } },
    context,
    createInitialState(),
    deps,
  );
  assert.equal(judgments, 1);
});
