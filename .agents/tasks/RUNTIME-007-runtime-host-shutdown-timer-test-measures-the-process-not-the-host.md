---
title: "RUNTIME-007: runtime-host's shutdown timer test measures the process, not the host, and reads the developer's home"
issue: https://github.com/woojubb/robota/issues/2383
status: in-progress
created: 2026-08-28
priority: high
urgency: now
area: packages/agent-framework
depends_on: []
---

# RUNTIME-007: runtime-host's shutdown timer test measures the process, not the host

## Problem

`packages/agent-framework/src/runtime/__tests__/runtime-host.test.ts:102-106`
(`shutdown() leaves no timer holding the event loop open (#1852)`, quoting the test title) is red on `develop` itself for
any developer whose `~/.claude/settings.json` defines a SessionStart command hook, and its assertion
cannot tell a timer the host leaked from a timer anything else in the process armed.

## Evidence

Re-measured on `develop` `bb4c3626e` (2026-08-28 00:08 KST), not taken from the issue:

```
$ cd packages/agent-framework && pnpm exec vitest run src/runtime/__tests__/runtime-host.test.ts
× shutdown() leaves no timer holding the event loop open (issue #1852)
  → expected 3 to be less than or equal to 2            Tests 1 failed | 4 passed (5)   exit 1
$ HOME=$(mktemp -d)/home  (empty)  … same command
  Tests 5 passed (5)                                                                    exit 0
$ python3 -c 'json.load(open("$HOME/.claude/settings.json"))["hooks"]'   → {'SessionStart': 1}
```

Only `HOME` differed between the two runs. The cause, traced by an `async_hooks` probe that records
each `Timeout`'s creation site: the one `Timeout` alive after `host.shutdown()` is the per-hook
timeout armed at `packages/agent-core/src/hooks/executors/command-executor.ts:106` for the user's
SessionStart command hook, which the session fires from its constructor
(`packages/agent-session/src/session.ts:158`, fire-and-forget by policy —
`packages/agent-core/src/hooks/enforcement-policy.ts:107`). The session reaches the developer's home
through `createDefaultUserSettingsSources()`'s default
(`packages/agent-framework/src/config/settings-source.ts:37-38`: `process.env.HOME`), called with no
argument from `interactive-session-project-context.ts:41` and `interactive-session-provider-switch.ts:17`.

So the issue's headline holds and its mechanism paragraph does not: the extra timer is not "timers
vitest and other in-flight work own" — it is the session's own hook timeout, sourced from the
machine. The test's process-wide count (`process.getActiveResourcesInfo()`) is still the wrong
instrument: a vitest timer expiring during the ~10 ms shutdown window reads as green, an unrelated
timer arming reads as red, and neither says anything about the host.

## Depth verdict

`finding-depth-triager` (2026-08-27), three verdicts in one:

- **LOCAL** — the measurement. The count is process-wide; the property named is the host's. Fixed
  here by tracking the `Timeout` resources created between `startRuntimeHost` and the end of
  `shutdown()` by identity and asserting none of them is still alive and ref'd.
- **FOUNDATIONAL** — the red. The framework's session initialisation reads the real user home with
  no seam and the test harness isolates nothing; an exposed subset of the 28–35 session-constructing
  test files shares the default (its size is TEST-012's to settle). The class is issue #2300's, which had no Task record; the root item is
  **TEST-012** (`.agents/tasks/TEST-012-framework-session-init-reads-the-real-user-home-with-no-seam.md`,
  registered as issue #2300). This Task isolates `HOME` in this one file as a **labelled
  containment** — `Contained — TEST-012.` at the isolation site and in the commit body — the
  smallest change that makes the red mean what the test says, with no new abstraction.
- **INVALID** — "`shutdown()` on a never-initialised session runs full initialisation and fires
  SessionStart hooks". The constructor starts initialisation
  (`interactive-session.ts:289`); `shutdown()` at `:584` awaits it so it has a `Session` to tear
  down; the hook fires on `Session` construction. No product defect is underneath.

Not this Task: the choice of class remedy (global `HOME` isolation, a scan, or a `userHome` seam on
the session's options, sequenced with the SessionRecipe kernel issue #2063/#2084/#2115) — TEST-012. The
fire-and-forget hook policy — issue #2075/#2093. The issue's report that the same tree passed under
`harness:verify-like-ci` → `affected-verify` is **undetermined**: it did not reproduce in the
re-measurement, and a vitest timer expiring inside the shutdown window is a sufficient explanation
under the old count but was not observed.

## Recommendation gate

`proposal-reviewer`, three rounds on 2026-08-28: REVISE (the async_hooks bracket read synchronously
after `shutdown()` would report the cancelled bound as leaked — one `setImmediate` yield required; an
instrument control; TC-03's evidence arm made a reproducible decoy home) → REVISE (the control must
count inits, the leak assertion survivors; `homedir()` follows `HOME` only under `pool: 'forks'`) →
**REVIEW VERDICT: ENDORSE** (2026-08-28). Alternative chosen: A2, as a labelled containment under
TEST-012.

## Test Plan

- Replace the process-wide count with identity tracking: an `async_hooks` hook enabled before
  `startRuntimeHost` records every `Timeout` `init` in a `seen` map that is never shrunk and every
  `destroy` id in a `destroyed` set; after `shutdown()` resolves the test yields one macrotask
  (`setImmediate`) — `destroy` fires on the next check-phase turn — then asserts `seen.size >= 1`
  (the instrument saw the bound) and that no `seen` entry is undestroyed with `hasRef() === true`.
  Red under the mutant that deletes `clearTimeout(bound)` in `runtime-host.ts` (the issue #1852
  regression), recorded.
- Isolate `HOME`/`USERPROFILE` to a fresh empty directory per test in this file, restored after,
  labelled `Contained — TEST-012.`. Evidence: the file passes under a decoy home whose
  `.claude/settings.json` plants a SessionStart command hook (the shape that reproduces this
  machine's red on the unfixed test) and under an empty home.
- A control that the isolation reaches the function the session calls:
  `createDefaultUserSettingsSources()` and `homedir()` resolve under the isolated home during a test
  and under the real home once restored — `homedir()` follows `HOME` only in a forked worker
  (`pool: 'forks'`), which is why it is asserted.
- `pnpm --filter @robota-sdk/agent-framework exec vitest run` on the file and on the package;
  `pnpm harness:scan` exit 0.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. This changes one test file's measurement and its
environment isolation. No CLI command, TUI surface, published API or runtime behaviour changes; the
only observable is the test's own red/green. The verification surface is the package test run and
the recorded mutation.

## Bound spec document

`.agents/spec-docs/active/RUNTIME-007-runtime-host-shutdown-timer-test-measures-the-process-not-the-host.md`
