---
title: 'PROC-032: batch-resolve the open GitHub issue backlog locally'
issue: https://github.com/woojubb/robota/issues/2512
status: todo
created: 2026-09-04
priority: high
urgency: now
area: harness scripts, hooks, rules, and package contracts named by the open issue backlog
depends_on: []
---

# PROC-032: batch-resolve the open GitHub issue backlog locally

Registered as issue #2512 (closure capacity must exceed intake); the unit spans the whole open backlog (227 issues on 2026-09-04), every fix commit names its own issue as `(#N)`, and the closing-comment source is the local disposition ledger.

## Objective

Resolve the open GitHub issue backlog as one locally-driven batch: every open issue receives exactly one recorded disposition (FIXED, ALREADY-DONE, SUPERSEDED, DEFER, WONTFIX), every FIXED disposition lands as a minimal verified change on one branch, and the batch is verified once with the CI-equivalent entry point before it reaches `develop`. Remote issues are read once at the start and written only at the end, in one bulk close, after the user grants that permission.

## Plan

- [ ] TC-01 — Download every open issue once into the local queue and give each one a disposition in the local ledger.
- [ ] TC-02 — Land every FIXED disposition as a separate conventional commit naming its issue on the sweep branch.
- [ ] TC-03 — Run the CI-equivalent verification entry point once over the whole batch and record its result.
- [ ] TC-04 — Produce the closing-comment source (disposition ledger) so the issues can be closed in one bulk action.

## Test Plan

- TC-01: the local ledger has exactly as many entries as the downloaded issue set, each with a non-empty disposition.
- TC-02: `git log --format=%s origin/develop..HEAD` shows one `(#N)` per FIXED issue and every subject passes commitlint.
- TC-03: `pnpm harness:verify-like-ci` exits zero on the batch head; its summary is kept with the ledger.
- TC-04: the generated dispositions document lists every issue number once with its disposition and note.

## User Execution Test Scenarios

Not applicable — this work unit is repository maintenance driven by a local ledger; it adds no runnable product surface of its own. Each FIXED issue's own tests prove its change.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No new CLI, TUI, API, or end-user interaction is introduced by the batch itself; per-issue behaviour changes are covered by their package tests.
