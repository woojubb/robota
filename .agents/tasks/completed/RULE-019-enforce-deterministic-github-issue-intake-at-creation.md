---
title: 'RULE-019: Enforce deterministic GitHub Issue intake at creation'
issue: https://github.com/woojubb/robota/issues/2476
status: done
created: 2026-08-29
completed: 2026-08-29
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

- [x] Disable blank Issue creation and keep the three Issue Forms as the mechanical entry point.
- [x] Align `github-issue-triage` and `find-to-issue` instructions for manual/API and agent-created Issues.
- [x] Run the registry scan, affected harness scans, and the read-only Issue audit.

## User Execution Test Scenarios

Not applicable — this change alters Issue creation configuration and agent instructions; it adds no
new product, CLI, TUI, API, or other user-executable runtime path. The Issue Form chooser is verified
by the configuration/registry checks in the engineering Test Plan.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

## Result

Blank Issues are disabled; the three Issue Forms remain the only chooser paths and apply exactly one
work-kind label plus `status:needs-triage`. The triage and find-to-issue skills now require the same
contract for manual/API and agent-created Issues, forbid P labels at filing time, and require an audit.
Registry scan, affected harness scans, live audit (`malformed: 0`), and the focused registry test passed.
