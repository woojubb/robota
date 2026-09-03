---
title: 'TRANS-011: make the transport registry store already-bound adapters'
issue: https://github.com/woojubb/robota/issues/2091
status: todo
created: 2026-09-03
priority: medium
urgency: later
area: transport registry and session capability ports
depends_on: []
---

# TRANS-011: make the transport registry store already-bound adapters

## Objective

Restore the execution record already named by the immutable `woojubb` Task marker on [issue #2091](https://github.com/woojubb/robota/issues/2091), then make the registry store adapters already bound to their exact session capabilities instead of erasing them behind one broad session type.

## Plan

- [ ] Inventory registry entry construction and every adapter capability requirement.
- [ ] Move capability binding to adapter construction and keep the registry heterogeneous without `IInteractiveSession` erasure.
- [ ] Add type-level and runtime tests for mixed adapters with non-identical capabilities.
- [ ] Run affected transport tests, typecheck, build, and boundary scans.

## User Execution Test Scenarios

Prerequisite: construct two adapters requiring different session ports. Register and invoke both. Expected: each adapter receives only its declared bound capabilities and no broad session object. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
