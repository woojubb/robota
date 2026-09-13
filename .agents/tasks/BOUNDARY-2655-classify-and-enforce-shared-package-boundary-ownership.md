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

## Progress

2026-09-13: resumed the remaining source Issue #2490 scope after PR #2717 landed. The canonical
draft is `.agents/spec-docs/draft/BOUNDARY-2655-classify-and-enforce-shared-package-boundary-ownership.md`.
At base `38e87a027c530dbbe11beae9a62bc6732f65ca59`, read-only AST inspection covered 4,186 tracked
code files and identified 38 resolved relative cross-owner references plus 21 dynamic module
expressions. This is partial reference evidence, not full semantic classification. Nash confirmed
the foundational cause is already owned by this Task; Pascal supplied the private testing-package
relocation constraints. Public API versus generic shared-material criteria and the framework
recorder's provider-neutral boundary still require validation before recommendation approval.
No product implementation, complete population classification or gate PASS is claimed.
The draft's Owner Decision Recommendation now specifies the public-SDK classification boundary,
private PTY relocation and the strictly non-published recording-tool composition exception. These
are concrete contract/placement choices, not another request to approve an already-authorized merge.

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
