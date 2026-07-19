# SELFHOST-012 P1 — non-destructive schedule lifecycle extension (task breakdown)

Spec: [`.agents/spec-docs/active/SELFHOST-012-scheduled-tasks.md`](../spec-docs/active/SELFHOST-012-scheduled-tasks.md)
(FLOW; P1 = this slice; design-gated GATE-APPROVAL ENDORSE). **Reuse the existing croner scheduler — NO new
scheduler.** P1 adds the thin, non-destructive `pause`/`resume` (+ `edit`) lifecycle the surface (P2) will drive.
Commit per logical slice (commit-cadence).

## Design (approved, P1)

Turn croner's already-present `.pause()`/`.resume()` (non-destructive, distinct from the irreversible `.stop()`
that `cancel` uses) into a first-class, addressable status + manager/host verbs:

- **Status SSOT** — add `'paused'` to `TBackgroundTaskStatus`
  (`agent-interface-transport/src/background-task-contracts.ts`; re-exported via `agent-executor` `types.ts`).
- **State machine** (`agent-executor/src/background-tasks/state-machine.ts`) — new events `PAUSE`/`RESUME` +
  transitions `running → paused`, `sleeping → paused` (PAUSE), `paused → sleeping` (RESUME);
  `paused` is **non-terminal** (NOT added to `TERMINAL_STATUSES`); illegal edges still throw. (TC-01)
- **Runner** (`scheduled-task-runner.ts`) — expose `pause()`/`resume()` on `IBackgroundTaskHandle`, wiring
  croner `state.job.pause()` / `state.job.resume()` (NEVER `.stop()`), plus a `state.paused` guard so a fire
  that slips through re-sleeps without running; `resume()` re-emits `sleeping` with the refreshed `nextFireAt`.
  A paused job does **not** fire. (TC-02)
- **Manager** (`background-tasks/types.ts` port + `background-task-manager.ts` impl + a
  `markBackgroundTaskPaused`/`markBackgroundTaskResumed` helper in `background-task-manager-state.ts`) —
  `pauseScheduledTask/resumeScheduledTask/editScheduledTask(taskId, patch)`: `requireTask`, guard it is a
  `scheduled` task in a legal state, apply the state-machine transition, call the handle, emit
  `background_task_updated`. Slot accounting: a `paused` schedule holds **no** concurrency slot (like
  `sleeping` — `releaseSlot` on pause; re-acquire only on the next real fire). (TC-02/TC-03)
- **`edit`** — re-arm the croner job **in place** (same `taskId` + schedule identity): the handle rebuilds its
  `Cron` from the patched cron expression / instruction, keeping the same task. (TC-03)
- **Host context** (`agent-framework/src/command-api/host-context.ts` `IAgentJobHostContext` +
  `interactive/interactive-session-agent-jobs.ts`) — expose `pauseSchedule/resumeSchedule/editSchedule` +
  a `listSchedules` view (cadence + `nextFireAt` + status), wired to the manager. (TC-04)

Persistence of `paused` + the edited `schedule` across restart (the FLOW-003 re-arm predicates —
`reArmRestoredSchedules` + `isReArmableSchedule`, which today key on `status==='sleeping'` and would mark a
paused task `failed`) is **P3**, not P1 (named in the spec's GATE-APPROVAL note).

## Status

**IN PROGRESS.** GATE-IMPLEMENT PASSED (backlog-gate-guard, 2026-07-19); implementing S1–S6.

## Slices (each green + committed)

1. **S1 — status SSOT** `'paused'` on `TBackgroundTaskStatus`.
2. **S2 — state machine** PAUSE/RESUME events + transitions + non-terminal `paused` (TC-01 unit).
3. **S3 — runner** handle `pause()`/`resume()` via croner `.pause()`/`.resume()` + `paused` guard (TC-02 functional, fake timers).
4. **S4 — manager** `pauseScheduledTask`/`resumeScheduledTask` + state helper + slot accounting + host wiring (TC-02/TC-04).
5. **S5 — edit** `editScheduledTask` (manager + runner in-place re-arm + host) (TC-03).
6. **S6 — docs** (agent-executor + agent-command/agent-framework SPEC as touched) + no-new-scheduler grep note (TC-06 partial; persistence TC-06 is P3).

## Test Plan

- **TC-01** state machine: `running/sleeping → paused`, `paused → sleeping` valid; illegal edges throw; `paused` non-terminal (vitest unit).
- **TC-02** paused → **zero fires** across a scheduled tick (fake timers / croner), resume → next tick fires, **same task id** (functional, scheduled runner + manager).
- **TC-03** `edit` re-arms in place (same id), new cadence applies on next fire (functional).
- **TC-04** `listSchedules` returns cadence + `nextFireAt` + status incl. a `paused` entry (unit/integration on the host list path).
  Regression: `pnpm --filter @robota-sdk/agent-executor --filter @robota-sdk/agent-interface-transport --filter @robota-sdk/agent-framework test`, typecheck, lint, `pnpm harness:scan`.

## Capability-reachability (per `.agents/rules/backlog-execution.md`)

P1 ships the **lifecycle engine + manager/host verbs** (a library seam). The capability becomes **surface-reachable**
at **P2** (`/schedule pause|resume|edit|list`). Per the capability-reachability rule, the **AGENT-RUN verification**
— drive a real agent to create → pause (observe it does NOT fire across a tick) → resume (observe it fires) → edit,
saved as scenario evidence — is a required **P2** deliverable (P1 is unit/functional-verified only; a scheduling
lifecycle isn't done until an agent can drive it and observe the not-firing empirically).
