# CORE-026 — floating-promise / race repair + no-floating-promises lint (agent-run)

**Spec:** CORE-026 (RUNTIME-12/26/36 + `no-floating-promises` enablement on the touched packages).
**Type:** agent-executable (the agent builds + tests + lints the touched packages; no owner action).

## Scenario

```bash
pnpm --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-core build

# RUNTIME-12 — a concurrent submit while a turn is in flight coalesces (no double-start).
npx vitest run packages/agent-framework/src/interactive/__tests__/runtime-12-turn-double-start.test.ts

# RUNTIME-36 — a headless slash-command that THROWS exits non-zero instead of hanging.
npx vitest run packages/agent-transport/src/headless/__tests__/headless-runner.test.ts

# no-floating-promises now ENABLED (type-aware) on the 3 touched packages — 0 errors.
(cd packages/agent-core && npx eslint 'src/**/*.ts')
(cd packages/agent-framework && npx eslint 'src/**/*.ts')
(cd packages/agent-transport && npx eslint 'src/**/*.ts')
```

**Expected:** builds green; the concurrent submit coalesces (pending == 1, still one turn); the throwing
slash-command resolves exit 1 (no hang); `no-floating-promises` reports 0 errors on all three packages.

## Observed (2026-07-21)

- **RUNTIME-12** — `✓ a second concurrent submit coalesces to pending instead of starting a second turn`. The
  first turn is held in flight (blocked on a model-issued AskUserQuestion with a manually-released answer); a
  concurrent `submit` lands in the pending queue (`getPendingCount() === 1`) and no second turn starts. The fix
  claims `executing` SYNCHRONOUSLY at `executePrompt` entry (was set only after the awaited
  `checkAndRefreshContextIfStale`, leaving a two-await double-start window; `checkAndRefreshContextIfStale` now
  runs inside the try so the `finally` still releases the flag on a refresh throw).
- **RUNTIME-26** — `interactive-session.requestWakeup` (`void this.submit(...)` wake) and `resumeGoalIfActive`
  (`void this.ensureInitialized().then(...)` init) now `.catch → reportBackgroundError('agent-wakeup' /
'goal-resume')` instead of dropping a detached rejection. The full interactive suite (248 tests) runs with
  ZERO unhandled rejections — previously the wake's floating submit surfaced `Unhandled Rejection: Interactive
session is shutting down`.
- **RUNTIME-36** — `✓ a slash-command that THROWS exits non-zero instead of hanging` (exit 1). All three
  headless format runners' `executeSlashCommandIfPresent(...).then(...)` chains gained a `.catch → onError`
  (fail-closed exit code), and `agent-cli print-mode` wraps `run`/`runGoal` + `process.exit(getExitCode())` in
  a `try/catch` so a throw can no longer bypass the exit-code contract.
- **RUNTIME-21 / RUNTIME-24** — DROPPED after code review (no real defect): `runStream` already finalizes on
  generator `return`; `Session.run` wires the AbortController synchronously with no lost-abort window.
- **Lint** — `@typescript-eslint/no-floating-promises: error` enabled (with `parserOptions.project`) on
  `agent-core`, `agent-framework`, `agent-transport`: **0 errors** on each. The monorepo-wide rollout is the
  deferred INFRA follow-up.

Full regression: agent-framework + agent-transport suites — **1868 tests pass**.
