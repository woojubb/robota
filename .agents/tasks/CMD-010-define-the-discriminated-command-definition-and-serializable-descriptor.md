---
title: 'CMD-010: define the discriminated command definition and serializable descriptor'
issue: https://github.com/woojubb/robota/issues/2088
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: packages/agent-interface-command and packages/agent-framework
depends_on: [ARCH-100]
---

# CMD-010: define the discriminated command definition and serializable descriptor

## Objective

Define one command-kernel contract with explicit builtin, skill, and plugin variants plus a separate
serializable descriptor. Preserve issue #2088's complete outcome after its redundant Issue lifecycle is
absorbed under AGREEMENT-007 and canonical issue #2079.

Source child: [issue #2088](https://github.com/woojubb/robota/issues/2088).

## Plan

- [ ] Inventory the live `ICommand`, `ISystemCommand`, and module metadata fields and assign one owner for
      identity, presentation, safety, permission, invocation policy, and execution.
- [ ] Define discriminated executable variants with required handlers and type-level invalid-state tests.
- [ ] Define a data-only descriptor that cannot carry functions, class instances, or live host objects.
- [ ] Update the owning package SPEC and public-surface evidence before changing exported contracts.

## Constraints

- Do not migrate production command modules or registries in this Task.
- Do not add compatibility aliases or optional bags that recreate the current dual contract.
- Completed ARCH-100 / issue #2080 is owner-map evidence, not implementation of this contract.

## Test Plan

- Add type-level positive and negative fixtures for every discriminated variant.
- Add serialization/structured-clone tests proving descriptors are data-only.
- Run affected package tests, typecheck, build, public-surface checks, and repository scans.

## User Execution Test Scenarios

Prerequisites: build the command-contract package and its verification fixture. Compile valid builtin,
skill, and plugin definitions, then compile negative fixtures that omit a handler or place a function in
a descriptor. Expected: valid variants compile and serialize; each invalid state is rejected. Cleanup:
remove generated fixture output. Evidence: pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
