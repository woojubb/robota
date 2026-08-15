---
title: 'ARCH-020: the session event branch_event is documented as "emitted on every checkpoint/branch transition" but has zero emit sites — checkpoint fork/switch/restore run and surface nothing'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework
depends_on: [ARCH-016]
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

Execute with ARCH-028 as one named event-delivery work unit. Define an exhaustive checkpoint/branch
operation matrix covering create, fork, switch, restore, rollback, and resume-pointer updates. Assign
each operation one exact declared event kind and payload, or explicitly classify it as a non-event.
Emit only after checkpoint mutation, history replacement, and persistence succeed. TUI/protocol delivery
handlers must catch their own render/send failures so a committed operation remains successful, and report
them through an explicit owner callback. Arbitrary SDK listener exceptions retain their current semantics.
The protocol carrier supplies `onDeliveryError(error, event)` and connects it to its existing
connection cleanup/error lifecycle; WebRTC may not swallow the failure. Shared keys and payloads belong
to `agent-interface-transport`; executable fan-out policy remains in transport packages.

## Recommendation Gate

- 2026-08-15 — `DEPTH: LOCAL` as the combined ARCH-020+ARCH-028 work unit; producer completeness,
  consumer completeness, and owned delivery failures are one event-delivery defect.
- 2026-08-15 — independent round-2 review endorsed transport-owned handler isolation with explicit
  carrier error callbacks, while arbitrary SDK listener semantics remain unchanged.

REVIEW VERDICT: ENDORSE

## Scenario Plan Gate

- 2026-08-15 — the combined protocol scenario covers branch delivery, deterministic send failure,
  the carrier error callback, and committed operation state.

DONE-GATE-STAGE-1: PASS

## Test Plan

- Red-first: drive every matrix row and assert its exact post-persistence event or explicit non-event.
- Throwing TUI/protocol delivery-handler tests assert committed state remains successful and the explicit
  transport-owned error callback observes the failure. The exhaustive classification maps must drive
  registration or be mechanically compared with the actual subscribed keys.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

### Scenario: checkpoint branch changes reach a protocol client

- **Agent executability:** `agent-executable`. The ARCH-020+ARCH-028 event-delivery work unit authors a
  non-interactive public-SDK example backed by the deterministic scripted provider and an in-memory
  protocol client; it requires no live key, network listener, browser, or TTY.
- **Prerequisites:** Node.js 22.14.0 and the workspace dependencies installed. The work unit authors
  `packages/agent-transport/examples/verify-session-event-delivery.ts`; the example creates its own
  temporary project, edit file, context file, session, and protocol bridge.
- **Command:**

  ```bash
  volta run --node 22.14.0 pnpm exec tsx --conditions=source packages/agent-transport/examples/verify-session-event-delivery.ts
  ```

- **Expected observable:** exit code `0` and one JSON object on stdout. Its protocol transcript
  contains `branch_event` frames whose payload kinds include `checkpoint_created`, `branch_forked`,
  and `branch_switched`; the fork and switch frame checkpoint ids match the public SDK operations,
  the resulting active-branch pointer matches the last successful operation. A second carrier whose
  send function throws reports `deliveryFailure.event: "branch_event"` through its explicit owner
  callback while `deliveryFailure.operationCommitted` remains `true`, and
  `cleanupRemoved` is `true`.
- **Cleanup:** the example calls the protocol cleanup function, shuts down the session, and
  recursively removes its temporary project in `finally`.
- **Evidence (fill after implementation):** _pending — paste the exact JSON stdout and exit code from
  the command above._
