---
title: 'DOCS-045: Terminalize stale SEC-011 and split PLG-021 residual'
issue: https://github.com/woojubb/robota/issues/2404
status: in-progress
created: 2026-08-29
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# DOCS-045: Terminalize stale SEC-011 and split PLG-021 residual

## Objective

Terminalize two stale root records without claiming unfinished behavior: archive SEC-011 as skipped
with the carrier handoff to active HANDOFF-001, and archive PLG-021 as skipped after splitting its
remaining project-scope install/load defect into canonical issue #2487.

## Plan

- [ ] Record exact handoff comments and evidence for both dispositions.
- [ ] Mark SEC-011 and PLG-021 skipped with completed metadata and move both to `completed/`.
- [ ] Run lifecycle, citation, and CI-like verification scans.

## Test Plan

- Inspect both archived records and their issue-comment handoffs.
- Run `pnpm harness:scan` and `pnpm harness:verify-like-ci`.
- Confirm no package source, API, policy, or runtime files are changed.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this is an internal backlog lifecycle batch.

**Reason:** this batch only updates internal backlog lifecycle records and GitHub issue ownership; it
does not change a user-facing execution path.
