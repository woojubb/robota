---
status: review-ready
type: FLOW
tags: [cli, async, streaming]
---

# FLOW-004: Monitor capability — process output match wakes the agent (Layer 4)

> Layer 4 of the agent-wakeup epic (see FLOW-001 "Epic & Layering"). Depends on **FLOW-001** (wake-event model) and **FLOW-002** (session wake-injection).

## Problem

Timer wakeups (FLOW-001/002) cover "wake on a schedule," but not "wake when something happens." Claude Code's Monitor watches a background process's output and re-invokes the agent on each matching line. The Robota CLI has `managed-shell-process-runner` (streams `background_task_text_delta`) but no way to turn a matched output line into an agent wake carrying that line as context.

Reproduction: a long-running `process` background task streams output; no pattern-match → wake mechanism exists, so the agent cannot react to "ERROR appeared in the log."

## Architecture Review

### Affected Scope

- `packages/agent-executor/src/background-tasks/types.ts` — a monitor request (or a `matchPattern` + `agentInstruction` on the process request)
- `packages/agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts` — match output lines against the pattern; emit a wake event carrying the matched line
- `packages/agent-framework/src/interactive/interactive-session-background-tracker.ts` — already injects on wake (FLOW-002); ensure the matched-line context reaches the turn input

### Alternatives Considered

**Alt A (chosen): extend the process runner with an optional line-match → wake, reusing the FLOW-001 wake event**

- The process runner accepts a `matchPattern` (regex/substring) + `agentInstruction`. On a matching output line it emits `background_task_waking { taskId, instruction }` where the instruction includes the matched line as context. FLOW-002 injection then runs a turn.
- Pro: reuses the existing process runner + the wake event/injection from L1/L2; one matched line = one wake (line-buffered), mirroring Claude Code Monitor
- Con: needs line buffering + match throttling/coalescing to avoid wake storms on chatty output

**Alt B: a brand-new monitor runner kind separate from `process`**

- Pro: clean separation
- Con: duplicates process-spawn/stream/log logic already in `managed-shell-process-runner`; rejected (reuse over duplication)

### Decision

Alt A. Add an optional line-match → wake to the existing process runner, emitting the FLOW-001 wake event with the matched line folded into the instruction. Apply per-line buffering and same-pattern coalescing/throttle to prevent storms.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `managed-shell-process-runner` is the only process-streaming runner; the wake event/injection from FLOW-001/002 is reused, not duplicated
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. Add optional `matchPattern` + `agentInstruction` to the process request (or a thin monitor variant).
2. In `managed-shell-process-runner`, buffer stdout/stderr by line; on a line matching `matchPattern`, emit `background_task_waking { taskId, instruction }` with the matched line appended to the instruction. Throttle/coalesce repeated matches within a short window.
3. FLOW-002 injection runs the agent turn with the matched-line context.

## Affected Files

- `packages/agent-executor/src/background-tasks/types.ts`
- `packages/agent-executor/src/background-tasks/runners/managed-shell-process-runner.ts`
- `packages/agent-executor/src/background-tasks/__tests__/`

## Completion Criteria

- [ ] TC-01: a process task with `matchPattern` whose output emits a matching line produces a `background_task_waking` whose instruction includes the matched line
- [ ] TC-02: non-matching output lines produce no wake
- [ ] TC-03: repeated matches within the throttle window coalesce (assert wake count is bounded, not one-per-line for a burst)
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-executor test` exits 0
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-executor typecheck` exits 0

## Test Plan

Test strategy derived from type=FLOW, tags=[cli, async, streaming]: stream-output integration test driving a fake/echo process and asserting wake emissions.

| TC-ID | Test Type | Tool / Approach                                      | Notes                                      |
| ----- | --------- | ---------------------------------------------------- | ------------------------------------------ |
| TC-01 | automated | vitest: echo process emits matching line → event spy | Wake instruction includes the matched line |
| TC-02 | automated | vitest: non-matching output                          | No wake                                    |
| TC-03 | automated | vitest: burst of matching lines                      | Coalesced/throttled — bounded wake count   |
| TC-04 | automated | `pnpm --filter @robota-sdk/agent-executor test`      | No regressions                             |
| TC-05 | automated | `pnpm --filter @robota-sdk/agent-executor typecheck` | Must exit 0                                |

## Tasks

- [ ] `.agents/tasks/FLOW-004.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: FLOW` (valid 11-prefix); `tags: [cli, async, streaming]` present
- Problem: concrete symptom (no pattern-match→wake mechanism; agent cannot react to "ERROR appeared in the log") + reproduction (long-running process streams output); no TBD/TODO/vague
- Architecture Review: Affected Scope listed; Alt A and Alt B each have Pro+Con (≥2 alternatives); Decision references reuse-over-duplication trade-off; all 4 checklist items `[x]`; Sibling scan `[x]` with evidence
- Completion Criteria: TC-01..TC-05 all TC-N prefixed; concrete command/observable forms; no banned vague language
- Test Plan: present; 5 rows match 5 TC-N (count matches); each row has non-empty Test Type + Tool/Approach, no "TBD"; no "manual" rows so manual-Notes rule N/A
- Structure: Tasks section with placeholder present; Evidence Log empty before this entry; no `## Status`/`## Classification` in body
