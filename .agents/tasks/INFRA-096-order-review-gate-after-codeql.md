---
title: 'INFRA-096: order review gate after CodeQL'
status: in-progress
created: 2026-08-14
priority: high
urgency: now
area: .github/workflows, scripts/harness
depends_on: []
---

# INFRA-096: order review gate after CodeQL

**Spec:** [active design](../spec-docs/active/INFRA-096-order-review-gate-after-codeql.md)

## Plan

- [x] TC-01 — Put PR classification, CodeQL analysis, and review-gate in one ordered DAG with retarget-safe triggers.
- [x] TC-02 — Preserve docs-only/failure/cancellation semantics with base-SHA defense in depth and current-merge label identity.
- [x] TC-03 — Keep `codeql.yml` push-only and remove recovery/rerun/write authority.
- [x] TC-04 — Enforce job-local least privilege, required context identity, and isolated disarm.
- [x] TC-05 — Run focused/full verification and observe one real PR's head-analysis lane without a recovery rerun.

## Progress

### 2026-08-14

- PR #1718 reproduced the ordering defect: review-gate failed at 10s, CodeQL finished at 2m44s,
  recovery reran the gate, and a clean PR accumulated BLOCKED plus supersession comments.
- Recommendation review converged to ENDORSE with canonical classifier ownership, `edited` handling,
  per-job permissions, label-only reuse, and qualified main behavior.
- Round A added base-SHA script loading and current merge/tool/category identity before push. A deeper
  PR-controlled workflow provenance gap was contained under INFRA-097 rather than claimed as solved.
- RED workflow-order tests failed against the separate/untrusted/head-only design; the revised seven
  structural cases and the broader focused suites are GREEN.
- Post-format focused verification passed 211 tests; `pnpm harness:scan` passed 108 scans with two
  intentional skips; `pnpm harness:verify-like-ci` passed 12/12 stages in 4m04.3s.
- PR #1720 head-analysis run 31736658324 completed on attempt 1: classify 10s → Analyze 3m17s →
  review-gate 12s, all success; disarm skipped and no recovery/rerun job exists. The independently
  triggered pre-analysis containment-label lane correctly failed closed, then the ordered head lane
  superseded it; it is not an ordering-race retry.

## Blockers

None.

## Test Plan

- RED: workflow contract rejects separate PR CodeQL/recovery and unordered review-gate.
- GREEN: parsed workflow proves classify → analyze → gate, event lanes, classifier-only applicability,
  base-SHA defense-in-depth loading, current-merge analysis identity, exact context, and least privilege.
- Regression: existing classifier, decision, disarm, permission, required-check, and scan suites.
- Final: `pnpm harness:scan`, focused Vitest, and `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

Not applicable — this changes internal GitHub Actions orchestration and merge governance, not a
shipped CLI, TUI, browser, application, or public SDK behavior. Exact-head PR observations belong
to engineering verification.
