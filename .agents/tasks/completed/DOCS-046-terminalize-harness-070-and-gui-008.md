---
title: 'DOCS-046: terminalize superseded HARNESS-070 and GUI-008 backlog records'
issue: https://github.com/woojubb/robota/issues/2404
status: done
completed: 2026-08-29
created: 2026-08-29
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# DOCS-046: terminalize superseded HARNESS-070 and GUI-008 backlog records

## Objective

Archive two root records whose current ownership is already represented by canonical open GitHub
issues, preserving the unresolved implementation scope without claiming that behavior is fixed.

## Plan

- [x] Record exact handoff comments on #2251, #2255, and #2164.
- [x] Mark HARNESS-070 and GUI-008 skipped with terminal metadata and move them to `completed/`.
- [x] Run lifecycle, citation, and CI-like verification scans.

## Resolution

`pnpm harness:scan` passed 144 scans (5 skipped) and `pnpm harness:verify-like-ci` passed all 13
mirrored stages. The batch changed only backlog records and a mechanical path citation/baseline.

## Test Plan

- Inspect both archived records and their issue-comment handoffs.
- Run `pnpm harness:scan` and `pnpm harness:verify-like-ci`.
- Confirm no package source, API, policy, or runtime files are changed.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this is an internal backlog lifecycle batch; implementation remains with the linked
canonical issues.

**Reason:** only backlog records and GitHub issue ownership metadata changed.
