---
title: 'RULE-2665: Define the terminal disposition for orchestration-skipped gates'
issue: https://github.com/woojubb/robota/issues/2665
status: in-progress
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

Spec: `.agents/spec-docs/active/RULE-2665-define-the-terminal-disposition-for-orchestration-skipped-gates.md`

## Source Constraints

- Recoverable orchestration skips reject and restart; they do not qualify for exceptional closure.
- `orchestration-skip` never creates, replaces, or implies a gate PASS.
- Existing `tool-defect` evidence remains accepted without reinterpretation.
- Historical HARNESS-2660 reconciliation is append-only over its sealed gate evidence.

## Plan

- [ ] TC-01 — Specify reject-and-restart versus disclosed NON-COMPLIANCE outcomes and their admissibility boundary.
- [ ] TC-02 — Add a machine-readable evidence form and scanner coverage for the selected disposition.
- [ ] TC-03 — Prove ordinary gate failure and tool-defect records cannot masquerade as orchestration-skip closure.
- [ ] TC-04 — Reconcile the historical HARNESS-2660 record without rewriting sealed evidence.
- [ ] TC-05 — Run the focused closure-disposition suite and affected repository scans.

## Test Plan

Use gate-catalogue and closure-disposition fixtures for accepted, malformed, wrong-gate, ordinary-failure,
and tool-defect records. Run focused Vitest, the closure-disposition scan, and affected harness verification.

## Standing Authorization

**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."

**Given:** 2026-09-20, this conversation.

The approved recommendation keeps reject-and-restart as the recoverable default and permits a
machine-readable disclosed NON-COMPLIANCE only for irreversible terminal history with retrospective
guardian judgement and owner authority. It does not authorize future gate skips or ordinary FAIL
closure.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The change governs repository evidence and orchestration recovery only; it adds no Robota
product CLI, TUI, browser, public SDK, or installed-package behavior for an end user.
