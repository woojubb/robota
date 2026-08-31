---
title: 'PROC-028: Allow truthful invalidation of immutable work-run receipts with bad phase attribution'
issue: https://github.com/woojubb/robota/issues/2562
status: todo
created: 2026-08-31
priority: medium
urgency: soon
area: workflow governance
depends_on: []
---

# PROC-028: Allow truthful invalidation of immutable work-run receipts with bad phase attribution

## Objective

Keep work-run measurement truthful when an immutable receipt is later proven to have false phase
attribution. Preserve the original event chain and receipt while giving the pre-PR lifecycle an explicit,
auditable way to remove that run from the included measurement population.

## Plan

- [ ] Define a terminal invalidation contract for a sealed pre-PR receipt whose event chain is structurally
      valid but whose phase attribution is semantically false.
- [ ] Ensure generation-zero revisions cannot present inherited incorrect phase durations as corrected or
      included measurement.
- [ ] Update the reducer, receipt validation, reporting population, CLI routing, scans, and fixtures without
      permitting receipt rewriting or synthetic backdated events.

## Test Plan

- Add reducer and receipt-validation fixtures for a structurally valid run whose correction and verification
  phase starts postdate the commits they claim to bracket.
- Prove the original receipt remains byte-for-byte immutable while the new terminal disposition reports the
  run as invalid rather than included or superseded.
- Verify later generation-zero revisions cannot erase or hide the inherited bad phase durations.
- Run the focused work-run test suites, `work-run-measurement`, and the affected harness scan set.

## User Execution Test Scenarios

Not applicable. This Task changes repository work-run governance and measurement classification, not a
runnable Robota CLI, TUI/browser, public SDK, product output, or product state. Harness CLI and scan checks
belong to the engineering Test Plan rather than a product user execution test scenario.
