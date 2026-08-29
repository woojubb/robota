---
title: 'RULE-021: close-parent-on-decomposition'
status: todo
created: 2026-08-29
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# RULE-021: close-parent-on-decomposition

## Objective

Ensure that when a GitHub issue is decomposed into child issues, the parent is linked to every child
and closed immediately, preventing repeated decomposition of an open parent.

## Plan

- [x] Update backlog execution rule and issue-to-backlog skill.
- [x] Require child-link read-back and a decomposition closure comment.
- [ ] Verify repository scans and publish through a PR.

## User Execution Test Scenarios

Not applicable — this is a GitHub workflow rule with no user-facing runtime surface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
