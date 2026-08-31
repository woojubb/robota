---
title: 'ARCH-116: place product realization and migrate consumers'
issue: https://github.com/woojubb/robota/issues/2118
status: todo
created: 2026-08-30
priority: high
urgency: soon
area: packages/agent-product and product-composition consumers
depends_on: [DATA-009]
---

# ARCH-116: place product realization and migrate consumers

## Objective

Choose the correct imperative realization owner for DATA-008/DATA-009's product plan, migrate the approved
consumer scope through that owner, and remove the mixed `IProductProfile`/`IAssembledProduct`/
`assembleProduct` public surface without a compatibility facade. Preserve issue #2118's complete outcome
after its redundant child Issue lifecycle is absorbed under canonical issue #2079.

## Recommendation and Approval Boundary

This migration Task does not approve a placement. Before implementation, its own recommendation/spec gate
must compare at least: keeping `agent-product` pure with shell-owned realization; explicitly amending the
pure-only carve-out for a product-neutral injected-bindings interpreter; and a new shared surface only if
independent architecture-placement review proves it necessary. Any package-family, published-contract, or
repository-policy change requires its governing approval and SPEC updates; AGREEMENT-006 approval is not a
substitute.

## External Prerequisites and Ownership

- GitHub issue #2044 remains the live owner of the child-worker provider recipe. Implementation and
  completion are blocked until it has a truthful terminal disposition or an owner-approved exact mapping
  preserving the unresolved dependency.
- [Issue #2443](https://github.com/woojubb/robota/issues/2443) remains the live owner of eval and
  pre-assembly runner collaborators. It must be
  converted/coordinated, or that seam explicitly excluded without contradictory completion claims, before
  implementation starts.
- Closed [issue #2048](https://github.com/woojubb/robota/issues/2048) and completed ARCH-109/CLI-078 are
  historical evidence only.

## Plan

- [ ] Re-read [issue #2044](https://github.com/woojubb/robota/issues/2044) and
      [issue #2443](https://github.com/woojubb/robota/issues/2443), and stop unless their live ownership is
      resolved or explicitly coordinated.
- [ ] Run a spec-first recommendation and independent placement review using the closest existing
      serializable-reference/live-binding analog, correct product-family classification, and shared-core
      reuse level.
- [ ] Obtain any required user approval for public-contract, package-placement, or policy changes before
      implementation.
- [ ] Implement explicit runtime bindings and realization only at the approved owner, then migrate the
      approved consumers while preserving provider, preset, transport, runner, and worker semantics.
- [ ] Remove the obsolete mixed public surface and add mechanical guards against its reintroduction.
- [ ] Update every governing package SPEC and run affected plus user-execution verification.

## Constraints

- Runtime bindings resolve stable references from a secret-free plan; secrets and live factories never
  cross the plan boundary.
- No concrete product dependency or product-identity branch enters a shared mechanism.
- No compatibility shim, forwarding alias, or duplicate realization algorithm remains.

## Test Plan

- Characterize all current `IProductProfile`/`assembleProduct` consumers and the linked issue 2044/2443
  overlap first.
- Add contract/type tests for plan-to-binding resolution and tests proving factories execute only at the
  approved imperative boundary.
- Add consumer-equivalence and worker/CLI scenarios for every included path; prove paths excluded under
  [issue #2443](https://github.com/woojubb/robota/issues/2443) are not falsely claimed complete.
- Run affected builds/tests, package SPEC conformance, repository scans, and CI-equivalent verification.

## User Execution Test Scenarios

Prerequisites: build the approved public SDK example and the Robota CLI surfaces included by the final
placement decision; satisfy or explicitly coordinate linked issues 2044 and 2443 first. Execute a normal
product session
and the included worker/CLI consumer using the same serialized plan and injected bindings. Expected: both
resolve the same product semantics, all effects occur only during explicit realization, and removed mixed
profile exports are unavailable. Cleanup: stop sessions and remove temporary fixtures. Evidence: pending
implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
