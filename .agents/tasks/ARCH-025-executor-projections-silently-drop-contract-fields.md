---
title: 'ARCH-025: agent-executor projections silently drop declared contract fields — SubagentManager.wait() strips usage (ANALYTICS-001), the task→runner bridge drops providerProfile, and IScheduleEditPatch is unexported and re-declared inline'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-executor, packages/agent-framework
depends_on: []
---

# ARCH-025: executor facade projections lose contract fields

## Problem

Three declared fields on agent-executor's public contracts are silently dropped or unreachable by the
projections that should carry them, so a caller who sets them gets a no-op with no error.

## Evidence (adversarially verified 2026-08-13, PARTIAL — core confirmed, one consumer citation corrected)

- **usage stripped by wait():** `packages/agent-executor/src/subagents/subagent-manager.ts:38-41` —
  `wait()` returns `{ jobId, output, metadata }` with no `usage`, though `ISubagentJobResult.usage`
  is declared (`types.ts:56-57`, ANALYTICS-001), `toBackgroundResult` (`:233-241`) carries it, and
  usage is genuinely populated upstream (worker `sumHistoryUsage` → IPC →
  `child-process-subagent-runner-result.ts:161` → `BackgroundTaskManager` completion). `SubagentManager`
  is the only `ISubagentManager` production class, so the **single live reader**,
  `packages/agent-framework/src/orchestration/shared.ts:106`, sees `result.usage` structurally always
  `undefined`. (Correction to the original audit: `interactive-session-agent-jobs.ts:103-107` does NOT
  read `result.usage` — it only passes the result through; `shared.ts:106` is the sole live consumer.)
- **providerProfile dropped by the bridge:** `IAgentBackgroundTaskRequest.providerProfile`
  (`agent-interface-transport/src/background-task-contracts.ts:94`) is read nowhere:
  `toSubagentStartRequest` (`subagent-manager.ts:207-231`) omits it, `ISubagentSpawnRequest` has no
  such field, and the profile that actually reaches the worker is built independently from the
  runner's own `providerConfig` (`child-process-subagent-runner.ts:144`) — the request field is a
  silent no-op.
- **IScheduleEditPatch unexported + duplicated:** it is the parameter type of the public
  `IBackgroundTaskManager.editScheduledTask` / `IBackgroundTaskHandle.editSchedule`
  (`background-tasks/types.ts:103,107,130`) but is omitted from the package's public `index.ts:15-27`
  and documented nowhere; the consumer re-declares the shape inline
  (`agent-framework/src/interactive/interactive-session-base.ts:381`), which `code-quality.md:15`
  bans.

## Direction

1. Map `usage` in `SubagentManager.wait()` (`...(result.usage ? { usage: result.usage } : {})`),
   mirroring `toBackgroundResult`.
2. Either thread `providerProfile` through `ISubagentSpawnRequest`/`toSubagentStartRequest`, or
   retire/annotate the request field as unused (a forward-provisioned field must not be silently
   dropped by the one bridging projection — owner decision).
3. Export `IScheduleEditPatch` from agent-executor's public index, document it in the SPEC, and make
   agent-framework import it instead of re-declaring.

## Test Plan

- Red-first: an orchestration step whose subagent reports token usage asserts
  `IOrchestrationStepResult.usage` is populated (fails today).
- Red-first (if providerProfile is threaded): a background agent task with a `providerProfile` reaches
  the worker with that profile; (if retired) a scan asserting the field has no setter.
- Typecheck asserts `agent-framework` imports `IScheduleEditPatch` (no inline duplicate).
- `pnpm harness:verify -- --scope packages/agent-executor` green.

## User Execution Test Scenarios

**Applies** (subagent/orchestration usage is surfaced in `/cost` and analytics).

- Prerequisites: built CLI + provider key; a prompt that delegates to a subagent.
- Steps: run a session that spawns a subagent doing real token work; inspect the per-step/subagent
  usage in `/cost` (or the session analytics).
- Expected (after fix): the subagent's token usage is attributed (non-zero) to its orchestration
  step.
- Expected (before fix, contrast): the subagent step shows no usage.
- Cleanup: none.
- Evidence (fill in after implementation): the `/cost` or analytics readout showing subagent usage.
