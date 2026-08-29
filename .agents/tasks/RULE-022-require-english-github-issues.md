---
title: 'RULE-022: require-english-github-issues'
status: todo
created: 2026-08-29
priority: medium
urgency: soon
area: TODO
depends_on: []
issue: https://github.com/woojubb/robota/issues/2537
---

# RULE-022: require-english-github-issues

## Objective

Require English GitHub issue titles and bodies by default so triage, search, and automation use one
consistent language.

## Plan

- [ ] Update the naming rule and issue-triage skill.
- [ ] Run `pnpm harness:scan` and merge the PR to develop.

## Test Plan

Run the repository harness scan and verify the exact PR HEAD is green before merging. Confirm the
English policy appears in both owning documents and no unrelated package scope is introduced.

## User Execution Test Scenarios

Not applicable — this is repository documentation guidance with no product-facing runtime surface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: no user-facing runtime behavior changes; the outcome is verified by repository scans.
