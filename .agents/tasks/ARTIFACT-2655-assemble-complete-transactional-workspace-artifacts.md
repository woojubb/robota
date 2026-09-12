---
title: 'ARTIFACT-2655: Assemble complete transactional workspace artifacts'
issue: https://github.com/woojubb/robota/issues/2655
status: todo
created: 2026-09-12
priority: high
urgency: now
area: workspace build and verification
depends_on: []
---

# ARTIFACT-2655: Assemble complete transactional workspace artifacts

## Objective

Make root and affected builds discover complete publishable artifact tasks, including copied web assets. Assemble node/types/web in staging, commit complete dist generations atomically, derive exact emitted/packed manifests, and verify stale-file and partial-failure rejection.

Parent: AGREEMENT-2655; canonical umbrella: https://github.com/woojubb/robota/issues/2655.

Source acceptance: [Issue #2154](https://github.com/woojubb/robota/issues/2154), transferred to the umbrella by its [recorded disposition](https://github.com/woojubb/robota/issues/2154#issuecomment-5642810131). The original complete, atomic and exact artifact criteria remain binding.

## Plan

- [ ] Validate the detailed design against current code and all inherited source criteria.
- [ ] Implement the complete objective with failure-reproducing regression tests.
- [ ] Verify local outcomes and prepare the evidence required for the CI review.

## Delivery

Merge into origin/develop after verification and record the delivering commit in the source Issue.

## Test Plan

Focused positive/negative regressions plus actual execution at the owning boundary. Verify every
requirement in Objective and the source Issue before marking this Task complete.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This work changes repository build, CI or ownership machinery rather than a separately
invoked Robota product feature. Engineering integration tests verify its build and workflow outputs.
