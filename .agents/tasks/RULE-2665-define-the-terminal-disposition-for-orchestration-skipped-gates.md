---
title: 'RULE-2665: Define the terminal disposition for orchestration-skipped gates'
issue: https://github.com/woojubb/robota/issues/2665
status: todo
created: 2026-09-20
priority: high
urgency: now
area: gate catalogue closure disposition and orchestration
depends_on: [BEHAVIOR-2664, BEHAVIOR-2663]
---

# RULE-2665: Define the terminal disposition for orchestration-skipped gates

## Objective

Define and mechanically validate the only truthful terminal outcomes when a gate tool correctly
refuses but orchestration proceeds past it, without misusing the existing tool-defect disposition or
retroactively manufacturing a PASS.

## Plan

- [ ] TC-01 — Specify reject-and-restart versus disclosed NON-COMPLIANCE outcomes and their admissibility boundary.
- [ ] TC-02 — Add a machine-readable evidence form and scanner coverage for the selected disposition.
- [ ] TC-03 — Prove ordinary gate failure and tool-defect records cannot masquerade as orchestration-skip closure.
- [ ] TC-04 — Reconcile the historical HARNESS-2660 record without rewriting sealed evidence.

## Test Plan

Use gate-catalogue and closure-disposition fixtures for accepted, malformed, wrong-gate, ordinary-failure,
and tool-defect records. Run focused Vitest, the closure-disposition scan, and affected harness verification.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The change governs repository evidence and orchestration recovery only; it adds no Robota
product CLI, TUI, browser, public SDK, or installed-package behavior for an end user.
