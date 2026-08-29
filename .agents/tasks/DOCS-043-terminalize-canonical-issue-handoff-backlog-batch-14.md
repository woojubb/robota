---
title: 'DOCS-043: Terminalize canonical issue handoff backlog batch 14'
issue: https://github.com/woojubb/robota/issues/2404
status: in-progress
created: 2026-08-29
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# DOCS-043: Terminalize canonical issue handoff backlog batch 14

## Objective

Archive RULE-015 and CLI-083 after explicit handoff to canonical open GitHub issues, preserving
evidence and ensuring no duplicate actionable root records remain.

## Plan

- [ ] Mark both Tasks skipped with exact returned-to-issue links.
- [ ] Move both records to completed archive and record resolutions.
- [ ] Run lifecycle, citation, and CI-like verification scans.

## Test Plan

Run `pnpm harness:scan` and `pnpm harness:verify-like-ci`; inspect archived Task metadata and issue
comment links. This document-only batch changes no package source, API, policy, or runtime behavior.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: not applicable because this batch only archives backlog records and records GitHub issue
handoffs; it changes no user-facing execution path.
