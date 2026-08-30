---
title: 'RULE-023: make child issues exception-only and migrate internal decomposition to Tasks'
status: in-progress
created: 2026-08-30
priority: high
urgency: now
area: GitHub Issue intake, Task ownership, and repository harness governance
depends_on: []
---

# RULE-023: make child issues exception-only and migrate internal decomposition to Tasks

## Objective

Make one GitHub Issue the durable external problem record while internal cause decomposition lives in
Task/spec records. Child Issues become an explicit exception for independently meaningful external
lifecycles, and the existing open child hierarchy is reconciled without losing Tasks, PRs, security
boundaries, dependency edges, or historical Issue URLs.

no-issue: Direct owner instruction on 2026-08-30 to complete
`/tmp/robota-issue-child-consolidation-plan.md`; creating another queue item would contradict the
requested queue-consolidation outcome.

## Starting baseline evidence

- The current `backlog-execution.md` first says internal decomposition remains one Issue with several
  Tasks, then requires a decomposed parent to produce child Issues, close, and leave those children as
  the queue. `issue-to-backlog` repeats the latter default.
- The canonical Task README already says child Issues are reserved for independent external discussion,
  priority, ownership, security review, or terminal disposition.
- The 2026-08-30 starting snapshot contained 281 open Issues and 78 open native child Issues, including
  55 under the `#2079` hierarchy, 17 under the MCP initiatives, and 6 under `#2512`. These figures must
  be re-derived at each mutation boundary.
- `RULE-021` and its spec incorrectly cite package-boundary Issue `#2490` even though their delivered
  subject was parent closure after decomposition; the live triage audit therefore reports `#2490` as
  malformed.

## Plan

- [x] TC-01 — amend the rule, conversion/triage skills, and Task README so one Issue → Tasks is the
      default, child Issues are independently reviewed external-lifecycle exceptions,
      body/comment/marker ownership is exact, and active-owner children cannot be silently absorbed.
- [x] TC-02 — add TDD coverage for roots, retained children, missing/blank exception reasons, full native
      hierarchy pagination, fail-closed API errors, and per-run counter reset.
- [x] TC-03 — make the ordinary live `audit --check` path always run the hierarchy check and report its
      exact examined denominator and dispositions.
- [x] TC-04 — reconcile `RULE-021`/`#2490` while preserving the delivered history and rejecting only the
      superseded policy/current source link.
- [x] TC-05 — verify, review, merge, and read back work unit A on fresh `origin/develop` before any live
      historical Issue mutation.
- [x] TC-06 — freeze and independently cross-review a durable work-unit-B manifest covering every fresh
      open native child exactly once under the approved disposition rubric.
- [x] TC-07 — run the B1 non-security pilot with captured before state, parent/Task-first mutation,
      immediate GitHub read-back, and repository/live audit agreement.
- [ ] TC-08 — run fixed serial batches B2–B4 with their own recommendation/depth gates and evidence PRs,
      preserving external lifecycles, owners, Tasks, PRs, labels, dependency edges, and all history.
- [ ] TC-09 — re-fetch and reconcile the full population with exact timestamp/query semantics, counts,
      terminal state reasons, retained exceptions, zero unreviewed migration rows, and zero hierarchy
      failures after every remaining open child has readable independently reviewed lifecycle evidence.
- [ ] TC-10 — terminalize RULE-023 Task/spec only after every criterion and generated evidence is merged,
      the worktree is clean, and fresh `develop` contains the entire policy and migration record.

## Progress

- 2026-08-30 — Work unit A merged as PR #2548 and the prerequisite/continuation corrections merged as
  PRs #2551 and #2553 before live mutation. The durable 78-row manifest received an independently
  reviewed B1 authorization at `0c4d1cb6c`. B1 updated issue #2079's complete 55-row current map, finalized
  exact Task markers for issue #2063, issue #2084, issue #2102, and issue #2115, removed their P labels, and closed all four
  `NOT_PLANNED` in reverse dependency order. Immediate read-back preserved bodies/history, work-kind
  labels, parents, and dependency edges; the official audit moved from 281/77 to 277/73 and exited 0.
  No rollback was triggered. B2–B4 remain held for their own reviews and evidence PRs.

- 2026-08-30 — Work unit A implementation is locally complete through TC-04. After rebasing onto fresh
  `origin/develop`, the focused triage and PROC-017 compatibility suites passed 211/211 tests and all
  148 applicable scans passed. Three final `harness:verify` runs each passed all 268 test files and
  5,505/5,505 tests, then exited non-zero on the same Vitest worker `onTaskUpdate` RPC timeout; TC-05
  therefore remains open for a normally terminating required CI run rather than treating passed test
  counts as a green gate. A fresh read-only GitHub audit examined 281
  open Issues and 78 open child Issues, rejected all 78 as missing the new exception receipt, and classified
  issue #2490 as ordinary intake rather than as RULE-021-linked malformed state. TC-05 remains open until
  independent review, PR merge, and fresh `origin/develop` ancestry read-back complete.
- 2026-08-30 — Removed the temporary root `entities` dependency after the root-manifest change expanded
  pre-push scope to all 92 workspaces and exposed unrelated host-only failures. The audit now performs a
  one-pass, fail-closed decode of numeric references and the whitespace/default-ignorable named references
  relevant to lifecycle evidence, including legacy semicolonless `nbsp` and `shy`, without double-decoding.
  The dependency-free implementation passed the focused 71-test suite, the full 211-test TC-01/TC-02
  compatibility bundle, and 148 scans with one declared skip.

## Test Plan

- Policy-owner regression tests for rule/skill/Task-README agreement and absence of the superseded
  mandatory-child/decomposition-comment default.
- Targeted tests for any live hierarchy audit or migration helper added by work unit A.
- `pnpm harness:verify -- --base-ref origin/develop` for each final clean work-unit HEAD.
- Read-after-write verification for every GitHub body, state, parent relation, label, Task marker, and
  dependency mutation in work unit B.
- Exact final population and manifest reconciliation: every examined child has one terminal migration
  disposition, every retained child has an independent external-lifecycle reason, and every absorbed
  child resolves to its canonical parent and Task owner; retained rows include their independent dated
  semantic review and owner-review rows remain untouched.

## User Execution Test Scenarios

Not applicable — work unit A changes internal governance rules, repository harness auditing, and Task/spec
lifecycle records only. It delivers no runnable Robota product behavior, public API, or end-user interface.
Live GitHub and governance CLI checks are engineering verification, not a user product surface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Not applicable because RULE-023 changes repository governance, GitHub Issue administration,
and internal harness auditing only. It introduces no runnable Robota product behavior, public API, or
end-user interface; live GitHub read-back is engineering verification.
