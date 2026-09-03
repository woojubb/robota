---
title: 'REFACTOR-028: finish removing the ghost workflow subsystem from agent-core'
issue: https://github.com/woojubb/robota/issues/2065
status: todo
created: 2026-09-03
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# REFACTOR-028: finish removing the ghost workflow subsystem from agent-core

## Objective

Remove the remaining dead workflow contracts, exports, and registration residue named by [issue #2065](https://github.com/woojubb/robota/issues/2065), preserving that outcome as a Task under canonical issue #2079.

## Plan

- [ ] Trace every workflow symbol from export to runtime reachability and distinguish live compatibility from dead residue.
- [ ] Delete unreachable workflow types, registries, and exports without adding a forwarding layer.
- [ ] Update package boundaries and specifications to describe the remaining execution model.
- [ ] Run typecheck, package tests, build, and dead-surface scans.

## User Execution Test Scenarios

Not applicable — removal of unreachable internal surface has no direct user interaction. Static reachability and package verification are the evidence.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The Task removes dead internal contracts rather than changing an executable workflow.
