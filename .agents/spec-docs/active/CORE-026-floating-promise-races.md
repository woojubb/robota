---
status: in-progress
type: BEHAVIOR
tags: [concurrency, floating-promises, races, lint, runtime, background-tasks, capability]
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/core-026-floating-promise-races-agent-run.md
---

# CORE-026: residual floating-promise / race repair + no-floating-promises lint enablement

## Problem

Re-audit P2-17 (RUNTIME-12/21/24/26/36; the "T4" concurrency class). Several runtime paths start async work
without awaiting or routing its rejection, and a few turn/stream transitions have check-then-act races. The
`@typescript-eslint/no-floating-promises` rule — the industry-standard guard for exactly this hazard — is NOT
enabled (the root `.eslintrc.json` has no `parserOptions.project`, so type-aware rules cannot run today).

Confirmed sites (locations CORRECTED at GATE-APPROVAL — proposal-reviewer traced each against the code):

- **RUNTIME-12 (REAL)** — turn double-start race. The busy flag is `executing` in `agent-framework`
  `SessionExecutionController` (`interactive-session-execution-controller.ts:102`), gated at the `submit`
  entry (`interactive-session.ts:489`). The race: `submit()` awaits `ensureInitialized()` (`:480`) BEFORE the
  `if (execCtrl.executing)` check, and `executePrompt` awaits `checkAndRefreshContextIfStale`
  (`...execution-controller.ts:268`) BEFORE setting `executing = true` (`:276`). Two concurrent entries
  (realistic: REMOTE-014 co-drive, FLOW-002 `requestWakeup` `:542`, GOAL-001 `scheduleGoalTurn` `:913`) can
  both observe idle and both start a turn. (NOT in `agent-session`; `session-contracts.ts:370` is the
  interface declaration, not the flag.)
- **RUNTIME-26 (REAL, RELOCATED)** — lost-rejection floating promises in the FRAMEWORK layer that CAN reach
  `reportBackgroundError` (`interactive-session.ts:780`): `interactive-session.ts:542` `void this.submit(...)`
  (wake, no catch) and `:933` `void this.ensureInitialized().then(...)` (init, no rejection handler). NOT the
  executor manager — `background-task-manager.ts:94` `void deferred.promise.catch(()=>undefined)` is a correct
  intentional guard, and `agent-executor` cannot call `reportBackgroundError` (one-way dep `agent-framework →
agent-executor`; the reverse would be a cycle). The runner-result promise already routes to `onFailed`.
- **RUNTIME-36 (REAL)** — headless slash-command paths in `agent-transport/src/headless/` (NOT
  `agent-cli/print-mode`): `executeSlashCommandIfPresent` (`headless-stream-json.ts:32`) awaits
  `session.executeCommand` with no catch and a failing command returns `{ success: false }` (`:41`) without a
  non-zero exit; and `print-mode.ts:117` does `process.exit(channel.getExitCode())` AFTER `await channel.run`
  — a throw in `run` bypasses the exit-code line.

**Dropped after code review** (premises not substantiated):

- **RUNTIME-21** — DROPPED: `runStream` (`robota-execution.ts`) already has `try/catch/finally` (`:161`); a
  `for await` consumer that `break`s triggers the generator `.return()` → the `finally` runs, so a dropped
  consumer IS finalized. No concrete parked-producer/queue-wedge site exists.
- **RUNTIME-24 — DROPPED**: `session.ts` `run()` (185-193) creates the `AbortController`, destructures
  `signal`, and hands off to `executeRun` all SYNCHRONOUSLY (no `await` between) — no lost-abort window.
  `AbortSignal` is level-triggered and `session-run.ts` re-checks `abortSignal.aborted` (`:230`), so an early
  abort is still observed. Fixing it would be churn with no design improvement.

## Prior Art Research

Waived: this is INTERNAL concurrency-correctness repair against the repo's OWN CORE-018 cancellation contract
plus enabling a STANDARD lint rule. The authoritative external reference IS the rule itself —
[`@typescript-eslint/no-floating-promises`](https://typescript-eslint.io/rules/no-floating-promises/) (and its
companion `no-misused-promises`) — whose documentation states the rationale (unhandled rejections, out-of-order
execution, and lost errors) this spec applies. No comparable-product survey adds signal to "await or route
every promise; set the busy flag synchronously." Enforced-waiver recorded per research.md.

## Decision

Scope corrected at GATE-APPROVAL to the THREE substantiated fixes (RUNTIME-12/26/36); RUNTIME-21/24 dropped
(no real defect). Do NOT touch the already-blessed `allow-fallback` best-effort blocks (`session.ts:234`,
`execution-controller.ts:297/359`, `background-task-manager.ts:94`).

