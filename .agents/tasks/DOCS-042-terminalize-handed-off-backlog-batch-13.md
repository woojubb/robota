---
title: 'DOCS-042: Terminalize handed-off backlog batch 13'
status: in-progress
created: 2026-08-29
priority: medium
urgency: soon
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-042: Terminalize handed-off backlog batch 13

## Objective

Archive three root Tasks that now have canonical GitHub issue handoffs, preserving evidence and
preventing duplicate actionable backlog entries.

## Plan

- [ ] Mark REL-024, TRANS-002, and TRANS-010 skipped with exact returned-to-issue links.
- [ ] Move the three records to completed archive and record resolutions.
- [ ] Run lifecycle, citation, and CI-like verification scans.

## Test Plan

Run `pnpm harness:scan` and `pnpm harness:verify-like-ci`; inspect all three archived records and
their GitHub issue-comment links.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

No user-facing runtime behavior is changed.

Reason: not applicable because this batch only archives backlog records and records GitHub issue
handoffs; it changes no runtime surface, package source, API contract, or user-facing execution path.
