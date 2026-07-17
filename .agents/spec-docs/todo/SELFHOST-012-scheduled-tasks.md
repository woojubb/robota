---
status: approved
type: FLOW
tags: [scheduler, cron, tasks, dag-scheduler, agent-command, selfhost]
---

# SELFHOST-012: user-facing scheduled / cron tasks — list / pause / resume / edit over the existing scheduler

## Problem

Promotes backlog [SELFHOST-012](../../backlog/SELFHOST-012-scheduled-tasks.md) toward
[VISION.md](../../../VISION.md). Concrete symptom: Robota already **runs** recurring agent-wake tasks — FLOW-005's
`/schedule` command creates one-shot and cron wakes via
`IAgentJobHostContext.spawnScheduledWake` (`packages/agent-command/src/schedule/schedule-command.ts`), backed by a
real `croner`-driven runner (`packages/agent-executor/src/background-tasks/runners/scheduled-task-runner.ts`) and
persisted/re-armed across restart by FLOW-003 (`IBackgroundTaskState.schedule` in
`packages/agent-interface-transport/src/background-task-contracts.ts`). But there is **no user-facing surface to
manage the lifecycle of those schedules**: you can create a cron task, yet you cannot _list_ your schedules, _pause_
one without destroying it, _resume_ it, or _edit_ its cron/instruction. The only lifecycle verbs today are
destructive: `/background cancel|close` (`packages/agent-command/src/background/background-command.ts`) map to the
runner's `cancel()`, which calls croner `.stop()` — permanent, and `.resume()` will not work after it
(`node_modules/.pnpm/croner@10.0.1/.../croner.d.ts:634` "`.resume()` will not work after stopping"). The background
state machine (`packages/agent-executor/src/background-tasks/state-machine.ts`) has **no `paused` status** and no
PAUSE/RESUME transition — `cancelled` is terminal. So "pause a task, it does not fire, then resume it correctly" is
**not expressible** with what ships. Every scheduling-capable agent (see Prior Art) exposes pause/resume/edit; Robota
has the engine but not the controls.

## Prior Art Research

