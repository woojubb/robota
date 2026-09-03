---
title: 'CMD-014: coordinate command features as owner-aligned vertical slices'
issue: https://github.com/woojubb/robota/issues/2072
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: command feature architecture
depends_on: [CMD-010, CMD-011]
---

# CMD-014: coordinate command features as owner-aligned vertical slices

## Objective

Implement [issue #2072](https://github.com/woojubb/robota/issues/2072) by moving command semantics out of the agent-framework umbrella into owner-aligned vertical slices, coordinated through CMD-015 to CMD-019.

## Plan

- [ ] Freeze the command-to-owner matrix and shared shell boundary.
- [ ] Sequence CMD-015 through CMD-019 without duplicating registries or policy.
- [ ] Remove framework ownership only after every command has one tested destination.
- [ ] Verify package boundaries, command discovery, help, and execution end to end.

## User Execution Test Scenarios

Run the complete command inventory before and after migration. Expected: every command remains discoverable and executable with identical user-visible identity while ownership moves to its slice. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
