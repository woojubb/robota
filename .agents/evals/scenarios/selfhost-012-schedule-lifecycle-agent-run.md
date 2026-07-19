# SELFHOST-012 P2 — `/schedule` lifecycle (AGENT-RUN capability verification)

Closes the capability-reachability done-gate for the scheduled-task lifecycle: the `/schedule
list|pause|resume|edit` surface was driven end-to-end through the **real assembled runtime** (real command →
`IAgentJobHostContext` → `BackgroundTaskManager` → **croner**), and the "a paused schedule does not fire, then
fires again after resume" claim was observed **empirically on a live every-second cron**, not just at the unit
level. Per [`.agents/rules/backlog-execution.md`](../../rules/backlog-execution.md) (Capability Reachability)
and the [SELFHOST-012 spec](../../spec-docs/active/SELFHOST-012-scheduled-tasks.md) TC-05.

Run by the agent on 2026-07-19 with a real `InteractiveSession` assembled via
`createAgentRuntime({ commandModules: [createScheduleCommandModule()] }).createSession()` + the default croner
scheduled runner + a scripted provider (no API key needed — scheduling makes no model call). Observation via the
public `session.listSchedules()` (status + `nextFireAt`).

## Observed (real runtime, live croner)

```
> /schedule cron "* * * * * *" ping the log
  → OK: Scheduled wake (cron `* * * * * *`): "ping the log" — task process_1.
> /schedule list
  → OK: - process_1 [sleeping] * * * * * * — Scheduled: ping the log (next 2026-07-19T03:50:55.000Z)
[create]  status=sleeping  nextFireAt=2026-07-19T03:50:55.000Z

> /schedule pause process_1
  → OK: Schedule paused: process_1
[pause]   status=paused    nextFireAt=undefined

# waited 2.5s (2+ scheduled ticks of an every-second cron)
[after 2.5s paused]  status=paused  nextFireAt=undefined   => DID NOT FIRE ✅

> /schedule resume process_1
  → OK: Schedule resumed: process_1
[resume]  nextFireAt 2026-07-19T03:50:57.000Z -> 2026-07-19T03:51:00.000Z  => FIRED (advanced) ✅

> /schedule edit process_1 cron "0 0 * * *" ping the log
  → OK: Schedule updated: process_1 (cron `0 0 * * *`).
> /schedule list
  → OK: - process_1 [sleeping] 0 0 * * * — Scheduled: ping the log (next 2026-07-19T15:00:00.000Z)
[edit]    cadence=0 0 * * *  => RE-ARMED ✅ (next fire jumped to the daily 15:00:00 boundary)
```

## Verdict

The full lifecycle works end-to-end over the **existing** croner scheduler (no new scheduler):

- **create** — `/schedule cron "…"` spawns a real recurring schedule (sleeping, `nextFireAt` set).
- **pause** — status → `paused`, `nextFireAt` cleared, and across 2+ live ticks it **fired nothing** (croner
  `.pause()`, not the irreversible `.stop()`).
- **resume** — firing resumed (`nextFireAt` advanced tick-over-tick), same task id.
- **edit** — re-armed in place to the new cadence (`0 0 * * *` → next fire at the daily boundary), same id.

Restart-safety (P3: a persisted `paused` schedule re-arms as paused, not `failed`) is covered by the TC-06
integration test (`interactive-session-resume-rearm.test.ts`); it ships in the same PR so `pause` is never
exposed without it. Capability is surface-reachable AND agent-run-verified.
