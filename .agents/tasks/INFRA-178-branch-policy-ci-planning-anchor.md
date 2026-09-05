---
title: 'INFRA-178: preserve a planning checkpoint for the branch-policy CI change'
status: in-progress
created: 2026-09-06
priority: medium
urgency: soon
area: repository workflow enforcement
depends_on: []
no-issue: repository-local planning checkpoint for an explicitly maintainer-requested policy change
---

# INFRA-178: Preserve a planning checkpoint for the branch-policy CI change

## Objective

Record the maintainer-authorized branch-policy alignment and its CI acceptance path.

## Plan

- [ ] Keep branch-policy documentation and local guards aligned.
- [ ] Confirm the repository CI scan accepts the resulting policy.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is a repository-maintainer workflow change with no end-user runtime surface, CLI
interaction, SDK contract, or product-facing behavior to execute.

## Test Plan

Run the repository harness scan and the focused branch-guard assertions after the policy files are
updated; use the pull-request CI checks as the final integrated acceptance signal.
