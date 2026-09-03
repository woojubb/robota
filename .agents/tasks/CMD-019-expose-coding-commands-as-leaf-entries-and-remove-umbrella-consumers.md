---
title: 'CMD-019: expose coding commands as leaf entries and remove umbrella consumers'
issue: https://github.com/woojubb/robota/issues/2125
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: coding command slice
depends_on: [CMD-010, CMD-011]
---

# CMD-019: expose coding commands as leaf entries and remove umbrella consumers

## Objective

Expose coding commands as independently owned leaf definitions and remove umbrella consumers as required by [issue #2125](https://github.com/woojubb/robota/issues/2125).

## Plan

- [ ] Inventory coding command definitions, handlers, and aggregate consumers.
- [ ] Register leaf definitions directly from the coding owner.
- [ ] Delete umbrella consumers and add regressions against aggregate reintroduction.
- [ ] Run coding command integration tests, typecheck, build, and dependency scans.

## User Execution Test Scenarios

Discover and invoke each coding command through the product shell. Expected: each leaf is independently visible and executable with no umbrella registry required. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
