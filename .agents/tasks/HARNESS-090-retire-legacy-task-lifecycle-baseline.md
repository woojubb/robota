---
title: 'HARNESS-090: retire legacy Task lifecycle baseline'
status: todo
created: 2026-08-14
priority: medium
urgency: later
area: Task lifecycle migration and harness scans
depends_on: [HARNESS-089]
---

# HARNESS-090 — retire legacy Task lifecycle baseline

**Spec:** [`.agents/spec-docs/draft/HARNESS-090-retire-legacy-task-lifecycle-baseline.md`](../spec-docs/draft/HARNESS-090-retire-legacy-task-lifecycle-baseline.md)

## Objective

Replace every frozen pre-canonical archived Task status/date with evidence-backed canonical metadata,
then remove the legacy baseline so lifecycle validation runs with zero exemptions.

## Plan

- [ ] Research a history-backed migration that does not invent completion dates.
- [ ] Reconcile every frozen record and prove the baseline reaches zero.
- [ ] Remove the baseline and archive this Task through the standard done gates.

## Test Plan

- Verify every changed date/status against repository history or explicit evidence.
- Run lifecycle, placement, archival, aggregate harness, and CI-equivalent verification with no baseline.

## User Execution Test Scenarios

**Applicability:** not-applicable. This is repository-internal governance data migration.

## Progress

### 2026-08-14

- Filed from HARNESS-089 after the canonical classifier found 341 pre-contract archived records.

## Decisions

- Historical dates must be evidenced, never inferred from today's migration date.

## Blockers

- Migration direction requires its own recommendation and review gate.

## Result

Pending.
