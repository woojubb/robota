---
title: 'RULE-021: close-parent-on-decomposition'
status: superseded
created: 2026-08-29
completed: 2026-08-30
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# RULE-021: close-parent-on-decomposition

## Objective

Ensure that when a GitHub issue is decomposed into child issues, the parent is linked to every child
and closed immediately, preventing repeated decomposition of an open parent.

no-issue: this governance change was delivered by PR #2493 at merge commit
`cbe0ec14992fd7390da9e7bd5279e112883b42c3`. Its source citation to Issue #2490 was unrelated and is
removed. RULE-023 supersedes the delivered policy while preserving this historical record.

## Plan

- [x] Update backlog execution rule and issue-to-backlog skill.
- [x] Require child-link read-back and a decomposition closure comment.
- [x] Verify repository scans and publish through PR #2493.

## User Execution Test Scenarios

Not applicable — this is a GitHub workflow rule with no user-facing runtime surface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Not applicable — RULE-021 changed repository governance only and exposed no runnable product
behavior, public API, or end-user interaction.
