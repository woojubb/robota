---
title: "TEST-012: framework session initialisation reads the real user home with no seam, so tests execute whatever the developer's machine has"
issue: https://github.com/woojubb/robota/issues/2300
status: todo
created: 2026-08-28
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-session, vitest setup
depends_on: []
---

# TEST-012: framework session initialisation reads the real user home with no seam

## Problem

`InteractiveSession`'s default initialisation path reads the developer's real home —
`process.env.HOME/.claude/settings.json`, `~/.robota/settings.json`, `~/.robota/plugins` — through
defaults with no injectable seam, while the CLI composition layer above it already parameterises
`userHome`. The test harness provides no `HOME` isolation. So every test that constructs a session
without injecting a home runs whatever hooks and skills the developer's machine has, and its result
moves with the machine rather than with the code.

Issue #2300 filed the class from its first instance (PR #2296: a test satisfied by 13 unrelated skills
in `~/.claude/skills`). This record exists because the second instance arrived through a sibling
default, and issue #2300 had no Task record to contain it under.

## Evidence

Measured on `develop` `bb4c3626e` (2026-08-28), by `finding-depth-triager` on issue #2383 and
re-verified by hand:

- `packages/agent-framework/src/config/settings-source.ts:37-38` —
  `createDefaultUserSettingsSources(userHome = process.env.HOME ?? process.env.USERPROFILE ?? '/')`.
- `packages/agent-framework/src/contributions/initial-contribution-sources.ts:12,20` — `userHome = homedir()`.
- Callers inside the framework pass nothing: `interactive-session-project-context.ts:41`,
  `interactive-session-provider-switch.ts:17`; `interactive-session-init.ts:91` reads `homedir()` for
  plugins; a third no-argument caller is the exported test fixture
  `packages/agent-framework/src/testing/trusted-project-state-fixture.ts:86`, so a fixture meant to
  isolate a test itself reads the real home. The CLI threads `options.userHome`
  (`packages/agent-cli/src/startup/workspace-project-composition.ts:70,130`).
- A planted hook is loaded only in the shape `{ matcher: '', hooks: [{ type: 'command', … }] }`;
  without `matcher` it is silently dropped (measured while prototyping RUNTIME-007's decoy home) —
  worth its own line, because a fixture written without it would read as "isolation works".
- `os.homedir()` follows `process.env.HOME` only in a forked worker (measured: a `worker_thread`
  returns the real home). `vitest.shared.ts` sets `pool: 'forks'`, so a setup-file `HOME` isolation
  (remedy 1) is sufficient today and silently insufficient after a pool change — the remedy's floor
  must assert the pool or assert `homedir()` directly.
- No `setupFiles` or `env` in `vitest.config.ts` or `packages/agent-framework/vitest.config.ts` isolates `HOME`.
- Second instance, issue #2383: `runtime-host.test.ts` is red on `develop` for any developer whose
  `~/.claude/settings.json` defines a SessionStart command hook — the hook's per-command timeout
  (`packages/agent-core/src/hooks/executors/command-executor.ts:106`) is the "extra" `Timeout` the
  test counts. Control: `HOME=<empty dir>` → 5/5 pass; real HOME → 1 failed. Only `HOME` differed.
- issue #2300's sizing run ("real vs empty HOME: nothing moves") was taken at `ac941795b` (2026-08-25) on a
  machine with no SessionStart hook; it postdates this test (`8690be20f`, 2026-08-18) and was
  host-specific, so its "zero remaining" does not hold. By grep, 28–35 test files (by three grep heuristics: constructor, factory, `startRuntimeHost`/`createInteractiveRuntime`) construct an
  `InteractiveSession` (directly, via `startRuntimeHost`, or `createInteractiveRuntime`); ≈14 neither
  inject a session, mock initialisation, pass `config:`, nor set `HOME` — a heuristic count, to be
  settled by running each under real vs empty `HOME`.

## Reproduction condition

Any test constructing an `InteractiveSession` without an injected session or `config:`, on a machine
whose `~/.claude/settings.json`, `~/.robota/settings.json` or `~/.robota/plugins` is non-empty. Both
directions occur: PR #2296 was green-local/red-CI (host state satisfied an assertion); issue #2383 is
red-local/green-CI (host state broke one).

## Why it is its own item

The remedy is a design decision issue #2300 lists and nobody has chosen: (1) make the default unavailable in
tests — a vitest setup file pointing `HOME` at a per-suite empty directory, so host-like state must be
constructed explicitly; (2) a second CI job under an empty `HOME` (a backstop for the positive half
only); (3) a scan for test files calling a factory whose parameter defaults to
`homedir()`/`process.env.HOME` without passing one; and a `userHome`/settings-source seam on the
session's option surface, which belongs with the SessionRecipe kernel (issue #2063 → issue #2084/#2115) rather
than as a fourth ad-hoc parameter. Fixing the instance in one test leaves the other ≈14 files and the
next one to be written.

**Contained under this item:** RUNTIME-007 (issue #2383) isolates `HOME` in `runtime-host.test.ts`
and carries `Contained — TEST-012.` at the isolation site.

Not this item: the process-wide timer count in the same test (RUNTIME-007's LOCAL half); hook
enforcement policy for fire-and-forget SessionStart (issue #2075 / issue #2093).

## Test Plan

- A fixture test that plants a SessionStart command hook in a decoy home and asserts a session
  constructed under the chosen isolation does NOT execute it — red before the remedy.
- The sizing run from issue #2300, re-taken on a machine WITH a SessionStart hook: real vs empty `HOME`,
  per test file; recorded, not asserted.
- Whichever remedy is chosen: its mechanical floor (setup file or scan) with an applied-check
  mutation — removing the isolation must make the fixture test red.

## User Execution Test Scenarios

Not applicable — test infrastructure and framework seams; no product surface. To be re-judged by
`user-execution-scenario-author` when the item is picked up.
