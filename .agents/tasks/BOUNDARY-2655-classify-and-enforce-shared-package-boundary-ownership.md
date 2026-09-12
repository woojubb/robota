---
title: 'BOUNDARY-2655: Classify and enforce shared package boundary ownership'
issue: https://github.com/woojubb/robota/issues/2655
status: todo
created: 2026-09-12
priority: high
urgency: now
area: workspace build and verification
depends_on: []
---

# BOUNDARY-2655: Classify and enforce shared package boundary ownership

## Objective

Inventory shared code across the repository and verify API ownership, domain neutrality and at least two independent package consumers for retained shared files. Migrate package-specific helpers, fixtures, constants and data to their owners. Gate drift and report affected-scope/full-suite promotion reasons.

Parent: AGREEMENT-2655; canonical umbrella: https://github.com/woojubb/robota/issues/2655.

Source acceptance: [Issue #2490](https://github.com/woojubb/robota/issues/2490), transferred to the umbrella by its [recorded disposition](https://github.com/woojubb/robota/issues/2490#issuecomment-5642818355). Full-population classification and actual migrations remain binding.

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