1. **RUNTIME-12** — set `SessionExecutionController.executing` SYNCHRONOUSLY at the `submit` entry
   (`agent-framework`), before `ensureInitialized()` / `checkAndRefreshContextIfStale`, and reject/coalesce a
   re-entry deterministically per the session contract. Closes the two-concurrent-entries window. Anchors on
   the same single-threaded invariant CORE-025/ARCH-004 rely on.
2. **RUNTIME-26** — route the FRAMEWORK lost-rejection floating promises to `reportBackgroundError`:
   `interactive-session.ts:542` (`void this.submit(...)` wake) and `:933` (`void this.ensureInitialized().then`
   init). Leave the executor manager's deferred guard + runner-result routing untouched (dependency-direction:
   the executor cannot reach `reportBackgroundError`).
3. **RUNTIME-36** — add `.catch` to the `agent-transport/src/headless/` slash-command site(s)
   (`headless-stream-json.ts:32` + siblings) and close the `print-mode.ts:117` exit-on-throw bypass, so a
   failing command surfaces the documented non-zero exit code.
4. **Lint enablement (split, with a required floor).** `no-floating-promises` is type-aware and needs
   `parserOptions.project`, absent from the monorepo config today — monorepo-wide rollout is a genuine INFRA
   change (per-package `project` wiring + the resulting finding-flood + lint-perf cost) and is SPLIT into a
   dedicated INFRA item. **Required floor (not optional):** enable `no-floating-promises` on the packages this
   change touches — `agent-framework`, `agent-transport`, `agent-core` — by adding `project` for those and
   clearing their findings, so the fixed surfaces are actually guarded against recurrence. Only the long-tail
   monorepo rollout is deferred. State honestly which packages got the rule.

## Test Plan

- RUNTIME-12: two truly-concurrent `submit`s → exactly one turn starts (the other rejects/coalesces).
- RUNTIME-26: an init/wake rejection reaches `reportBackgroundError` (spy).
- RUNTIME-36: a failing headless slash-command exits non-zero (documented code); a throw in `channel.run` still
  sets the exit code.
- Lint: `no-floating-promises` reports 0 in `agent-framework`, `agent-transport`, `agent-core` (rule enabled).

## User Execution Test Scenarios

- **agent-executable.** Live headless run of a failing command → the documented non-zero exit code (measured);
  two back-to-back `submit`s → no double turn (measured).
- Evidence: `.agents/evals/scenarios/core-026-floating-promise-races-agent-run.md` (record after execution).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-21

- Prior Art Research: WAIVED (internal concurrency-correctness + standard lint; rule docs are the reference);
  scan-spec-research green.
- Frontmatter (status/type BEHAVIOR/tags + capability keys): present.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-21

Independent `proposal-reviewer`: **REVISE → resolved**. Reviewer traced every premise against the code:
RUNTIME-12 REAL (mislocated → corrected to `agent-framework` SessionExecutionController), RUNTIME-36 REAL
(re-pointed to `agent-transport/src/headless/`), RUNTIME-26 REAL but MISLOCATED + a dependency-direction
violation as written (→ relocated to the framework sites that own `reportBackgroundError`; executor guard left
alone), RUNTIME-21 UNPROVEN (runStream already finalizes on generator return) and RUNTIME-24 FALSE (no
lost-abort window) → both DROPPED. Lint split ENDORSED with a tightened floor: enable the rule on the 3 touched
packages (not zero). Research waiver VALID. All applied. Owner directive ("arch-004 core-026 진행") =
GATE-APPROVAL sign-off; REVISE resolved.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-21

- **RUNTIME-12** (`interactive-session-execution-controller.ts`): `executing` claimed synchronously at
  `executePrompt` entry (was set after the awaited `checkAndRefreshContextIfStale`); the refresh moved inside
  the try so the `finally` still releases the flag on a refresh throw.
- **RUNTIME-26** (`interactive-session.ts`): `requestWakeup` wake submit + `resumeGoalIfActive` init `.then`
  now `.catch → reportBackgroundError` (framework layer; executor guard untouched — dependency direction).
- **RUNTIME-36** (`agent-transport/src/headless/headless-runner.ts` ×3 + `agent-cli/print-mode.ts`): each
  `executeSlashCommandIfPresent(...).then` gained a `.catch → onError` fail-closed exit; print-mode wraps
  run/exit in try/catch so a throw surfaces exit 1.
- **Lint**: `@typescript-eslint/no-floating-promises: error` + `parserOptions.project` enabled on `agent-core`,
  `agent-framework`, `agent-transport`. RUNTIME-21/24 dropped (no defect).

### [GATE-VERIFY] — ✅ PASS | 2026-07-21

- RUNTIME-12 deterministic coalesce test + RUNTIME-36 throw→exit-1 test green; agent-framework + agent-transport
  full suites **1868 tests pass**, no unhandled rejections (previously the wake floating submit surfaced one).
- `no-floating-promises` reports **0 errors** on all three packages (type-aware).
- Agent-run scenario executed — `.agents/evals/scenarios/core-026-floating-promise-races-agent-run.md`.
