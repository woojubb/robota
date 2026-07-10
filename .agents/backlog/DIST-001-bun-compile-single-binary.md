---
title: 'DIST-001: Bun-compile single-binary distribution for agent-cli (Node path unchanged)'
status: todo
created: 2026-07-11
priority: medium
urgency: later
area: packages/agent-cli
depends_on: []
---

# Bun-compile single-binary distribution for agent-cli

Add a **Bun-based distribution path** that produces standalone single-file executables of the `robota` CLI,
**without changing the existing Node.js execution**. Bun is used ONLY for build/packaging — never at runtime, and
**no Bun-specific APIs** (`Bun.file`, `Bun.serve`, …) are introduced. The existing `robota` command and every
current `package.json` script must keep working exactly as today.

Owner requirement (2026-07-11). This is the foundation item; the release workflow (DIST-002) and the Node-less
install scripts (DIST-003) depend on it.

## What

1. **Compatibility analysis + minimal fixes.** Determine whether `packages/agent-cli` (which INFRA-028 bundles the
   entire `@robota-sdk` workspace into a single artifact; only third-party npm deps stay external) is
   `bun build --compile`-compatible. Identify anything Bun's compiler cannot handle (dynamic `require`/`import`
   patterns, native addons — e.g. any `better-sqlite3`/native transitive dep, `import.meta` usage, worker/child
   spawning of `node`, asset/`__dirname` resolution). Apply the **minimum** changes needed for Bun compile;
   do NOT restructure. Record every code change and its reason.
2. **Cross-platform compile config.** Produce executables via `bun build --compile --target=…` for:
   - macOS arm64 → `robota-darwin-arm64`
   - macOS x64 → `robota-darwin-x64`
   - Linux x64 → `robota-linux-x64`
   - Linux arm64 → `robota-linux-arm64`
   - Windows x64 → `robota-windows-x64.exe`
3. **Additive `package.json` scripts only.** Add Bun build scripts (e.g. `build:bun`, `build:bun:all`, per-target
   scripts) to `packages/agent-cli/package.json` (or root, whichever is cleaner). **Do NOT modify or remove any
   existing script.** Node build/test/lint scripts remain byte-identical.
4. **E2E smoke test for the compiled binary.** A test that runs the produced host-platform binary and asserts:
   `robota --version` (prints the version), `robota --help` (prints usage), and one **basic command execution**
   (a no-provider-call path — e.g. a help/subcommand or a print-mode invocation that does not require an API key).
   The test must skip gracefully (not fail) when Bun is unavailable in the environment.

**Constraints (hard):** existing Node.js run untouched; `robota` (Node) must not break; Bun for build/packaging
only; no Bun-only runtime APIs. If a required fix would change Node behavior, STOP and surface it rather than
proceeding.

## Non-goals

- Publishing binaries / GitHub Release upload (that is DIST-002).
- The `install.sh` / `install.ps1` scripts + hosting (that is DIST-003).
- Replacing the npm distribution or the Node entrypoint.

## Test Plan

- Compatibility spike: `bun build --compile` the host target; capture any compiler errors and the minimal fix set.
- Verify existing Node path unchanged: `pnpm --filter @robota-sdk/agent-cli build` + `test` + `typecheck` green;
  `robota --version`/`--help` via the Node entrypoint unchanged (diff the output vs pre-change).
- New E2E: run the compiled host binary for `--version` / `--help` / a basic command; assert exit 0 + expected
  output. Guard on Bun presence.
- `pnpm harness:scan` green; changeset if any published-package surface changes (likely none — scripts + E2E only).

## User Execution Test Scenarios

**Scenario A — compiled binary basic use (host platform).**

- Prerequisites: Bun installed locally; repo built.
- Steps: `bun run build:bun` (host target) → run `./robota-<os>-<arch> --version`, then `--help`, then a basic
  command (e.g. `./robota-<os>-<arch> --help <subcommand>` or a print-mode call with no API key needed).
- Expected: version string prints; help/usage prints; the basic command runs and exits 0 — no Node.js installed
  requirement for running the binary.
- Evidence: _(fill after implementation: paste the three command outputs + `file ./robota-*` showing a native
  executable.)_

**Scenario B — existing Node path unaffected.**

- Steps: with the change applied, run the current `robota` command via the Node entrypoint (`pnpm robota --version`
  / `--help` / a basic command) exactly as before.
- Expected: identical behavior/output to before this backlog; no regression.
- Evidence: _(fill after implementation: outputs + confirmation the existing scripts are unchanged.)_
