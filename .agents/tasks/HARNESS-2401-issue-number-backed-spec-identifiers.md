---
title: 'HARNESS-2401: use GitHub issue numbers for new spec identifiers'
issue: https://github.com/woojubb/robota/issues/2401
status: todo
created: 2026-09-06
priority: medium
urgency: soon
area: scripts/harness, .agents/tasks, .agents/skills
depends_on: []
---

# HARNESS-2401: use GitHub issue numbers for new spec identifiers

## Objective

Make new spec/task identifiers derive their numeric component from the registering GitHub Issue.
Use an existing Issue number when supplied; otherwise create a correctly labeled GitHub Issue before
allocating the identifier. Preserve legacy identifiers so existing citations remain valid.

## Plan

- [x] Update the allocator and spec scaffolder contract to resolve or create the registering Issue and use its number as the new identifier.
- [x] Update the written workflow guidance and identifier parsers/tests for the issue-number-backed format while preserving legacy records.
- [x] Run focused tests and the affected harness scan, then record the merged delivery.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository authoring and harness behavior, not a runnable end-user Robota product surface.
