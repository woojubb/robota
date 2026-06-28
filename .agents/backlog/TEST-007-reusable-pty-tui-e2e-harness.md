---
title: 'TEST-007: reusable PTY-driven TUI E2E harness (terminal-handoff scenarios + consolidation)'
status: in-progress
created: 2026-06-28
priority: high
urgency: soon
area: packages/agent-transport-tui
depends_on: [TERM-002, TERM-003, TERM-004]
---

# Reusable PTY-driven TUI end-to-end test harness

Turn the previously "manual-only" terminal-handoff verification into a **reusable, automated** PTY
test harness, then use it to add machine evidence for the terminal-handoff feature (TERM-002/003/004)
so those items can leave their manual-smoke gate behind.

## Motivation

TERM-002/003/004 are blocked at `in-progress` because their core behavior — Ink releasing raw mode,
a child process receiving the **real** terminal's keystrokes through `runWithTerminal`, then the TUI
restoring cleanly — can only be observed on a live interactive TTY, which the unit-test environment
(ink-testing-library, piped stdio) cannot reproduce. A throwaway `python3 pty.fork()` exploration
proved the mechanism works end to end (a child spawned with `stdio:'inherit'` during an Ink suspend
received scripted keystrokes), but it also surfaced a possible real defect: in that ad-hoc harness
`runWithTerminal` did **not** return after the child exited (a 30s hang), which — if real — means the
TUI would never resume after `/shell`. That throwaway script must not become the verification path.

The repo **already** has the right primitive: `@homebridge/node-pty-prebuilt-multiarch` (a prebuilt
PTY — no native compile in CI) is a devDependency of `agent-transport-tui`, with two existing,
partially duplicated harnesses:

- `src/__tests__/pty/pty-driver.ts` (`spawnTui` / `IPtySession`) — drives the **built** robota CLI
  binary in a real PTY; lives in the dedicated `*.ptytest.ts` vitest project (`pnpm … test:pty`,
  `vitest.pty.config.ts`, serial, 60s).
- `src/__tests__/provider-setup-pty-e2e.test.ts` (inline `createHarness` / `IPtyHarness`) — runs a
  **TSX fixture** (`fixtures/provider-setup-prompt-driver.tsx`) via the `tsx/esm` import hook inside a
  PTY and captures a JSON result file; runs in the **default** test suite (no CLI build needed).

This item consolidates those two into one shared harness and adds terminal-handoff scenarios as its
first new consumers. The `python3`-based exploration is deleted (node-pty is the repo standard).

## What

1. **Consolidate** the two PTY harnesses into one reusable module under `src/__tests__/pty/`
   exposing a single API that supersedes both `spawnTui` and the inline `createHarness`:
   - a `spawnPty({ command, args, cwd, env, cols, rows })` core returning a session with
     `sendKeys(text, perKeyDelayMs)` (per-key paced to avoid bracketed-paste bundling — the reason
     the existing driver exists), `pressEnter()`, `waitFor(pattern|text, timeoutMs)`,
     `snapshot()` (ANSI-stripped), `expectExit(timeoutMs)`, and `kill()`/`dispose()`;
   - a **built-CLI** convenience (current `spawnTui` behavior: resolve `packages/agent-cli/bin`,
     isolated `HOME`, provider settings) for `*.ptytest.ts`;
   - a **TSX-fixture** convenience (`spawnPtyFixture(fixturePath, { argv, outputPath })` using the
     `tsx/esm` import hook + JSON result capture) for default-suite source-level E2E.
   - Re-point `pty-driver.ts` and `provider-setup-pty-e2e.test.ts` at the shared module so there is
     exactly one PTY harness implementation (no behavior change to those existing tests).

2. **Terminal-handoff scenarios** (new fixtures + tests, the first consumers of the shared harness):
   - **TERM-002 handoff** — a fixture rendering a minimal real Ink app that uses the **real**
     `TerminalHandoffController` + `useTerminalHandoffSuspension`, performs `runWithTerminal` around a
     child that reads one line from the inherited TTY and echoes it; the harness sends keystrokes
     after the handoff begins and asserts: `canHandoffTerminal === true`, the child received the
     input (raw mode was released), `runWithTerminal` **returned** after the child exited, and the
     display resumed. **This is where the 30s-hang must be root-caused** (real resume bug vs. harness
     timing artifact) and fixed/closed out.
   - **TERM-003 `/shell`** — drive the built CLI (or a fixture composing the shell command module),
     run `/shell` with a one-shot command, assert the child ran on the real terminal, the exit code
     is reported, and the TUI restored.
   - **TERM-004 `/editor`** — drive `/editor` with a scripted fake `$EDITOR` that writes known
     content; assert the round-trip text reaches the prompt and the TUI restored.

3. **Integration**: decide and document where each scenario runs — fixture-driven handoff scenarios
   in the **default** suite (fast, no CLI build, mirrors `provider-setup-pty-e2e`); full `/shell` and
   `/editor` CLI paths as `*.ptytest.ts` (built binary). Keep PTY runs serial / `pool: 'forks'` as
   the existing pty config already does. If any scenario proves unstable in CI, gate it behind the
   `*.ptytest.ts` project (build-gated, not in the default run) and `log()` that decision in the test
   header — never silently skip.

