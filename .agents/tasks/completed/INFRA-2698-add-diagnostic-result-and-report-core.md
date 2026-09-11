---
title: 'INFRA-2698: Add the diagnostic result and report core'
issue: https://github.com/woojubb/robota/issues/2699
status: done
created: 2026-09-11
completed: 2026-09-11
priority: medium
urgency: soon
area:
  - scripts/harness
  - .github/workflows
depends_on: []
---

# INFRA-2698: Add the diagnostic result and report core

## Objective

Create the small, explicit result contract that lets a harness detector report `finding`,
`unavailable`, or `clean` without vetoing the caller. The result must retain check identity,
severity, subject, evidence, and a recommended next action, and must have human and machine-readable
renderings suitable for the later hook, scan, and CI migrations.

Spec: `.agents/spec-docs/done/INFRA-2698-add-diagnostic-result-and-report-core.md`

## Plan

- [x] Specify the result schema and the report rendering contract before modifying any enforcement path.
- [x] Implement the reporter with fixtures for clean, finding, and unavailable outcomes.
- [x] Prove a finding and an unavailable detector are visible in the summary while the diagnostic
      command completes successfully.
- [x] Document the reporter as the only permitted migration target for retired harness vetoes.

## Test Plan

Unit tests will construct each result state and assert both machine-readable data and concise report
text. A command-level test will seed a finding and an unavailable detector, confirm their identifiers
and recommendations appear in the final summary, and confirm the diagnostic process returns zero.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work changes internal repository-maintenance scripts and CI reporting only. It adds no
public command, screen, SDK export, or package behavior that an end user can directly execute.
