---
title: 'AGREEMENT-2698: Coordinate the diagnostic-first harness migration'
issue: https://github.com/woojubb/robota/issues/2698
status: in-progress
created: 2026-09-11
priority: medium
urgency: soon
area:
  - scripts/harness
  - .claude/hooks
  - .agents/rules
  - .agents/skills
  - .github/workflows
depends_on: []
children:
  - INFRA-2698
---

# AGREEMENT-2698: Coordinate the diagnostic-first harness migration

## Objective

Replace Robota's repository-owned process vetoes with visible, actionable diagnostics without
silently treating a detector failure as a clean result. The initiative covers local hooks, the
planning/gate workflow, scan aggregation, and CI/required-status wiring; normal product-correctness
checks remain outside this policy migration.

## Plan

- [ ] Maintain the cross-cutting diagnostic contract and the current inventory of veto paths.
- [ ] Coordinate child work items for the shared reporter, hook migration, gate/scan retirement, and
      CI/repository-policy reconciliation.
- [ ] Reconcile the child outcomes against the owner direction and record the final fresh-develop audit.

## Children

- [x] INFRA-2698 — done — `.agents/tasks/completed/INFRA-2698-add-diagnostic-result-and-report-core.md`

## Test Plan

The parent is verified by each child work item's focused tests plus the final diagnostic report,
hook-reachability inventory, retained product-quality checks, and a fresh `origin/develop` audit.
No individual source file is accepted as sufficient evidence for this cross-cutting outcome.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This parent coordinates repository-maintenance changes only. It introduces no product CLI,
TUI, browser, SDK, or installed-package behavior that a Robota user can execute as a distinct scenario.
