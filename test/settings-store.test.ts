import { lstat, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_SETTINGS, JevAutoModeStore } from "../src/settings.ts";

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
