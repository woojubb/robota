---
title: 'INFRA-167: Batch CI verification with fail-fast boundaries'
status: done
created: 2026-09-05
completed: 2026-09-05
priority: high
urgency: now
area: CI verification scheduling
depends_on: []
---

# INFRA-167: Batch CI verification with fail-fast boundaries

## Objective

Reduce serial execution barriers and prevent unnecessary downstream work after failure without removing semantic checks.

no-issue: Direct owner request for this single harness improvement.

## Owner Approval

2026-09-05: "11단계도 줄여라. 지금 이렇게 오래 걸리는건 심각한 문제다". Existing direct instruction also authorizes immediate correction and develop integration. Root owns independent review, final full verification and delivery.

## Plan

- [x] TC-01: Cheap and dist-free failures prevent expensive downstream runner calls, report blocked checks and emit no full receipt.
- [x] TC-02: Independent cheap checks and contract/hermetic checks overlap only within declared batches; all children settle before environment restoration, even on throw.
- [x] TC-03: Build never overlaps built readers; all eleven semantic checks and --only selection retain their coverage and receipt contract.
- [x] TC-04: Output distinguishes selected/applicable checks from actual execution batches, and focused regression suites plus syntax checks exit zero.

## Test Plan

Use `scripts/harness/__tests__/verify-like-ci-execution.test.mjs` > CI mirror execution base context for scheduler call counts and deferred children, plus existing mirror reporting tests. Native Node ESM syntax checks require no product build. Final full verification is root-owned after completion artifacts and receipt closure, before push.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Internal repository verification scheduling only; no shipped product or latent product capability changes.
