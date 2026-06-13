---
status: review-ready
type: FLOW
tags: [cli, async]
---

# FLOW-003: Resume re-arm and missed-wake surfacing (Layer 3)

> Layer 3 of the agent-wakeup epic (see FLOW-001 "Epic & Layering"). Depends on **FLOW-002** (session wake-injection).

## Problem

In-process wakeups (FLOW-001/002) only fire while the CLI is running. Two gaps remain after a process restart:

1. **No re-arm:** a sleeping scheduled wake is persisted in the session record (`backgroundTasks` with `status: 'sleeping'` + `nextFireAt`), but on `restore()` the croner job is not restarted, so the wake never fires again after resume.
2. **Silent miss:** a wake whose `nextFireAt` elapsed while the CLI was closed is simply lost — the user is never told their scheduled instruction did not run.

Reproduction: create a scheduled wake, exit the CLI, resume the session later → the schedule does not resume (gap 1); if `nextFireAt` already passed, nothing indicates the missed run (gap 2).

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/interactive/session-persistence.ts` / `interactive-session-persistence.ts` — restore path for sleeping scheduled tasks
- `packages/agent-framework/src/interactive/interactive-session-background-tracker.ts` — re-arm restored sleeping schedules; compute and surface missed wakes
- `packages/agent-executor/src/background-tasks/background-task-manager.ts` — re-spawn a scheduled runner for a restored sleeping task

### Alternatives Considered

**Alt A (chosen): re-arm on restore + emit a `missed-wake` record for elapsed fires**

- On `restore()`, for each persisted `sleeping` scheduled task, re-spawn its scheduled runner (croner re-computes `nextFireAt`). If the persisted `nextFireAt` is in the past, emit a one-time `missed-wake` record (surfaced in the workspace / as a system note) before re-arming.
- Pro: schedules survive resume; missed runs are visible, not silently dropped — honest about the in-process limitation
- Con: requires reconstructing the runner request from persisted state

**Alt B: drop sleeping tasks on restore (require re-creation)**

- Pro: trivial
- Con: a scheduled wake silently disappears across restarts — violates user expectation and the persistence the record already carries; rejected

### Decision

Alt A. Re-arm persisted sleeping schedules on resume and surface a `missed-wake` record when `nextFireAt` already elapsed. This makes the documented in-process limitation explicit rather than silent.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — restore path and background tracker reviewed; persistence already serializes `backgroundTasks`/`nextFireAt`
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. On session restore, reconstruct the scheduled runner request for each persisted `sleeping` scheduled task and re-spawn it (re-arm the croner job).
2. Before re-arming, if persisted `nextFireAt < now`, emit a one-time `missed-wake` record (workspace entry / system note) naming the task and the missed time.
3. After re-arm, subsequent fires inject turns exactly as in FLOW-002.

## Affected Files

- `packages/agent-framework/src/interactive/session-persistence.ts`
- `packages/agent-framework/src/interactive/interactive-session-background-tracker.ts`
- `packages/agent-framework/src/interactive/__tests__/`

## Completion Criteria

- [ ] TC-01: after `restore()` of a session with a persisted sleeping scheduled wake, the croner job is re-armed and a subsequent fire injects a turn (assert via spy)
- [ ] TC-02: when the persisted `nextFireAt` is in the past at restore, exactly one `missed-wake` record is surfaced naming the task and missed time (no silent drop)
- [ ] TC-03: when `nextFireAt` is in the future at restore, no `missed-wake` record is emitted; the schedule simply re-arms
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-framework test` exits 0
- [ ] TC-05: `pnpm --filter @robota-sdk/agent-framework typecheck` exits 0

## Test Plan

Test strategy derived from type=FLOW, tags=[cli, async]: async state-assertion integration test on restore with a controlled clock.

| TC-ID | Test Type | Tool / Approach                                       | Notes                          |
| ----- | --------- | ----------------------------------------------------- | ------------------------------ |
| TC-01 | automated | vitest: persist sleeping → restore → fire → spy       | Re-arm + post-resume injection |
| TC-02 | automated | vitest: restore with past `nextFireAt` (fixed clock)  | Exactly one missed-wake record |
| TC-03 | automated | vitest: restore with future `nextFireAt`              | No missed-wake; re-arm only    |
| TC-04 | automated | `pnpm --filter @robota-sdk/agent-framework test`      | No regressions                 |
| TC-05 | automated | `pnpm --filter @robota-sdk/agent-framework typecheck` | Must exit 0                    |

## Tasks

- [ ] `.agents/tasks/FLOW-003.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft`; `type: FLOW` (valid 11-prefix); `tags: [cli, async]` present.
- Problem: concrete symptoms (re-arm gap + silent miss naming persisted `backgroundTasks`/`status:'sleeping'`/`nextFireAt`); reproduction condition present (create → exit → resume); no TBD/TODO/vague.
- Architecture Review: Affected Scope listed; all 4 checklist items `[x]`; sibling scan `[x]` with evidence; Alt A and Alt B each have Pro+Con; Decision references the silent-vs-explicit trade-off.
- Completion Criteria: all 5 items TC-N prefixed (TC-01..TC-05); each Command or Observable form; no banned phrases.
- Test Plan: section present; 5 TC rows (TC-01..TC-05) match 5 Completion Criteria (count matches); each row has non-empty Test Type + Tool/Approach, no "TBD"; no "manual" rows, so Notes-for-manual requirement is N/A.
- Structure: Tasks section present with placeholder; Evidence Log present (empty at first run); no `## Status` or `## Classification` body sections.
