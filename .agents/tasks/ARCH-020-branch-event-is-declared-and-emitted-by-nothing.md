---
title: 'ARCH-020: the session event branch_event is documented as "emitted on every checkpoint/branch transition" but has zero emit sites — checkpoint fork/switch/restore run and surface nothing'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework
depends_on: []
---

# ARCH-020: branch_event is dead wiring

## Problem

The session event map declares `branch_event` with the TSDoc "Emitted on every checkpoint/branch
transition (created, forked, switched) — SELFHOST-007". The checkpoint transitions run, but nothing
constructs or emits an `IBranchEvent`, so any surface implementing the contract (e.g. the GUI)
receives no signal for a shipped feature. The sibling `IActiveBranchPointer` is fully wired, so this
is a partial landing, not forward-provisioning.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-interface-transport/src/session-contracts.ts:318-319` — declares
  `branch_event: (event: IBranchEvent) => void;` with the "emitted on every transition" TSDoc.
- `branch_event`/`IBranchEvent` occur exactly three times repo-wide: the declaration
  (`session-contracts.ts:273,319`) and the `index.ts:211` re-export — ZERO emit sites, ZERO
  subscribers.
- The transitions demonstrably run without emitting: `agent-framework/src/checkpoints/
edit-checkpoint-store.ts:77-101` (createCheckpoint), `:156-199` (restore→forkFrom), `:225-233`
  (rollback), `:325` (switchToCheckpoint) — none constructs an `IBranchEvent`. Every other session
  event-map member has ≥1 emitter.
- The public branch API is exported (`agent-framework/src/index.ts:224-226`:
  `forkCommandEditCheckpoint`, `switchCommandEditCheckpointBranch`, `listCommandEditCheckpointBranches`)
  and the persisted `IActiveBranchPointer` (`session-contracts.ts:287-290`) IS wired — so the event is
  the one missing half.

## Direction

Emit `branch_event` from the checkpoint-store transitions through `InteractiveSession`, mirroring how
`goal_event`/`plan_event` are emitted — so a GUI/monitor surface can render branch changes. (Small,
mechanical.) If the event is genuinely not wanted yet, strike the "Emitted on every transition" TSDoc
and mark it forward-provisioned — but the pointer being wired argues for emitting it.

## Test Plan

- Red-first: subscribe to `branch_event` on a session, fork/switch a checkpoint, assert the event
  fires with the transition kind — fails today.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

**Applies** (checkpoint branching is user-invocable via `/rewind`-family commands, and a hook can
observe the event).

- Prerequisites: built CLI + provider key; a session with an edit checkpoint; a hook or GUI surface
  subscribed to branch changes (fixture hook authored by this work).
- Steps: fork/switch a checkpoint branch via the command surface.
- Expected (after fix): the subscriber records a `branch_event` for the fork/switch.
- Expected (before fix, contrast): no event fires despite the branch changing.
- Cleanup: remove the fixture hook.
- Evidence (fill in after implementation): the subscriber's recorded event.
