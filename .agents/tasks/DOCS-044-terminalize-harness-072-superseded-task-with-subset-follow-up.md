---
title: 'DOCS-044: Terminalize HARNESS-072 superseded task with subset follow-up'
issue: https://github.com/woojubb/robota/issues/2404
status: todo
created: 2026-08-29
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# DOCS-044: Terminalize HARNESS-072 superseded task with subset follow-up

## Objective

Archive HARNESS-072 after extracting its unresolved subset 3 into canonical issue #2485.

## Plan

- [ ] Mark HARNESS-072 skipped with the exact issue-comment handoff.
- [ ] Move the record to completed archive and record the resolution.
- [ ] Run lifecycle, citation, and CI-like verification scans.

## Test Plan

Run `pnpm harness:scan` and `pnpm harness:verify-like-ci`; inspect the archived Task and issue comment.
No package source, API, policy, or runtime behavior changes.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: not applicable because this batch only archives a stale backlog record and records a GitHub
issue handoff; it changes no user-facing execution path.
