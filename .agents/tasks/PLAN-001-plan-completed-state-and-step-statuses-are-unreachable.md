---
title: "PLAN-001: the documented plan phase machine's completed state and the entire step/todo-tracking half of the plan artifact are unreachable from any composed surface — a plan lives forever in executing, steps are always empty and always pending"
status: todo
created: 2026-08-13
priority: medium
urgency: later
area: packages/agent-framework, packages/agent-command, packages/agent-interface-transport
depends_on: []
---

# PLAN-001: the plan machine's completed state and steps are unreachable

## Problem

The SPEC documents a four-phase plan machine (`planning`→`awaiting-approval`→`executing`→`completed`)
over a plan/todo artifact with step statuses. The `completed` transition and the step-marking half
have zero reachable callers from any composed surface: `InteractiveSession` exposes no complete/step
API, `/plan` has no complete/step verb and never passes steps, and no `plan_completed` event member
exists. So a plan lives forever in `executing` (or is reverted), and steps are always empty and always
`pending`.

## Evidence (round-2 framework-subsystems audit, 2026-08-13)

- `docs/SPEC.md:2552` — the controller "owns the plan phase machine (`planning`→`awaiting-approval`→
  `executing`→`completed`) … `revert()`/`complete()` return `{ action, nextMode }` … `InteractiveSession`
  applies each `nextMode`"; contract `agent-interface-transport/src/session-contracts.ts:496-501`
  (`completed` = finished, mode reverts to `plan`), `:484-493` (`TPlanStepStatus`
  'pending'|'in-progress'|'done').
- `PlanController.complete()` and `markStep()` (`plan-controller.ts:126-146`) have zero non-test
  callers; `InteractiveSession` exposes only `setPlan`/`getPlanState`/`approvePlan`/`revertPlan`
  (`interactive-session.ts:873-913`); the host context likewise (`command-api/host-context.ts:205-212`);
  `/plan` has no `complete`/step verb and never passes steps
  (`agent-command/src/plan/plan-command.ts:90` — `setPlan(trimmed)`, so `steps` is always `[]`);
  `IPlanApprovalEvent` has no completed member (`event-contracts.ts:19-22`).

## Direction

Owner decision: implement the completion + step-marking surface — `completePlan()` on
`InteractiveSession` + host context, a `/plan complete` verb and a step-marking surface, and a
`plan_completed` event member — so the documented terminal phase and the todo-tracking artifact are
reachable; OR narrow SPEC:2552 and the contract to the implemented three-phase cycle
(`planning`→`awaiting-approval`→`executing`) and remove the step statuses until a surface uses them.

## Test Plan

- Red-first: a plan can be driven to `completed` (reverting mode to `plan`) and steps can be marked
  through the command/session surface (fails today); OR the SPEC/contract no longer document a
  `completed` phase or step statuses.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

**Applies if the completion surface is implemented** (`/plan` is user-facing).

- Prerequisites: built CLI + provider key.
- Steps: create a plan, approve it, execute, then complete it (and mark a step) via the `/plan`
  surface.
- Expected (after the "implement" fix): the plan reaches `completed` and reverts to plan mode; a step
  can be marked done.
- Expected (before fix, contrast): there is no way to complete a plan or mark a step; it stays in
  executing.
- If "narrow the contract" is chosen: Not applicable — record the SPEC/contract narrowing in the Test
  Plan.
- Evidence (fill in after implementation): the `/plan` transcript reaching completed, or the contract
  diff.
