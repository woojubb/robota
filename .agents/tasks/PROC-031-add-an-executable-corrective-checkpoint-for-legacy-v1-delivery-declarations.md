---
title: 'PROC-031: add an executable corrective checkpoint for legacy v1 delivery declarations'
status: in-progress
created: 2026-09-02
issue: https://github.com/woojubb/robota/issues/2561
priority: high
urgency: soon
area: scripts/harness checkpoint evidence and backlog execution contract
depends_on: []
---

# PROC-031: add an executable corrective checkpoint for legacy v1 delivery declarations

## Objective

Make the corrective-checkpoint route promised by PROC-029 executable for a legacy v1 first
GATE-IMPLEMENT PASS whose introduction revision did not yet declare sequenced delivery. The correction
must bind the immutable legacy PASS, current Decision delivery contract, Task/PLAN signal, and exact
planning-only inventory before a later continuation can proceed; adding delivery prose post hoc without
that checkpoint must remain invalid.

## Plan

- [x] TC-01 — Extend the rule-owned v2 checkpoint contract with one explicit correction form and exact
      payload order; do not weaken or reinterpret v1 evidence.
- [x] TC-02 — Add a native correction command that is available only for an in-progress L2 spec with one
      legacy v1 first PASS, a valid sequenced Decision, unchanged Task/PLAN binding, and planning-only
      worktree inventory.
- [x] TC-03 — Make the native continuation writer and history/staged consumers accept the same canonical
      correction anchor, while still rejecting a bare post-hoc Delivery mode/artifact edit.
- [x] TC-04 — Add RED→GREEN fixtures for the exact AGREEMENT-006 legacy shape, malformed/stale correction
      payloads, a correction for an already-valid/v2 first checkpoint, and second/later continuations.
- [x] TC-05 — Run the focused contract/gate/plan-order suites, affected scans, full harness scan, and
      build; record exact results before completion.

## Test Plan

- TC-01: parse/format tests require the correction form's exact fields and refuse missing, duplicate,
  reordered, or unknown members.
- TC-02: gate tests prove the native correction writer refuses wrong status, non-legacy history,
  mismatched Decision/Task/PLAN, and non-planning inventory.
- TC-03: history and staged plan-order tests accept correction → continuation and reject post-hoc-only
  declarations plus drift after correction.
- TC-04: an end-to-end fixture reproduces AGREEMENT-006's legacy first PASS without introduction
  artifacts, records the correction, then emits and validates a continuation.
- TC-05: run focused Vitest, affected/full scans, `pnpm build`, and diff checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change affects repository checkpoint evidence and validation only; it exposes no Robota
product, SDK, CLI, TUI, or user-observable runtime surface.

## Bound spec document

`.agents/spec-docs/active/PROC-031-add-an-executable-corrective-checkpoint-for-legacy-v1-delivery-declarations.md`
