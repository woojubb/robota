---
title: 'ARCH-025: agent-executor projections silently drop declared contract fields — SubagentManager.wait() strips usage (ANALYTICS-001), the task→runner bridge drops providerProfile, and IScheduleEditPatch is unexported and re-declared inline'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-executor, packages/agent-framework
depends_on: [ARCH-024, ARCH-027]
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

## Finding-depth verdict and containment (2026-08-16)

`finding-depth-triager`: **FOUNDATIONAL**. The three fields named below are instances; the cause is that
this seam has no owner — one field family is declared three times as independent shapes and carried by
hand-written literals that nothing checks for totality. Filed as the root item
**[ARCH-031](ARCH-031-subagent-background-task-seam-has-no-owner.md)** / issue
[#1747](https://github.com/woojubb/robota/issues/1747), per `finding-depth.md`'s requirement that a
foundational cause is never patched in place.

A recommendation that proposed solving the cause under this item returned `REVIEW VERDICT: REJECT`
(2026-08-16). Three reasons, each independently sufficient, and they are recorded because the next reader
should not have to rediscover them:

1. A FOUNDATIONAL verdict routes to re-plan or labelled containment — never a third option, and "solve it
   here with a widened package set" is that third option.
2. The plan would have added a public optional field to `IAgentBackgroundTaskRequest`, a published export of
   a package this item does not name — a public-contract change the Agent Authority rule reserves for the
   owner.
3. **Its worktree diagnosis was inverted.** It read `worktreePath`/`branchName` as caller fields dropped by
   `toBackgroundRequest`, and proposed deleting
   `agent-executor/src/subagents/worktree-subagent-runner.ts:117-122` as a "workaround". Those lines are the
   ONLY producer of those fields — the worktree does not exist at spawn time — and deleting them would have
   severed `subagentExecutionRoot`'s "the worktree wins when present" branch, which guards a measured
   containment breach. The invariant is **runner-produced, never caller-supplied**, and it is recorded in
   ARCH-031 so the mistake is not made twice.

**This item's remaining scope is therefore the two repairs that are LOCAL and inside its declared area** —
`usage` and `IScheduleEditPatch` below. `providerProfile` moves to ARCH-031: it is a dead contract field
whose disposition belongs with the seam, and it is what ARCH-021 actually needs, so ARCH-021 is unblocked by
ARCH-031 rather than by this item.

## Direction

Create one canonical total mapper for the public task/request/result projection seam. Every public key
must be mechanically classified as mapped, deliberately derived, or explicitly rejected; adding a key
must fail a fixture until classified. Preserve `usage`, `providerProfile`, permission policy, schedule
patch fields, and future public fields rather than relying on recurring hand-written partial objects.
Export one `IScheduleEditPatch` owner from agent-executor and consume it from agent-framework.

## Test Plan

- Red-first projection tests preserve usage, provider profile, permission policy, and schedule edits.
- A public-key exhaustiveness fixture fails whenever a new field is unclassified.
- Typecheck asserts `agent-framework` consumes the exported `IScheduleEditPatch` owner.
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
