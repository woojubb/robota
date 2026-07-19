# SELFHOST-012 P2+P3 — `/schedule` lifecycle surface + paused-survives-restart (task breakdown)

Spec: [`.agents/spec-docs/active/SELFHOST-012-scheduled-tasks.md`](../spec-docs/active/SELFHOST-012-scheduled-tasks.md)
(FLOW; P2 = surface + agent-run verification, P3 = restart persistence). P1 (the manager/host lifecycle) merged
(#1235). **P3 ships WITH P2** per the review's sequencing constraint: a restored `paused` task is currently
reconciled to `failed`, so exposing `pause` via the surface without restart-safety would let a restart silently
kill a paused schedule. Mirror the `/background` multi-subcommand analog. Commit per logical slice.

## Design (approved)

### P3 — paused survives restart (foundation, lands first)

The status + edited schedule are already serialized by the FLOW-003 path (they are part of `IBackgroundTaskState`).
The only gap is the two re-arm predicates, which key on `status === 'sleeping'` and would fail a paused task:

- `agent-framework/src/interactive/interactive-session-restore.ts` — `isReArmableSchedule`: widen to
  `sleeping || paused` so a restored paused scheduled task is kept (not reconciled to `failed`).
- `agent-framework/src/interactive/interactive-session-background-tracker.ts` — `reArmRestoredSchedules`:
  process `paused` tasks too; for a paused task, re-spawn the schedule then **immediately** `pauseScheduledTask`
  the re-spawned task (re-arm-then-pause) so it is kept paused (does not fire). A paused task carries no
  `nextFireAt`, so the missed-wake note does not fire for it.

### P2 — `/schedule list|pause|resume|edit` surface (mirror `/background`)

- `agent-command/src/schedule/schedule-command.ts` — `executeScheduleCommand` dispatches on the first token:
  `list` → `host.listSchedules()` (format cadence + `nextFireAt` + status), `pause <id>` → `host.pauseSchedule`,
  `resume <id>` → `host.resumeSchedule`, `edit <id> <spec>` → parse the spec → `host.editSchedule(id, patch)`;
  any other first token stays the FLOW-005 **create** form (backward compatible). Unknown/missing-id → usage error.
- `schedule-command-module.ts` — update the description + `argumentHint` to mention the subcommands.
- Uses the `IAgentJobHostContext` lifecycle methods added in P1 — no new host wiring.

## Status

**IN PROGRESS.** Implementing P3 (S1) then P2 (S2–S3) + agent-run verification.

## Slices (each green + committed)

1. **S1 — P3 persistence**: widen `isReArmableSchedule` + `reArmRestoredSchedules` (re-arm-then-pause) +
   restart integration test (TC-06: a paused schedule re-arms as paused, not running/failed).
2. **S2 — P2 surface**: `/schedule list|pause|resume|edit` dispatch + usage errors + format helper (TC-05).
3. **S3 — docs**: agent-command SPEC / schedule module hint; spec Evidence Log.

## Test Plan

- **TC-05** `/schedule list|pause <id>|resume <id>|edit <id> …` dispatch to the host lifecycle calls + return the
  expected `ICommandResult`; unknown subcommand / missing id is a usage error; create stays backward-compatible
  (vitest unit on `schedule-command.ts` with a fake `IAgentJobHostContext`).
- **TC-06** a paused schedule persisted via the FLOW-003 path re-arms as **paused** (not running, not failed)
  after a simulated restart (integration on the restore + re-arm path); + the no-new-scheduler grep still holds.
- Regression: `pnpm --filter @robota-sdk/agent-command --filter @robota-sdk/agent-framework test`, typecheck,
  lint, `pnpm harness:scan`.

## AGENT-RUN capability verification (REQUIRED — capability-reachability rule)

P2 makes the lifecycle **surface-reachable** (`/schedule pause|resume|edit|list`). Drive a real agent (or the
real CLI print path) to: create a fast cron schedule → `/schedule pause <id>` → confirm it does **not** fire
across a tick (observe no wake) → `/schedule resume <id>` → confirm it fires → `/schedule edit <id> …` →
`/schedule list` shows the updated cadence + status. Save as scenario evidence under
`.agents/evals/scenarios/selfhost-012-schedule-lifecycle-agent-run.md`. Closes the epic's user-execution
done-gate.

After P2+P3 + agent-run verification: epic GATE-VERIFY → GATE-COMPLETE (spec → done).
