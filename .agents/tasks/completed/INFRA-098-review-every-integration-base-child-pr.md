---
title: 'INFRA-098: review every integration-base child PR against its exact diff'
status: done
created: 2026-08-14
completed: 2026-08-14
priority: critical
urgency: now
area: GitHub Actions, merge gate, review governance, harness
depends_on: []
---

# INFRA-098: review every integration-base child PR against its exact diff

## Objective

Make the existing Claude review workflow run for PRs targeting initiative integration bases, and bind
the merge decision to the exact current base/head SHA pair instead of timestamp recency. Preserve the
separately filed trusted-workflow provenance problem under labelled INFRA-097 containment.

## Spec

`.agents/spec-docs/done/INFRA-098-review-every-integration-base-child-pr.md`

## Plan

- [x] TC-01: add red-first parsed workflow coverage for every PR base and all required lifecycle events.
- [x] TC-02: preserve and mechanically verify the same-repository, permission, token, concurrency, and verdict-marker contract.
- [x] TC-03: add red-first merge-gate fixtures for exact base/head identity and every fail-closed malformed or stale case.
- [x] TC-04: register the workflow safety owner fail-closed and pass focused suites plus `pnpm harness:scan`.
- [x] TC-05: push the implementation to PR #1724, converge its exact-pair hosted review to zero findings, and record evidence.

## Progress

### 2026-08-14

- GATE-WRITE and GATE-APPROVAL passed after independent `REVIEW VERDICT: ENDORSE`.
- Finding-depth classified the missing integration-base trigger and timestamp freshness as LOCAL.
- The PR-controlled workflow provenance finding remains FOUNDATIONAL under open INFRA-097 / issue #1719;
  this prerequisite uses labelled containment because it must land before the current initiative child can be reviewed.
- RED: the new workflow test initially failed to import its missing scan; after registration it reported
  the live base filter, missing `reopened`/`edited`, and missing SHA markers.
- RED: the merge-gate suite observed status 0 for both a stale-base and stale-head zero-finding verdict.
- GREEN: workflow coverage 9/9 and the merge-gate decision/disposition matrix 55/55 pass; the surrounding
  hook, token, permission, fail-closed, and reachability selection passes 199/199.
- Round-A review converged after adversarial fixtures forced the scan to bind the real action step,
  its own prompt, and the owning job's exact guarded `if:` scalar. Focused workflow/merge suites pass
  116/116, the independent reviewer reports `ACTIONABLE FINDINGS: 0`, and `pnpm harness:scan` passes
  110 scans with one intentional skip.
- Hosted run `31755020176` completed successfully in 2m44s on PR #1724. Its reviewer verdict names
  base `95f74bfa029ec00cab191351b436be1d19ca6fc1`, head
  `1562fda76c5b1227f6c8e390dff785969fd8d938`, and `ACTIONABLE FINDINGS: 0`.
- The exact pre-push `pnpm build` command completed all package JS and ordered declaration builds
  with exit 0. A fresh explicit `pnpm test` then ran every workspace test script and exited 0.

## Decisions

- Remove target-branch filtering instead of encoding a `feat/**` naming convention.
- The verdict identity is the ordered current base/head SHA pair; timestamps are diagnostic only.
- Existing token and permission scans remain their SSOT; the new scan owns only trigger coverage and verdict markers.

## Blockers

None.

## Test Plan

- Prove RED against the current workflow by adding parsed mutations for branch/path filters, missing events, and missing SHA markers.
- Prove RED against the current merge gate with stale-base, stale-head, missing, malformed, duplicate, unreadable, and nonzero verdict fixtures.
- Run focused Vitest suites for workflow and hook behavior, shell syntax checks, the registered harness scan, and the full harness scan.
- Inspect the hosted PR #1724 comment against current `baseRefOid` and `headRefOid`; require exact markers and `ACTIONABLE FINDINGS: 0`.

## User Execution Test Scenarios

Not applicable — this work changes repository-internal CI review automation, merge hooks, governance
rules, and harness checks. It ships no CLI, TUI, browser, application, or public SDK behavior a product
user can execute.

## Result

The all-base reviewer and exact base/head merge verdict are implemented, locally reviewed with zero
findings, verified on hosted PR #1724, and archived after GATE-COMPLETE PASS.
