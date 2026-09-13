---
title: 'SCREEN-1992: Recap unattended session and background activity'
issue: https://github.com/woojubb/robota/issues/1992
status: todo
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-interface-execution, packages/agent-framework, terminal UI package
depends_on: [STRUCT-012, REFACTOR-025]
---

# SCREEN-1992: Recap unattended session and background activity

## Objective

Model terminal attention intervals and project existing structured execution events into a one-line recap
when attention returns. Retain the existing background status, peek and schedule projection; add bounded,
provider-neutral headlines and a live next-iteration countdown without making recap correctness depend on
a model response.

## Plan

- [ ] Add attention loss/return and interval recap state with one recap per unattended interval.
- [ ] Normalize working, needs-input, completed and failed status while retaining detailed task state.
- [ ] Refresh deterministic headlines on events/turn end and keep scheduled countdowns visibly current.
- [ ] Verify focus/return, background peek and all terminal states with fake timers and a TUI scenario.

## Test Plan

Use structured event fixtures and fake timers for interval and cadence behavior, then execute a PTY scenario
that backgrounds work, marks the surface unattended, emits activity and confirms exactly one recap on return.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Run the deterministic TUI fixture through working, needs-input, completed and failed background states,
simulate attention loss/return, and observe one recap plus a peekable latest detail and moving countdown.
