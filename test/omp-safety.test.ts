import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SETTINGS, JevAutoModeStore } from "../src/settings.ts";
import { buildConfirmationDialog } from "../src/ui.ts";
import { hardDenyReasons, protectedPathReason, isReadOnlyCommandChain } from "../src/policy.ts";

test("uncertain calls require user confirmation by default", () => {
  assert.equal(DEFAULT_SETTINGS.uncertain, "ask");
  assert.equal(DEFAULT_SETTINGS.gateScope, "all");
});

test("destructive home deletion never reaches Jev", () => {
  assert.ok(hardDenyReasons("rm -rf ~/").length > 0);
});

test("OMP extension files are protected", () => {
  assert.ok(protectedPathReason("/home/suzu/.omp/agent/extensions/test.ts"));
});

test("read-only command chains use the fast path", () => {
  assert.equal(isReadOnlyCommandChain("git status && rg foo src"), true);
  assert.equal(isReadOnlyCommandChain("git status && rm -rf build"), false);
});

test("confirmation dialogs show only the essentials", () => {
  const dialog = buildConfirmationDialog({
    tool: "bash",
    command: "rm -rf build",
    reasons: ["recursive delete"],
    rationale: "Long model rationale should not appear in the short prompt",
  });
  assert.match(dialog, /Confirm: bash/);
  assert.match(dialog, /rm -rf build/);
  assert.match(dialog, /recursive delete/);
  assert.doesNotMatch(dialog, /Long model rationale/);
  assert.ok(dialog.split("\n").length <= 3);
});

test("untrusted project overrides cannot turn off the global guard", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-jev-"));
  const agentDir = join(root, "agent");
  const projectDir = join(root, "workspace");
  try {
    await mkdir(agentDir, { recursive: true });
    await mkdir(join(projectDir, ".omp"), { recursive: true });
    await writeFile(join(agentDir, "jev-auto-mode.json"), JSON.stringify({ enabled: true }));
    await writeFile(join(projectDir, ".omp", "jev-auto-mode.json"), JSON.stringify({ enabled: false }));
    const store = new JevAutoModeStore({ agentDir, configDirName: ".omp" });
    const result = await store.loadSettings(projectDir, false);
    assert.equal(result.settings.enabled, true);
    assert.equal(result.scope, "global");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
