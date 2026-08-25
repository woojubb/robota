---
title: 'HARNESS-121: user-execution scenario PLAN order is not enforced'
issue: https://github.com/woojubb/robota/issues/2327
status: todo
created: 2026-08-25
priority: high
urgency: soon
area: .agents/rules, .agents/skills, scripts/harness
depends_on: []
---

# HARNESS-121: user-execution scenario PLAN order is not enforced

## Objective

Mechanically prove that the user-execution-scenario author verdict and written-scenario gate occurred
before implementation began. HARNESS-119 ran implementation first, then added the mandatory section and
obtained a retrospective not-applicable verdict; final-state scans could not distinguish that ordering
violation from a valid pre-implementation PLAN.

## Plan

- [ ] Choose one durable lifecycle signal that binds the author verdict to the work unit and pre-code
      transition without relying on mutable prose or wall-clock inference.
- [ ] Make the implementation gate fail closed when that signal is missing, stale, or recorded after
      implementation evidence.
- [ ] Add red/green fixtures for valid PLAN ordering, retrospective PLAN, not-applicable work, and
      implementation attempted without an author verdict.
- [ ] Reconcile the user-request, backlog-pipeline, and user-execution orchestrators around the single
      ordering owner.

## Test Plan

- Add focused lifecycle/guardian fixtures for each ordering case and prove the retrospective sequence
  exits non-zero.
- Run the focused contract tests, the complete harness contract tier, and `pnpm harness:scan`.

## User Execution Test Scenarios

Not applicable. This changes internal lifecycle governance and enforcement tests, not runnable product
behavior.
