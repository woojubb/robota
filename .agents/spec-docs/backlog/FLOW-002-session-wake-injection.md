---
status: review-ready
type: FLOW
tags: [cli, async]
---

# FLOW-002: Session wake-injection — re-enter the agent loop on a wake event (Layer 2)

> Layer 2 of the agent-wakeup epic (see FLOW-001 "Epic & Layering"). Depends on **FLOW-001** (manager emits `background_task_waking { taskId, instruction }`).

## Problem

After FLOW-001, the background-task manager emits a manager-level `background_task_waking { taskId, instruction }`, but nothing consumes it to act. The agent still never wakes: a scheduled wake fires the event into the void. The execution controller already has the re-entry primitive (`pendingPrompt` + `drainPendingQueue()` in `interactive-session-execution-controller.ts`) and the background tracker (`interactive-session-background-tracker.ts`) already subscribes to manager events — but no code path turns a wake event into an injected agent turn.

Reproduction (post-FLOW-001): create a scheduled task with `agentInstruction`; on fire the manager emits `background_task_waking` with the instruction, but the interactive session runs no turn.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/interactive/interactive-session-background-tracker.ts` — already subscribes to manager events; consume `background_task_waking` and forward to an injection callback
- `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts` — new entry point that enqueues a **non-user turn** via the existing `submit`/`pendingPrompt` path
- `packages/agent-framework/src/interactive/interactive-session.ts` — wire the tracker's wake callback to the controller's injection entry point
- `packages/agent-framework/src/interactive/` — an agent-wakeup turn tag / hook input shape so the injected turn is distinguishable from a user prompt

### Alternatives Considered

**Alt A (chosen): inject via the existing `pendingPrompt` queue as a tagged non-user turn**

- The tracker forwards `background_task_waking` to `SessionExecutionController.requestWakeup(instruction, taskId)`, which calls the same `submit` path used for user prompts but tags the turn as `agent-wakeup` (distinct hook input). If a turn is executing, it queues and drains afterward (existing `drainPendingQueue`); two wakes for the same `taskId` while one is pending coalesce to one turn.
- Pro: reuses the proven re-entry queue; no new execution path; ordering/queueing already handled
- Con: coalescing policy must be explicit (same-task-id dedupe) to avoid wake storms

**Alt B: a separate wake execution path parallel to user prompts**

- Pro: full isolation of wake turns from user input
- Con: duplicates the execution lifecycle (streaming, drain, persistence) — two code paths to maintain; rejected (violates single-owner of execution state)

### Decision

Alt A. Inject the wake as a tagged non-user turn through the existing pending queue, coalescing by `taskId`. The wake turn carries the instruction as its input and an `agent-wakeup` tag so hooks/permissions can distinguish it from human input.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `SessionExecutionController` confirmed sole owner of `pendingPrompt`/`drainPendingQueue`; `interactive-session-background-tracker` confirmed the existing manager-event subscriber
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. Add `SessionExecutionController.requestWakeup(instruction, sourceTaskId)` that enqueues a non-user turn via the existing submit/pending path, tagged `agent-wakeup`, coalescing by `sourceTaskId` when a wake for the same task is already pending.
2. In `interactive-session-background-tracker`, on `background_task_waking`, call the wake callback wired by `interactive-session.ts` to `requestWakeup`.
3. Represent the wake turn with a distinct hook input (so `UserPromptSubmit`-style hooks can tell it is agent-initiated).

## Affected Files

- `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts`
- `packages/agent-framework/src/interactive/interactive-session-background-tracker.ts`
- `packages/agent-framework/src/interactive/interactive-session.ts`
- `packages/agent-framework/src/interactive/__tests__/`

## Completion Criteria

- [ ] TC-01: a `background_task_waking { instruction }` event delivered to the tracker causes exactly one agent turn to run with that instruction as input (assert via a spy on the execution path)
- [ ] TC-02: when a turn is executing, the wake queues and runs after the current turn drains (reuses `pendingPrompt`/`drainPendingQueue`); it does not interleave
- [ ] TC-03: two `background_task_waking` events for the same `taskId` while one wake is already pending coalesce to a single turn
- [ ] TC-04: the injected turn is tagged `agent-wakeup` (distinct from a user prompt) in its hook input
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-framework test` exits 0
- [ ] TC-06: `pnpm --filter @robota-sdk/agent-framework typecheck` exits 0

## Test Plan

Test strategy derived from type=FLOW, tags=[cli, async]: async state-assertion integration test on the interactive session with a fake manager emitting wake events; no live model (the turn execution is spied).

| TC-ID | Test Type | Tool / Approach                                       | Notes                                |
| ----- | --------- | ----------------------------------------------------- | ------------------------------------ |
| TC-01 | automated | vitest: deliver wake event → spy on submit/turn       | One turn with the instruction        |
| TC-02 | automated | vitest: wake during executing turn                    | Queues, drains after — no interleave |
| TC-03 | automated | vitest: two same-taskId wakes pending                 | Coalesce to one turn                 |
| TC-04 | automated | vitest: inspect hook input of the injected turn       | Tagged `agent-wakeup`                |
| TC-05 | automated | `pnpm --filter @robota-sdk/agent-framework test`      | No regressions                       |
| TC-06 | automated | `pnpm --filter @robota-sdk/agent-framework typecheck` | Must exit 0                          |

## Tasks

- [ ] `.agents/tasks/FLOW-002.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready
Frontmatter: `---` block present; `status: draft`; `type: FLOW` (valid 11-prefix value); `tags: [cli, async]` present.
Problem: concrete symptom (wake event fired "into the void", session runs no turn) + reproduction (post-FLOW-001, scheduled task with `agentInstruction` fires but no turn runs); no TBD/TODO/vague text.
Architecture Review: Affected Scope listed (4 files); 2 alternatives (Alt A chosen, Alt B rejected) each with Pro + Con; Decision references trade-off (single-owner of execution state, reuse proven queue); all 4 checklist items `[x]` incl. sibling scan with completion evidence.
Completion Criteria: TC-01 through TC-06 all TC-N prefixed, concrete (command/observable behavior form); no banned vague phrases.
Test Plan: section present; 6 rows (TC-01..TC-06) match 6 Completion Criteria; each row has non-empty Test Type + Tool/Approach, no "TBD"; no manual rows (all automated, Notes requirement N/A).
Structure: Tasks section with placeholder present; Evidence Log present and empty before this run; no `## Status` or `## Classification` in body.
TC-N count match confirmed: Completion Criteria (6) = Test Plan rows (6).