From product documentation: **Hermes** (Nous Research) scheduled cron tasks expose the full management lifecycle —
create a recurring task, list the user's schedules, pause and later resume a schedule, and edit its cadence /
instruction (https://hermes-agent.nousresearch.com/docs/). Comparable managed-scheduler surfaces show the same
shape: **GitHub Actions** scheduled workflows can be disabled and re-enabled without deletion
(https://docs.github.com/en/actions/managing-workflow-runs-and-deployments) and **Temporal** schedules expose
explicit `pause` / `unpause` / `update` (edit) operations distinct from delete
(https://docs.temporal.io/develop/typescript/schedules). **Common observed behavior:** a scheduled task is a durable,
addressable object with a non-destructive **pause/resume** distinct from delete, an **edit** that re-arms the cadence
in place (same identity), and a **list** view showing each schedule's cadence + next fire time + status.

**Robota constraint / delta.** Robota must NOT introduce a second scheduler. The recurrence engine already exists
(the `croner`-backed scheduled-task runner reused by FLOW-005), and where a scheduled task drives a DAG run the
`dag-scheduler` `SchedulerTriggerService`
(`packages/dag-scheduler/src/services/scheduler-trigger-service.ts`) is the existing DAG-run trigger primitive. So the
Robota shape is: **reuse the existing scheduler; add ONLY the user-facing surface + the non-destructive lifecycle
controls it needs.** The delta versus the common shape is one Robota-specific fact established below — the existing
schedulers do **not** yet expose non-destructive pause/resume, so a thin lifecycle extension (not a new scheduler) is
required.

## Architecture Review

### Affected Scope

- **Which existing scheduler is reused (grounded).** There are two existing scheduling primitives and neither is
  replaced:
  - `dag-scheduler` `SchedulerTriggerService` — a **stateless DAG-run trigger delegator**: `triggerScheduledRun` /
    `triggerScheduledBatch` / `triggerCatchup` forward to `RunOrchestratorService.startRun`
    (`scheduler-trigger-service.ts:69-221`). It has **no recurrence engine, no schedule registry, no persistence, and
    no pause/resume** — it fires a DAG run for a given logical date. It is the trigger a scheduled task uses _when the
    task drives a DAG_, not the agent-wake cron.
  - The **agent-wake recurrence engine** is `createScheduledTaskRunner` (`scheduled-task-runner.ts`), which
    constructs a `croner` `Cron(cronExpression, …)` and is the runner FLOW-005 `/schedule` already spawns through
    `spawnScheduledWake`. Persistence/re-arm on restart is FLOW-003 (`IBackgroundTaskState.schedule`).
- **Verification — does the existing scheduler already expose the lifecycle primitives the surface needs? NO → a thin
  lifecycle extension is required (grounded in the actual code):**
  - `dag-scheduler` exposes none (stateless trigger delegator; no registry/pause/resume — see above).
  - The croner runner **cancels** (`scheduled-task-runner.ts:98-111` sets `cancelled = true` + `job.stop()`), which is
    permanent. It never calls croner's own `.pause()` / `.resume()` — which DO exist and are non-destructive
    (`croner.d.ts:643 pause(): boolean`, `:647 resume()`), distinct from the irreversible `.stop()` (`:637`).
  - `IBackgroundTaskManager` (`background-tasks/types.ts:106-117`) has `spawn/wait/list/get/cancel/close/…` but **no
    `pause`/`resume`/`editSchedule`**. `IAgentJobHostContext`
    (`agent-framework/src/command-api/host-context.ts:204-246`) has `spawnScheduledWake` but **no schedule-lifecycle
    method**. `TBackgroundTaskStatus` (`background-task-contracts.ts:17-24`) has **no `paused`**; the state machine has
    no PAUSE/RESUME edge and `cancelled` is terminal.
  - **Conclusion:** the recurrence engine is reused unchanged in spirit (still croner, still the FLOW-005 runner), but
    a **thin lifecycle extension** is required to turn the engine's _already-present_ `.pause()`/`.resume()` into a
    first-class, persisted, addressable status — plus the user-facing subcommands. **No new scheduler / cron engine is
    introduced.**
- **Surface placement (mirror-an-analog).** The user-facing controls live in the **existing** `/schedule` command
  module (`packages/agent-command/src/schedule/`, already registered in
  `default-command-modules.ts:107`), extended with `list|pause|resume|edit` subcommands **mirroring the `/background`
  multi-subcommand command** (`background/background-command.ts` dispatches `list|read|cancel|close`;
  `buildBackgroundCommandSubcommands()` builds its subcommand entries). `agent-cli` needs no bespoke wiring — the
  module is already in the default set; the new subcommands ride the same registration.
- **Lifecycle plumbing (thin extension, SSOT-respecting).** `paused` added to `TBackgroundTaskStatus` (the SSOT in
  `agent-interface-transport`); PAUSE/RESUME transitions added to the state machine (non-terminal); the runner wires
  croner `.pause()`/`.resume()`; the manager gains `pauseScheduledTask/resumeScheduledTask/editScheduledTask`; the
  host context (`IAgentJobHostContext`) exposes them to commands, wired in `interactive-session-agent-jobs.ts`.
  `paused` **must persist** so a restart re-arms a paused schedule as paused, not silently running (extends the
  FLOW-003 `schedule` persistence).

### Alternatives Considered

1. **Thin non-destructive lifecycle extension over the EXISTING croner runner + `list|pause|resume|edit` subcommands
   on the existing `/schedule` module (mirror `/background`) (CHOSEN).**
   - ✅ Reuses the shipped recurrence engine (croner runner + FLOW-005 create + FLOW-003 persistence) and croner's
     _own_ `.pause()`/`.resume()` — no second scheduler, no second cron parser. The surface mirrors a proven analog
     (`/background`) so registration/subcommand plumbing is already established. `paused` becomes a real, persisted,
     addressable status, so "does not fire while paused, resumes correctly with the same identity" is directly
     expressible and testable.
   - ❌ Touches the SSOT status enum + state machine + manager + host context (a real, if small, cross-layer diff);
     `paused` must be threaded through persistence or a restart resumes a paused task (called out as TC-06, not
     hidden).
2. **Map pause→`cancel`, resume→re-create the schedule (no new status).**
   - ✅ Zero state-machine / enum change; only a surface script over existing verbs.
   - ❌ Correctness failure. `cancel` calls croner `.stop()`, which is **irreversible** (`croner.d.ts:634`: "`.resume()`
     will not work after stopping"), and `cancelled` is a **terminal** status. "Resume" would mint a **new** task id,
     breaking every reference the user's `list`/`edit` holds, losing missed-wake/next-fire continuity (FLOW-003
     semantics), and losing schedule identity. It does not satisfy "a paused task … resumes correctly." REJECTED on
     correctness.
3. \*\*Build a new schedule-registry / scheduler service (in `dag-scheduler` or a new package) owning cron + pause/resume
   - persistence for user schedules.\*\*
   * ✅ One clean owner for the user-facing schedule object.
   * ❌ Duplicates machinery that already ships in production — the croner runner, FLOW-005 create, and FLOW-003
     persistence — producing **two cron engines that will diverge**, and directly violates the "reuse the existing
     scheduler, NO new scheduler" constraint. Putting it on `dag-scheduler` is also the wrong layer: that service has
     no recurrence engine or registry and triggers DAG runs, not agent-wake cron. REJECTED on reuse + layering.

### Decision

Adopt (1): **reuse the existing scheduler** (the croner-backed background-tasks runner FLOW-005 already drives, and the
`dag-scheduler` trigger primitive where a schedule fires a DAG run) and add **only** (a) the user-facing
`list|pause|resume|edit` subcommands on the already-registered `/schedule` module, mirroring `/background`, and (b) a
**thin non-destructive lifecycle extension** — a persisted `paused` status + PAUSE/RESUME transitions wiring croner's
existing `.pause()`/`.resume()`, exposed through the manager and `IAgentJobHostContext`. No new scheduler or cron engine
is introduced.

### Validated Recommendation

- **Reachability:** the surface reuses the `/schedule` module already in `createDefaultCommandModules`
  (`default-command-modules.ts:107`) and the `IAgentJobHostContext` capability already resolved by
  `getAgentHostContext` in `schedule-command-module.ts:20-24`; the new subcommands ride the established
  registration exactly as `/background`'s do. Reachable with no bespoke `agent-cli` wiring.
- **Capability preservation:** create (FLOW-005), persist/re-arm and missed-wake (FLOW-003) are preserved unchanged;
  the extension _adds_ list/pause/resume/edit and preserves task identity across pause→resume (same id, same
  `schedule`). The croner engine and dag-scheduler trigger primitive are untouched in responsibility.
- **Adversarial:** (i) the destructive-cancel trap — an implementer might reflexively reuse `cancel`/`.stop()`;
  pinned out by requiring croner `.pause()`/`.resume()` and a non-terminal `paused` status (TC-02). (ii) the silent-resume
  trap — if `paused` is not persisted, a restart re-arms the schedule as running; pinned by TC-06 (paused survives
  restart). (iii) the "did it actually not fire" trap — asserted by advancing time across a scheduled tick while paused
  and observing **zero** fires, then a fire after resume (TC-02), not merely by reading a status flag.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-command/src/schedule` (surface subcommands, mirror `/background`);
      `agent-executor/src/background-tasks` (state-machine PAUSE/RESUME, runner croner `.pause()`/`.resume()`, manager
      lifecycle methods); `agent-framework` host-context + `interactive-session-agent-jobs` (expose lifecycle);
      `agent-interface-transport` (add `paused` to the status SSOT). `dag-scheduler` is **reused, not modified**. No new
      package, no new scheduler.
- [x] Sibling scan 완료 — mirrors the **`/background` multi-subcommand analog** (`list|read|cancel|close` →
      `list|pause|resume|edit`) and reuses the **existing croner runner** FLOW-005/003 already established, rather than a
      new registry. Independent architecture-placement validation to be recorded in the Evidence Log at GATE-APPROVAL.
- [x] 대안 최소 2개 — 3 considered (thin lifecycle extension + surface CHOSEN; pause=cancel/recreate REJECTED on
      correctness; new scheduler registry REJECTED on reuse+layering), each Pro+Con grounded in the actual runner /
      state-machine / croner behavior.
- [x] 결정 근거 — the seed's "over dag-scheduler" framing is corrected against the code (dag-scheduler is a stateless
      DAG-run trigger; the agent-wake recurrence engine is the croner runner); reuse + non-destructive lifecycle satisfy
      the design constraints; GATE-APPROVAL pending.

## Solution

Reuse the existing scheduler; add the user-facing management surface + a thin lifecycle extension:

- **Status SSOT:** add `'paused'` to `TBackgroundTaskStatus` (`agent-interface-transport/src/background-task-contracts.ts`).
- **State machine:** add non-terminal transitions `sleeping|running → paused` (PAUSE) and `paused → sleeping`
  (RESUME) in `agent-executor/src/background-tasks/state-machine.ts`; keep `cancelled` terminal (unchanged).
- **Runner:** in `scheduled-task-runner.ts`, wire croner's own `job.pause()` / `job.resume()` (NOT `job.stop()`),
  exposing `pause()`/`resume()` on `IBackgroundTaskHandle`; a paused job does not fire, and `nextFireAt` reflects the
  resumed cadence.
- **Manager + host:** add `pauseScheduledTask/resumeScheduledTask/editScheduledTask(taskId, patch)` to
  `IBackgroundTaskManager` and to `IAgentJobHostContext`, wired in `interactive-session-agent-jobs.ts`; `edit`
  re-arms the croner job in place (same task id + `schedule`).
- **Persistence:** thread `paused` + the edited `schedule` through the FLOW-003 persistence path so a restart
  re-arms a paused schedule as **paused**.
- **Surface:** extend the existing `/schedule` module with `list|pause|resume|edit` subcommands, mirroring
  `/background` (`background-command.ts` dispatch + `buildBackgroundCommandSubcommands()`); `create` stays the current
  FLOW-005 form. `list` shows each schedule's cadence + `nextFireAt` + status.

## Affected Files

| File                                                                                                         | Change                                                                                        |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `packages/agent-interface-transport/src/background-task-contracts.ts`                                        | add `'paused'` to `TBackgroundTaskStatus` (SSOT)                                              |
| `packages/agent-executor/src/background-tasks/state-machine.ts`                                              | add PAUSE/RESUME transitions (`sleeping/running → paused`, `paused → sleeping`), non-terminal |
| `packages/agent-executor/src/background-tasks/runners/scheduled-task-runner.ts`                              | wire croner `.pause()`/`.resume()` (not `.stop()`); expose `pause`/`resume` on the handle     |
| `packages/agent-executor/src/background-tasks/types.ts` + `background-task-manager.ts`                       | add `pauseScheduledTask/resumeScheduledTask/editScheduledTask` to the manager port + impl     |
| `packages/agent-framework/src/command-api/host-context.ts` + `interactive/interactive-session-agent-jobs.ts` | expose schedule lifecycle on `IAgentJobHostContext`; wire to the manager                      |
| `packages/agent-framework/.../session-persistence` (FLOW-003 path)                                           | persist `paused` + edited `schedule` so a restart re-arms as paused                           |
| `packages/agent-command/src/schedule/schedule-command.ts` + `schedule-command-module.ts`                     | add `list\|pause\|resume\|edit` subcommands (mirror `/background`); keep FLOW-005 `create`    |
| `packages/dag-scheduler/**`                                                                                  | **reused, not modified** — DAG-run trigger primitive for schedules that fire DAG runs         |

## Completion Criteria

- [ ] TC-01: pause/resume lifecycle over the existing runner — the state machine accepts `running/sleeping → paused`
      and `paused → sleeping` and rejects illegal edges; `paused` is non-terminal (unit test on `state-machine.ts`).
- [ ] TC-02: **a paused task does not fire and resumes correctly** — spawn a cron schedule, pause it, advance time
      across at least one scheduled tick, assert **zero** fires while paused (via croner `.pause()`, not `.stop()`),
      then resume and assert the next tick fires — with the **same task id** (functional test on the scheduled runner).
- [ ] TC-03: `edit` updates a schedule's cron/instruction and re-arms it **in place** (same task id + `schedule`
      identity), and the new cadence takes effect on the next fire (functional test).
- [ ] TC-04: `list` returns the caller's schedules with cadence + `nextFireAt` + status, including a `paused` entry
      (unit/integration on the host-context list path).
- [ ] TC-05: CLI behavior — `/schedule list|pause <id>|resume <id>|edit <id> …` dispatch to the corresponding host
      lifecycle calls and return the expected `ICommandResult`, mirroring `/background`; unknown subcommand is a usage
      error (unit test on `schedule-command.ts`).
- [ ] TC-06: **no new scheduler + paused survives restart** — a grep/review confirms recurrence still runs on the
      existing croner runner + `dag-scheduler` trigger (no new cron engine introduced); and a paused schedule persisted
      via the FLOW-003 path is re-armed as **paused** (not running) after a simulated restart (integration test).

## Test Plan

| TC    | Verification                                            | Type/Tool                                   |
| ----- | ------------------------------------------------------- | ------------------------------------------- |
| TC-01 | pause/resume transitions valid, `paused` non-terminal   | vitest unit (state-machine)                 |
| TC-02 | paused → no fire across a tick; resume → fires; same id | functional test (scheduled runner + croner) |
| TC-03 | edit re-arms in place, new cadence applies              | functional test                             |
| TC-04 | list shows cadence + nextFireAt + status                | vitest unit/integration (host list path)    |
| TC-05 | `/schedule list\|pause\|resume\|edit` dispatch + usage  | vitest unit (schedule-command)              |
| TC-06 | no new cron engine (grep) + paused persists restart     | grep/review + integration (FLOW-003 re-arm) |

## Tasks

`.agents/tasks/SELFHOST-012*.md` — 미생성 (GATE-APPROVAL 통과 후 생성). Slices: P1 = lifecycle extension (status +
state-machine + runner croner pause/resume + manager/host methods); P2 = `/schedule list|pause|resume|edit` surface
(mirror `/background`); P3 = `paused`/edited-schedule persistence across restart (FLOW-003 path).

## Evidence Log

- 2026-07-17 — **Draft authored.** Grounded in the actual code: FLOW-005 create surface
  (`packages/agent-command/src/schedule/schedule-command.ts`) + croner recurrence runner
  (`packages/agent-executor/src/background-tasks/runners/scheduled-task-runner.ts`, `croner@10.0.1` `.pause()`/
  `.resume()`/`.stop()` at `croner.d.ts:634-647`); the background state machine's status set with no `paused` and
  terminal `cancelled` (`state-machine.ts`); the status SSOT (`agent-interface-transport/src/background-task-contracts.ts`,
  `TBackgroundTaskStatus`/`IBackgroundTaskSchedule`); `IBackgroundTaskManager`/`IAgentJobHostContext` lacking any
  schedule-lifecycle method (`background-tasks/types.ts`, `agent-framework/src/command-api/host-context.ts`); the
  `/background` multi-subcommand analog (`background/background-command.ts`); the `/schedule` module already registered
  in `default-command-modules.ts:107`; and `dag-scheduler`'s stateless DAG-run trigger
  (`packages/dag-scheduler/src/services/scheduler-trigger-service.ts`) — confirming the seed's "over dag-scheduler"
  framing is corrected: the recurrence engine is the croner runner, dag-scheduler is the DAG-run trigger, and a thin
  non-destructive lifecycle extension (not a new scheduler) is required.
- 2026-07-17 — **GATE-APPROVAL iteration 1: ENDORSE** (independent proposal-reviewer). Every load-bearing premise
  verified: `SchedulerTriggerService` is a stateless DAG-run trigger delegator (the seed's "reuse dag-scheduler" is
  genuinely wrong); the real recurrence engine is the croner-backed `createScheduledTaskRunner` driven by FLOW-005's
  `/schedule` (CREATE exists; the gap is list/pause/resume/edit); the runner cancels via irreversible croner `.stop()`
  and never `.pause()`/`.resume()`; `TBackgroundTaskStatus` has no `paused`, the state machine no PAUSE/RESUME edge,
  and no manager/host lifecycle verb — so "pause→doesn't fire→resume" is genuinely inexpressible today. Design reuses
  the engine + trigger unchanged, adds a persisted `paused` status + croner `.pause()`/`.resume()` + `/schedule`
  subcommands mirroring `/background`; alternatives (pause=cancel/recreate; new registry) correctly rejected on
  correctness. Non-blocking implementation note folded: the FLOW-003 restore path keys re-arm on `status==='sleeping'`
  in TWO predicates — `reArmRestoredSchedules` (`interactive-session-background-tracker.ts:92`) and `isReArmableSchedule`
  (`interactive-session-restore.ts:156-157`) — so a new `paused` scheduled task would fall through into the stale-worker
  branch and be marked `failed` on restart; TC-06 requires WIDENING BOTH predicates to treat a paused scheduled task as
  re-armable-but-kept-paused (re-arm the croner job then immediately `.pause()`, or persist paused without arming), named
  for the P3 task. **GATE-APPROVAL PASSED.**
