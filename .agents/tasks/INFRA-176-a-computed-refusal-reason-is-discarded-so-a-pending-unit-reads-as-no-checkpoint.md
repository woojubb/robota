---
title: 'INFRA-176: a computed refusal reason is discarded, so a pending planning unit reads as no checkpoint at all'
issue: https://github.com/woojubb/robota/issues/2597
status: todo
created: 2026-09-06
priority: high
urgency: now
area:
  - scripts/harness/plan-order-records.mjs
depends_on: []
---

# INFRA-176: a computed refusal reason is discarded, so a pending planning unit reads as no checkpoint at all

## Objective

`l0GroundDecision` computes exactly why the L0 ground does not apply and then returns
`problem: null`, so its caller falls through to `staged implementation has no planning checkpoint
ancestor`. That sentence is FALSE whenever a planning unit is pending: a checkpoint exists, the walk
did not recognise it. The reader is sent to look for a missing checkpoint that is not missing.
Return the reason instead.

## Plan

- [ ] U01 — return the computed `l0GroundProblems` text from `l0GroundDecision` when a pending unit
      exists, instead of discarding it.
- [ ] U02 — keep the generic refusal where it is accurate: with no pending unit, the decision still
      returns `problem: null`.

## Completion Criteria

- [ ] TC-01: with a pending unit whose Task exists and which carries a spec document,
      `l0GroundDecision` returns a non-null `problem` naming both the unit and the spec path it
      found. Red before the change: the same call returns `problem: null`.
- [ ] TC-02: with no pending unit and nothing proven, the decision is still exactly
      `{ grounded: false, problem: null }` — the generic refusal is the accurate one there and must
      not be replaced.
- [ ] TC-03: with a pending unit that has no Task record, the reason names the missing record rather
      than a spec document, so the two causes stay distinguishable.
- [ ] TC-04: `npx vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
      passes in full — the change must not alter which changes are ACCEPTED, only what a refusal says.

## Test Plan

TC-01 to TC-03 are unit cases over the pure exported `l0GroundDecision`, driven by an injected
`textBefore` reader so no repository state is needed. All three were run RED before the change: TC-01
and TC-03 failed on `problem` being null, TC-02 passed and is the control that proves the change is
narrow. TC-04 is the owning suite.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes the wording of a refusal printed by one of the repository's own internal
maintenance scripts. Nothing it touches is published, installed, or reachable from any command a
person outside this repository can run — there is no screen, no CLI flag, no SDK entry point and no
file a user of Robota ever sees, so there is no surface on which a scenario could be performed.
