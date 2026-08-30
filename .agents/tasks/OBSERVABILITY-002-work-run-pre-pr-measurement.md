---
title: 'OBSERVABILITY-002: measure work runs before pull-request creation'
status: in-progress
created: 2026-08-30
priority: high
urgency: now
area: .agents, scripts/harness, .husky
depends_on: []
no-issue: directly requested repository workflow instrumentation; no GitHub issue exists
---

# OBSERVABILITY-002: measure work runs before pull-request creation

## Objective

Make the currently invisible claim-to-PR interval measurable by phase without confusing repository-
observed claim time with user-message arrival, and enforce that measurable work carries a validated
receipt before it is pushed.

## Plan

- [ ] TC-01: Implement universal topic-branch claim/exclusion and the pure, locked event lifecycle.
- [ ] TC-02: Implement receipt revisions, exact Git identity, and authorized post-PR generations.
- [ ] TC-03: Add reachable fresh-worktree commit correlation and source-mode tests.
- [ ] TC-04: Reuse classification/authorization owners and enforce the versioned cutover locally/in CI.
- [ ] TC-05: Add bounded first-PR metrics and separate post-PR rework generations.
- [ ] TC-06: Wire metric/eval/harness registries, rule, mandatory workflow skills, and commands.
- [ ] TC-07: Record command-level and RED→GREEN proof, then pass focused/full verification.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable because this is internal repository workflow instrumentation and Git enforcement with
no Robota product-facing execution surface. Harness CLI and Git-hook fixtures are engineering verification.

## Test Plan

- Run focused Vitest suites for transitions, concurrent storage, receipts, real Git hooks, validation,
  pre-push/CI reachability, reporting, and command-level smoke behavior.
- Run the repository skill validator for `track-work-run`.
- Run `pnpm harness:scan` and `pnpm harness:verify-like-ci`.
- Exercise the real CLI on this branch and record its receipt/report output.

## Bound spec document

`.agents/spec-docs/active/OBSERVABILITY-002-work-run-pre-pr-measurement.md`
