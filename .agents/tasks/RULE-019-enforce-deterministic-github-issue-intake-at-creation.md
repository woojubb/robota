---
title: 'RULE-019: Enforce deterministic GitHub Issue intake at creation'
issue: https://github.com/woojubb/robota/issues/2476
status: todo
created: 2026-08-29
priority: medium
urgency: soon
area: RULE
depends_on: []
---

# RULE-019: Enforce deterministic GitHub Issue intake at creation

## Objective

Make every new GitHub Issue enter the same deterministic intake contract: one work-kind label,
`status:needs-triage`, no P label before triage, and enough evidence for a later human decision.

## Plan

- [ ] Disable blank Issue creation and keep the three Issue Forms as the mechanical entry point.
- [ ] Align `github-issue-triage` and `find-to-issue` instructions for manual/API and agent-created Issues.
- [ ] Run the registry scan, affected harness scans, and the read-only Issue audit.

## User Execution Test Scenarios

Not applicable — this change alters Issue creation configuration and agent instructions; it adds no
new product, CLI, TUI, API, or other user-executable runtime path. The Issue Form chooser is verified
by the configuration/registry checks in the engineering Test Plan.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`
