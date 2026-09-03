---
title: 'AGREEMENT-014: coordinate the MCP client control-plane migration'
issue: https://github.com/woojubb/robota/issues/1985
status: in-progress
created: 2026-09-03
priority: high
urgency: soon
area: typed MCP configuration, client transport, supervision, background calls, and schema projection
depends_on: [RULE-023]
children: [MCP-001, MCP-002, MCP-003, MCP-004, MCP-005]
---

# AGREEMENT-014: coordinate the MCP client control-plane migration

## Objective

Coordinate typed MCP configuration, client transport, supervision, background calls, and schema projection as one exact Issue-to-Task migration graph rooted in [issue #1985](https://github.com/woojubb/robota/issues/1985). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [ ] MCP-001 — todo — `.agents/tasks/MCP-001-add-a-typed-mcp-configuration-and-management-control-plane.md`
- [ ] MCP-002 — todo — `.agents/tasks/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`
- [ ] MCP-003 — todo — `.agents/tasks/MCP-003-add-an-mcp-connection-and-capability-catalog-supervisor.md`
- [ ] MCP-004 — todo — `.agents/tasks/MCP-004-hand-long-running-mcp-calls-to-background-tasks.md`
- [ ] MCP-005 — todo — `.agents/tasks/MCP-005-project-mcp-tool-schemas-safely-across-providers.md`

## Plan

- [ ] TC-01 — Land every declared child Task atomically with exact source Issue identity.
- [ ] TC-02 — Preserve native dependency order and every external prerequisite.
- [ ] TC-03 — Freeze exact row-level marker, label, body, and terminal-state mutations before apply.
- [ ] TC-04 — Apply the homogeneous rows in one batch and preserve all Issue history and relationships.
- [ ] TC-05 — Reconcile the whole group once after writes and keep product Tasks open until implementation.

## Test Plan

- Validate the complete parent/child projection and exact source Issue URL for every Task.
- Compare frozen and post-write marker, label, state, body-prefix, hierarchy, dependency, and assignee fields once for the whole group.
- Run affected repository scans after the complete group evidence update.

- Execute the administrative migration as one bounded batch and reconcile it once after all authorized writes.

## User Execution Test Scenarios

Not applicable — this AGREEMENT changes planning and GitHub ownership only. Each child Task owns the runnable implementation scenario.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No runtime, public API, CLI, TUI, or end-user interaction changes in this coordination record.
