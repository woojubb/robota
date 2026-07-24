# CORE-026 — floating-promise / race repair + no-floating-promises lint

## STATUS: DONE — merged PR #1262 (squash `dd8e7e1b0`) + gate-complete, on develop (2026-07-21)

In-repo mirror (memory-mirroring rule). Host mirror: session memory `core-026-floating-promise-races.md`.

Three code-reviewer-substantiated concurrency fixes (2 premises dropped) + enabling the standard type-aware guard.

- **RUNTIME-12** — turn double-start race. `submit()` gated on `execCtrl.executing`, but the flag was set only
  AFTER the awaited `checkAndRefreshContextIfStale`, so two concurrent entries both saw idle and double-started.
  Fixed by claiming `executing` SYNCHRONOUSLY at `executePrompt` entry
  (`interactive-session-execution-controller.ts`); the refresh moved inside the try so the finally still
  releases on a refresh throw. (Lives in agent-framework's SessionExecutionController, NOT agent-session.)
- **RUNTIME-26** — route the FRAMEWORK detached floating rejections to `reportBackgroundError`
  (`interactive-session.ts` `requestWakeup` submit + `resumeGoalIfActive` init `.then`). The executor manager
  is left alone — `agent-executor` cannot reach `reportBackgroundError` (one-way dep).
- **RUNTIME-36** — the 3 `agent-transport/src/headless/` slash-command runners `.catch → onError` (fail-closed
  non-zero exit, no hung promise); `agent-cli print-mode` wraps run/runGoal in try/catch with
  `process.exit(getExitCode())` OUTSIDE the try (else a test-mocked `exit(0)` throw is caught → wrong exit).
- **RUNTIME-21/24 DROPPED** — no real defect (runStream finalizes on generator return; Session.run wires the
  AbortController synchronously).
- **Lint** — `no-floating-promises: error` + `parserOptions.project` on agent-core / agent-framework /
  agent-transport (0 errors each). Monorepo-wide rollout deferred to **INFRA-040**.

**Testing lesson (recurred after ARCH-004):** a race/leak regression test asserting a LATE invariant is
accidental-green (passes on buggy code). Prove it FAILS pre-fix. The RUNTIME-12 test isolates the window by
MOCKING `checkAndRefreshContextIfStale` to block + firing two truly-concurrent submits.
