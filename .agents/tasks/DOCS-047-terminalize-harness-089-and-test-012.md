---
title: 'DOCS-047: terminalize HARNESS-089 and TEST-012 duplicate records'
issue: https://github.com/woojubb/robota/issues/2404
status: in-progress
created: 2026-08-29
priority: high
urgency: soon
area: TODO
depends_on: []
---

# DOCS-047: terminalize HARNESS-089 and TEST-012 duplicate records

## Objective

Archive two old local records whose unresolved work is already owned by canonical open GitHub issues:
HARNESS-089 by architecture-contract issue #2049 and TEST-012 by host-state test issue #2300.

## Plan

- [ ] Record exact handoff comments on #2049 and #2300.
- [ ] Mark both local records skipped with terminal metadata and archive them.
- [ ] Run lifecycle, citation, and CI-like verification scans.

## Test Plan

- Inspect both archived records and the canonical issue comments.
- Run `pnpm harness:scan` and `pnpm harness:verify-like-ci`.
- Confirm no package source, API, policy, or runtime behavior changes.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this batch changes only internal backlog ownership records.

## Resolution

The canonical issues remain open because implementation is not complete; local records are skipped,
not marked as behavior-complete.