4. **Cleanup**: delete the throwaway `packages/agent-transport-tui/scripts/verify-handoff-pty.tsx`
   and `verify-handoff-pty.py` once the node-pty scenario reproduces (and improves on) their result.

## Design notes

- **Why node-pty, not python.** The repo already depends on `@homebridge/node-pty-prebuilt-multiarch`
  (prebuilt binaries → no compiler needed in CI), already runs PTY E2E in the default suite, and
  keeps the test stack pure Node/TS (no python runtime dependency). The python exploration was only
  to confirm the mechanism; it is not the shipping harness.
- **Marker protocol.** Fixtures emit unambiguous markers (e.g. `@@HANDOFF_STARTED@@`,
  `CHILD_GOT:[…]`, `@@RESUMED exit=N@@`) and/or write a JSON result file; the harness keys
  `waitFor`/assertions off those, exactly like `provider-setup-prompt-driver.tsx` writes
  `result.json`.
- **Platform boundary.** Harness and handoff fixtures stay platform-neutral Node/Ink; any shell use
  belongs to the consumer scenario (`/shell`), consistent with the agent-framework vs. agent-command
  boundary. Windows remains out of scope (TERM-007); PTY scenarios are macOS/Linux-first.

## Done When

- One shared PTY harness module exists under `src/__tests__/pty/`; `pty-driver.ts` and
  `provider-setup-pty-e2e.test.ts` consume it with no behavior change (both still green).
- TERM-002/003/004 each have an automated PTY scenario that passes locally; the 30s-hang is
  root-caused and either fixed (if a real resume bug) or shown to be a harness artifact with the fix
  in the harness.
- The throwaway `scripts/verify-handoff-pty.*` files are removed.
- `pnpm --filter @robota-sdk/agent-transport-tui test` (and `test:pty` where used) green;
  `pnpm typecheck`, `pnpm lint`, `pnpm harness:scan` green.

## Test Plan

- The new harness has a self-test (mirrors `scripted-session-harness.test.ts`'s self-test posture):
  a trivial fixture that prints a marker and exits, driven through `spawnPty`, asserting
  `waitFor` + `expectExit`.
- Each terminal-handoff scenario passes via the chosen vitest project (default or `test:pty`).
- Re-pointed existing tests (`provider-setup-pty-e2e`, the CLI `*.ptytest.ts` suites) remain green —
  proving the consolidation is behavior-preserving.
- typecheck / lint / `pnpm harness:scan` green.

## Evidence (2026-06-28)

- **Shared harness:** `src/__tests__/pty/spawn-pty.ts` (`spawnPty` + `spawnPtyFixture`) with a
  self-test `src/__tests__/pty/spawn-pty.test.ts` (2 tests). `pty-driver.ts` (`spawnTui`) and
  `provider-setup-pty-e2e.test.ts` re-pointed onto it; provider-setup PTY E2E stays green (2 tests,
  ≈1.2s).
- **Source-level scenarios (default suite):** `terminal-handoff-pty-e2e.test.ts` (TERM-002, 1 test)
  and `command-handoff-pty-e2e.test.ts` (TERM-003 `/shell` + TERM-004 `/editor`, 2 tests) all pass on
  a real pseudo-terminal.
- **Real-binary scenario (`test:pty` project):** `src/__tests__/pty/terminal-handoff.ptytest.ts`
  (TC-09) drives the **built** CLI through `/shell` end to end and asserts the child ran on the real
  terminal and the TUI restored — automated user-execution-level evidence (TERM-003).
- **30s-hang root-caused as a real bug and fixed** in `terminal-handoff-controller.ts` (parent stdin
  not released on suspend → event-loop starvation → child exit never observed). Detail in TERM-002.
- **Second pre-existing bug found by the consolidation:** `pty-driver.ts` `REPO_ROOT` was off by one
  (`../../../../../..` → 6 ups → `/dev`, missing `/robota`), so the built-CLI `*.ptytest.ts` suite
  could never resolve the binary. Fixed to 5 ups; `tui-pty.ptytest.ts` (TC-07/08) now green.
- **Throwaway removed:** `scripts/verify-handoff-pty.{tsx,py}` deleted (node-pty is the repo standard).
- Gates: TUI typecheck clean; full TUI suite 393 tests pass; `test:pty` 3 tests pass;
  `pnpm harness:scan` 33/33 green.

## User Execution Test Scenarios

Not applicable as a standalone product change — this is agent-facing internal test infrastructure,
validated by its own self-test and the re-pointed existing PTY suites (recorded as Test Plan
evidence). Its **product** value is unblocking the user execution test scenario gates of
TERM-002/003/004: once the automated PTY scenarios provide machine evidence for raw-mode release,
child TTY input, and clean resume, those items' manual-smoke gates are satisfied by this harness and
they can be moved to done (each retaining its own user execution test scenario, now backed by an
automated reproduction).
