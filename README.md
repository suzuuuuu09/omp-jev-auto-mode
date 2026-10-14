# OMP Jev Auto Mode

An experimental Jev-powered tool-call guard for [Oh My Pi](https://github.com/can1357/oh-my-pi) (OMP), adapted from [jomatsu/pi-jev-auto-mode](https://github.com/jomatsu/pi-jev-auto-mode) (MIT).

> **Experimental:** OMP and TypeSafe integration has not been tested end-to-end. This is a tool-call guard, **not** a filesystem sandbox.

## Differences from upstream

- Uses the OMP extension API.
- `uncertain: ask` by default; without a UI or when Jev cannot decide, escalated operations are blocked.
- Blocks the `eval` tool while the extension is enabled: eval can invoke shell commands outside the bash guard.
- Protects `.omp` and `.herdr` paths in addition to upstream protected paths.
- Ignores project-local Jev settings: OMP currently treats all projects as trusted, so allowing project overrides could disable the global gate.
- Short confirmation dialog, and audit records stored in session metadata.
- Commands with write or execution options (`find`, `sort`, `rg`, `xxd`, Git diff/log/show, and similar tools) go through Jev rather than the built-in read-only fast path. Explicit user safe-command patterns still take precedence.
- Jev sees the complete redacted command. Requests exceeding the configured character budget are blocked before sending.
- Upstream display settings and project-setting APIs are removed. Existing global files still load; legacy `display` fields are ignored.

## Local development

```fish
git clone https://github.com/suzuuuuu09/omp-jev-auto-mode.git ~/src/omp-jev-auto-mode
cd ~/src/omp-jev-auto-mode
bun install
bun run check

# Test in an isolated OMP session
omp --no-extensions -e (pwd)/index.ts
```

Disable other copies of `pi-jev-auto-mode` or `jev-guard` to prevent duplicate handlers. Configure `TYPESAFE_API_KEY` in the environment or use `/jev-auto-mode login`. Login stores the key under your OMP agent directory, outside the repository, with owner-only file permissions.

For persistent loading, configure OMP's `extensions:` setting or symlink the checkout into `~/.omp/agent/extensions/`. Keep actual credentials out of Git and Nix store.

## OMP approval policy

This extension is **additional to** OMP's built-in approval engine; a call allowed here may still trigger OMP's own prompt. Consider `tools.approval.eval: deny` as defense in depth. Do **not** blindly switch the global mode to `yolo`: it affects tools outside this extension's scope. This repository does not change approval settings automatically.

## Limitations

- Original policy: fixed hard-deny checks precede the Jev decision. `bash`, `write`, `edit` are inspected, but normal in-workspace writes are allowed as upstream does.
- Path tests are lexical. Symlinks, custom tools, subagents, direct eval prelude operations and manual shell executions are not necessarily covered.
- Herdr OS notifications have **not been verified**. This port emits ordinary OMP notifications on a block.
- Jev receives command text, target paths, user intent and contextual data, with **best-effort** secret masking; never consider that comprehensive protection.

## Development

```fish
bun install
bun run check
```

## License

MIT. Original copyright (c) 2026 jomatsu. See [LICENSE](LICENSE). This repository contains modified copies of upstream source.
