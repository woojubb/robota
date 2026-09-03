---
title: 'REFACTOR-027: remove phantom service and factory ports from agent-core'
issue: https://github.com/woojubb/robota/issues/2064
status: todo
created: 2026-09-03
priority: medium
urgency: later
area: packages/agent-core
depends_on: []
---

# REFACTOR-027: remove phantom service and factory ports from agent-core

## Objective

Remove exported service and factory abstractions that have no truthful production implementation or consumer, while preserving the executable outcome of [issue #2064](https://github.com/woojubb/robota/issues/2064) after its redundant Issue lifecycle is absorbed under canonical issue #2079.

## Plan

- [ ] Inventory every exported service/factory port named by the source Issue and prove implementer and consumer counts.
- [ ] Delete phantom declarations and their stranded exports without replacing them with compatibility aliases.
- [ ] Update package public-surface evidence and affected specifications.
- [ ] Run typecheck, package tests, build, and public-surface scans.

## User Execution Test Scenarios

Not applicable — this is a typed public-surface cleanup with no direct user interaction. Compile-time consumer and export checks are the executable evidence.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The Task removes unreachable type contracts and does not change a runnable user workflow.
