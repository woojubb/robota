---
title: 'TRANS-015: remove IInteractiveSession from production transport seams'
issue: https://github.com/woojubb/robota/issues/2117
status: todo
created: 2026-09-03
priority: medium
urgency: later
area: production transport boundaries
depends_on: [TRANS-013, TRANS-014]
---

# TRANS-015: remove IInteractiveSession from production transport seams

## Objective

Complete [issue #2117](https://github.com/woojubb/robota/issues/2117) by proving and enforcing that no production transport seam depends on the broad `IInteractiveSession` contract after the capability migrations.

## Plan

- [ ] Enumerate all production imports, structural references, casts, and adapter parameters involving `IInteractiveSession`.
- [ ] Remove the remaining seams after TRANS-013 and TRANS-014 land.
- [ ] Add a mechanical boundary regression that fails on future broad-session transport imports.
- [ ] Run all transport tests, typecheck, build, and repository dependency scans.

## User Execution Test Scenarios

Run the supported transport matrix after the removal. Expected: observable behavior remains unchanged and the boundary scan reports zero production transport dependencies on `IInteractiveSession`. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
