---
title: 'INFRA-166: Propagate CI mirror base context'
status: done
created: 2026-09-05
completed: 2026-09-05
priority: high
urgency: now
area: CI mirror execution
depends_on: []
---

# INFRA-166: Propagate CI mirror base context

## Objective

Keep every verification child and receipt bound to the explicitly selected comparison base.

Issue: https://github.com/woojubb/robota/issues/2584

## Owner Approval

2026-09-05 direct instruction: "발견절차문제 즉시수정/develop". One bounded harness correction; root owns final integrated verification and push.

## Plan

- [x] TC-01: Explicit CLI base is observed by all stage children and the verification receipt instead of an inherited conflicting base.
- [x] TC-02: The original environment is restored after successful, failed and throwing verification execution, including an originally absent base.
- [x] TC-03: Focused CI mirror regression tests and native Node syntax checks exit zero after a reproduced RED.

## Test Plan

Use `scripts/harness/__tests__/verify-like-ci.test.mjs` execution regressions for child environment visibility, CLI precedence and restoration on success/failure/throw. Focused tests only in this worker; root owns final full verification after completion artifacts.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes internal repository verification machinery only, with no shipped product user surface or latent product capability.
