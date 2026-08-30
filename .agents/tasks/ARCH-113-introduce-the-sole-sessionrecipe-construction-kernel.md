---
title: 'ARCH-113: introduce the sole SessionRecipe construction kernel'
issue: https://github.com/woojubb/robota/issues/2084
status: todo
created: 2026-08-30
priority: high
urgency: soon
area: packages/agent-framework
depends_on: []
---

# ARCH-113: introduce the sole SessionRecipe construction kernel

## Objective

Introduce the normalized `SessionRecipe` contract and the sole production construction kernel for
`InteractiveSession`, then enforce mechanically that no other production source constructs a session.
This Task preserves the full outcome and evidence of issue #2084 after that internal-decomposition Issue
is absorbed under canonical issue #2079.

## Plan

- [ ] Reconcile the existing documented `buildRuntimeSession` seam with the measured direct construction
      sites and define the recipe's required invariants.
- [ ] Add exhaustive normalization/construction tests and a mechanical constructor-location guard.
- [ ] Decide and document whether executable verification examples intentionally bypass the kernel.
- [ ] Run affected package verification and repository scans.

## Test Plan

- Characterize the current production construction sites before changing them.
- Add unit/type tests for required recipe invariants and negative construction cases.
- Prove the constructor guard fails for a second production construction site and passes for the kernel.
- Run the affected build/test scope and `pnpm harness:scan`.

## User Execution Test Scenarios

Prerequisites: build the framework and its existing session examples. Run the framework's headless,
programmatic, and query construction examples that are in scope for the kernel foundation. Expected:
each accepted recipe constructs a startable session with the same required invariants, while an invalid
recipe is rejected before `start()`. Cleanup: stop created sessions and remove temporary fixtures.
Evidence: pending implementation.
