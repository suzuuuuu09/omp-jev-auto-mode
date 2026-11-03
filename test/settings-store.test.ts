import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS, JevAutoModeStore } from "../src/settings.ts";
import { register, type GateContext } from "../src/extension.ts";

test("settings saves preserve linked dotfiles and reject dangling links", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-settings-"));

  try {
    const source = new JevAutoModeStore({ agentDir: join(root, "dotfiles") });
    await source.saveSettings(DEFAULT_SETTINGS);
    assert.deepEqual(await source.loadSettings(), DEFAULT_SETTINGS);

    const linked = new JevAutoModeStore({ agentDir: root });
    await symlink(source.globalSettingsPath(), linked.globalSettingsPath());
    const changed = { ...DEFAULT_SETTINGS, enabled: !DEFAULT_SETTINGS.enabled };
    await linked.saveSettings(changed);

    assert.equal((await lstat(linked.globalSettingsPath())).isSymbolicLink(), true);
    assert.deepEqual(JSON.parse(await readFile(source.globalSettingsPath(), "utf8")), changed);

    await rm(source.globalSettingsPath());
    await assert.rejects(linked.saveSettings(DEFAULT_SETTINGS));
    assert.equal((await lstat(linked.globalSettingsPath())).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project changes preserve inheritance and threshold reset takes effect immediately", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-project-settings-"));
  try {
    const project = join(root, "repo");
    await mkdir(join(project, ".git"), { recursive: true });
    await mkdir(join(project, ".omp"));
    await mkdir(join(project, "src"));
    const store = new JevAutoModeStore({ agentDir: join(root, "agent") });
    await store.saveSettings({ ...DEFAULT_SETTINGS, timeoutMs: 5000, thresholds: { local_scope: 0.95 } });
    const path = store.projectSettingsPath(project);
    await writeFile(path, JSON.stringify({ thresholds: { local_scope: 0.85 } }));

    let command!: (args: string, ctx: GateContext) => Promise<void>;
    const notices: string[] = [];
    const context: GateContext = {
      cwd: join(project, "src"),
      hasUI: true,
      sessionManager: {},
      ui: {
        notify: (message) => { notices.push(message); },
        select: async () => "local_scope",
        confirm: async () => false,
        input: async () => "0.86",
        editor: async () => undefined,
        setStatus: () => {},
      },
    };
    register({
      registerFlag: () => {}, getFlag: () => false, on: () => {},
      registerCommand: (_name: string, options: { handler: typeof command }) => { command = options.handler; },
    } as unknown as Parameters<typeof register>[0], {
      store, record: () => {}, engine: { id: "mock", judge: async () => ({ verdict: "allow", rationale: "test" }) },
    });

    await command("off", context);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      enabled: false, thresholds: { local_scope: 0.85 },
    });
    await store.saveSettings({ ...DEFAULT_SETTINGS, timeoutMs: 8000, thresholds: { local_scope: 0.95 } });
    assert.equal((await store.loadSettings(project)).timeoutMs, 8000);

    await command("threshold local_scope reset", context);
    assert.match(notices.at(-1)!, /0\.95/);
    assert.equal((await store.loadSettings(project)).thresholds.local_scope, 0.95);

    await command("on", context);
    await command("scope matched", context);
    await command("uncertain deny", context);
    await command("threshold local_scope 0.87", context);
    assert.equal((await store.loadSettings(project)).thresholds.local_scope, 0.87);
    await command("threshold reset", context);
    assert.equal((await store.loadSettings(project)).thresholds.local_scope, 0.95);
    await command("threshold edit", context);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
      enabled: true, gateScope: "matched", uncertain: "deny", thresholds: { local_scope: 0.86 },
    });

    const otherProject = join(root, "other-repo");
    await mkdir(otherProject);
    await writeFile(join(otherProject, ".git"), "gitdir: ../worktree-metadata");
    await command("uncertain allow", { ...context, cwd: otherProject });
    assert.equal((await store.loadSettings()).uncertain, "allow");
    assert.equal((await store.loadSettings(project)).uncertain, "deny");
    assert.equal((await store.loadSettings()).thresholds.local_scope, 0.95);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project saves preserve links whose targets stay inside the repository", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-local-links-"));
  try {
    const store = new JevAutoModeStore({ agentDir: join(root, "agent") });
    const fileProject = join(root, "file-link");
    await mkdir(join(fileProject, ".omp"), { recursive: true });
    const source = join(fileProject, "settings.json");
    await writeFile(source, "{}");
    const fileLink = store.projectSettingsPath(fileProject);
    await symlink(source, fileLink);
    await store.updateSettings((overrides) => ({ ...overrides, enabled: false }), fileProject);
    assert.equal((await lstat(fileLink)).isSymbolicLink(), true);
    assert.deepEqual(JSON.parse(await readFile(source, "utf8")), { enabled: false });

    const directoryProject = join(root, "directory-link");
    const directorySource = join(directoryProject, "config");
    await mkdir(directorySource, { recursive: true });
    await writeFile(join(directorySource, "jev-auto-mode.json"), "{}");
    await symlink(directorySource, join(directoryProject, ".omp"));
    await store.updateSettings((overrides) => ({ ...overrides, enabled: false }), directoryProject);
    assert.equal((await store.loadSettings(directoryProject)).enabled, false);
    assert.equal((await lstat(join(directoryProject, ".omp"))).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("project saves reject outside and dangling links without changing global settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-project-links-"));
  try {
    const store = new JevAutoModeStore({ agentDir: join(root, "agent") });
    await store.saveSettings(DEFAULT_SETTINGS);
    const outside = join(root, "notes.txt");
    await writeFile(outside, "user notes");
    const outsideDirectory = join(root, "outside");
    await mkdir(outsideDirectory);
    await writeFile(join(outsideDirectory, "jev-auto-mode.json"), "{}");

    for (const kind of ["file-outside", "file-dangling", "directory-outside", "directory-dangling"]) {
      const project = join(root, kind);
      await mkdir(project);
      const path = store.projectSettingsPath(project);
      if (kind.startsWith("file")) {
        await mkdir(join(project, ".omp"));
        await symlink(kind === "file-outside" ? outside : join(root, "missing.json"), path);
      } else {
        await symlink(kind === "directory-outside" ? outsideDirectory : join(root, "missing-directory"), join(project, ".omp"));
      }

      await assert.rejects(store.saveSettings({ ...DEFAULT_SETTINGS, enabled: false }, project), kind);
      assert.equal(await readFile(outside, "utf8"), "user notes");
      assert.equal(await readFile(join(outsideDirectory, "jev-auto-mode.json"), "utf8"), "{}");
      assert.deepEqual(await store.loadSettings(), DEFAULT_SETTINGS);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
