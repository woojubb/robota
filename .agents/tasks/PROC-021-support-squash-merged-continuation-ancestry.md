---
title: 'PROC-021: Support squash-merged continuation ancestry'
issue: https://github.com/woojubb/robota/issues/2514
status: in-progress
created: 2026-08-30
priority: critical
urgency: now
area: workflow harness
depends_on: [PROC-020]
---

# PROC-021: Support squash-merged continuation ancestry

## Objective

Allow a valid continuation checkpoint to bind the first-parent integration commit that introduced
its predecessor checkpoint when the repository uses squash merges, while preserving existing no-ff
merge behavior and exact predecessor-byte binding.

## Plan

- [ ] TC-01: Add a real squash-merge fixture whose continuation binds the squash commit and passes.
- [ ] TC-02: Generalize predecessor discovery from merge-only commits to first-parent integration
      transitions without weakening exact raw-entry matching.
- [ ] TC-03: Preserve the existing refusal for an unrelated later integration commit.
- [ ] TC-04: Run focused plan-order tests, affected scans, and contract verification.

## Test Plan

- Extend `scan-user-execution-plan-order.test.mjs` with temporary Git history covering a squash merge,
  a later continuation branch, and an unrelated later integration commit.
- Run focused Vitest, affected scans, and the repository contract tier.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this changes repository-internal planning ancestry enforcement and exposes no
CLI, TUI, browser, SDK, configuration, or product behavior.
