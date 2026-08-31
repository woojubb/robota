---
title: 'DATA-008: define a secret-free structured-cloneable ProductPlan'
issue: https://github.com/woojubb/robota/issues/2085
status: todo
created: 2026-08-30
priority: high
urgency: soon
area: packages/agent-product
depends_on: []
---

# DATA-008: define a secret-free structured-cloneable ProductPlan

## Objective

Define the declarative product plan as pure, secret-free data whose values and stable references can cross
a structured-clone or JSON boundary. Preserve issue #2085's complete outcome after its redundant child
Issue lifecycle is absorbed under canonical issue #2079.

## Plan

- [ ] Inventory every live/function-valued `IProductProfile` member and define the stable reference or value
      that replaces it in `ProductPlan`.
- [ ] Specify public ownership and validation for plan identity, capabilities, presets, providers, and
      transport requirements without choosing runtime binding implementations.
- [ ] Prove `structuredClone` and JSON round trips on representative plans, including rejection of secrets,
      functions, class instances, registries, runners, transports, factories, and provider definitions.
- [ ] Update the governing package SPEC before implementation and verify affected package/public exports.

## Constraints

- Resolved credentials and API keys never enter the plan; use stable non-secret references resolved later.
- No current `IProductProfile` consumer is migrated in this Task.
- No compatibility alias or wrapper keeps mixed live objects in the new plan contract.

## Test Plan

- Add unit and type-level tests for the allowed product-plan vocabulary and forbidden live/secret fields.
- Add structured-clone and JSON round-trip tests with positive and negative fixtures.
- Run the affected package build/test scope and repository scans.

## User Execution Test Scenarios

Prerequisites: build `@robota-sdk/agent-product` and its public verification example. Run the example that
constructs a representative `ProductPlan`, crosses both `structuredClone` and JSON round trips, and prints
the restored stable references. Expected: both round trips preserve the plan exactly, while the negative
fixture containing a function or resolved credential is rejected before runtime realization. Cleanup:
remove generated temporary output. Evidence: pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
