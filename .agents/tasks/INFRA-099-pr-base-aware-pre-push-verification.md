---
title: 'INFRA-099: resolve pre-push verification against the current PR base'
status: in-progress
created: 2026-08-14
priority: critical
urgency: now
area: scripts/harness, git hooks, multi-backlog initiatives
depends_on: []
---

# INFRA-099: resolve pre-push verification against the current PR base

## Objective

Stop integration-child pushes from repeatedly verifying the entire `origin/develop..HEAD` initiative
delta. Resolve the current OPEN PR's exact base OID once and use it throughout the pre-push plan, while
keeping the existing broader base as a visible fail-safe fallback.

## Spec

`.agents/spec-docs/active/INFRA-099-pr-base-aware-pre-push-verification.md`

## Plan

- [x] TC-01: bind PR discovery to one exact current-branch push and matching origin destination; cover
      manual/other-remote/renamed/multi/detached cases.
- [x] TC-02: implement unique same-repository PR parsing, preserved resolver precedence, argv-safe exact fetch,
      race verification, and visible safe fallback tests.
- [x] TC-03: thread one resolved-base result through every pre-push consumer.
- [x] TC-04: prove cumulative integration history is excluded from the child delta in a scratch Git fixture.
- [ ] TC-05: complete focused/broad/hosted verification, independent review, lifecycle gates, and archive.

## Progress

### 2026-08-14

- Measured two consecutive pushes of PR #1724. Each planned 99 cumulative files and 11 workspace scopes
  against `origin/develop`, then repeated the 76-package root build, affected checks, and roughly 195-second
  repository-contract suite even though the second commit changed only four lifecycle documents.
- Confirmed the PR's actual base OID was `95f74bfa029ec00cab191351b436be1d19ca6fc1`; the pre-push resolver
  never queried it.
- INFRA-091's exact receipt is functioning as designed and must not be weakened across changed trees.
- TDD RED: `pnpm exec vitest run scripts/harness/__tests__/pre-push-base-ref.test.mjs` failed because the
  resolver module did not exist; the sequence suite then failed 7 cases before base reporting was wired.
- GREEN: the resolver/push-binding/scratch suite, sequence suite, and harness structural suite pass 3 files /
  122 tests. The scratch repository proves the trusted PR base selects exactly four child documents while the
  no-PR fallback retains those four plus the cumulative package file.
- Round-A review found and then fixed remote-destination binding and the missing mechanical single-base-consumer
  guard. Hook remote name/URL now must match origin before discovery; the pure base plan and structural test pin
  classification, decision, receipt, and plan/verify arguments to one value.
- Independent Round-A re-review passed with `ACTIONABLE FINDINGS: 0`; the focused resolver, sequence, and
  structural suites passed 3 files / 122 tests after the review fixes.
- Post-fix `pnpm harness:verify-like-ci` passed all 12 stages in 7m04.1s. Its embedded scan passed 110 scans
  with one intentional skip; the run also passed the 112-file / 2,289-test repository-contract tier, the
  72-file / 1,058-test hermetic tier, the root build, typecheck, affected verification, binary E2E, examples,
  and TUI E2E. Hosted exact-PR-base proof and lifecycle completion remain part of TC-05.

## Decisions

- Fix the comparison base before adding broader receipt reuse.
- Explicit `HARNESS_BASE_REF` remains authoritative.
- PR discovery failure loses only the optimization and names the broad fallback reason.

## Blockers

None.

## Test Plan

Use TDD: first reproduce the current `origin/develop` selection for an integration child, then add strict
push binding, PR cardinality/ownership, resolver precedence, argv-safe fetch/OID race, one-owner sequence, and
scratch Git delta tests. Finish with focused tests, harness scan, required build/test evidence, independent local
review, and hosted log proof on the current initiative PR.

## User Execution Test Scenarios

Not applicable — this changes only repository-internal Git-hook verification planning. It exposes no shipped
CLI, TUI, browser, application, public SDK, or example behavior. All observables are engineering verification.

## Result

Pending.
