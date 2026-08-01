---
title: 'CLI-059: memory events captured but never emitted to listeners or rendered in TUI'
status: done
created: 2026-06-10
completed: 2026-06-11
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-transport
depends_on: []
---

# CLI-059: Memory events not surfaced to the user

## Problem

The automatic memory system records memory events internally
(`packages/agent-framework/src/interactive/interactive-session-history-tracker.ts:186` —
`recordMemoryEvent`), but `IInteractiveSessionEvents`
(`packages/agent-framework/src/interactive/types.ts:74-91`) defines no `memory_event`, and
grep finds no memory-event rendering anywhere in `packages/agent-transport/src/tui`. Memory
capture/recall happens invisibly: users cannot see when the agent stored or used a memory,
which conflicts with the transparent-workflow disclosure direction
(`.agents/specs/transparent-workflow.md`).

## Expected Behavior

Spec-first: extend the interactive session events contract with a memory event, emit it where
events are recorded, and render a notice line in the TUI (consistent with how
`skill_activation` or `context_update` are surfaced). CLI/TUI renders only SDK projections per
the SPEC boundary.

## Test Plan

- Unit test: recording a memory event emits the new session event with the projection payload.
- TUI state test: the event maps to a rendered notice (display contract test, same pattern as
  CLI-B09).
- `pnpm --filter @robota-sdk/agent-framework test && pnpm --filter @robota-sdk/agent-transport test`

## User Execution Test Scenarios

- Prerequisite: built CLI binary; provider key configured; memory feature enabled in settings.
  Environment already exists.
- Steps: in TUI mode, give the agent a prompt that triggers a memory capture (e.g. state a
  durable project fact and ask it to remember).
- Expected observable result: a visible memory notice appears in the transcript (e.g.
  "memory captured: …") at the time of capture.
- Cleanup: delete the captured memory via the `/memory` command.
- Evidence (2026-06-11): `memory_event` added to `IInteractiveSessionEvents`; tracker appends
  `{category:'event', type:'memory-event', data.message}` history entries for user-visible types
  (saved/approved/rejected/retrieved) via `formatMemoryEventMessage()` (SDK-owned wording) and
  emits all types; TUI channel subscribes and re-syncs history, so notices render through the
  generic `EventEntry` ("System: Memory saved: …"). Tests: tracker memory-events suite (7 cases),
  interactive-session emit wiring test — all pass (framework 890/890, transport 458/458). Live TUI
  capture of an automatic memory capture requires a provider key (none in this environment); the
  render path is the same EventEntry used by skill activations, which is display-contract tested.
