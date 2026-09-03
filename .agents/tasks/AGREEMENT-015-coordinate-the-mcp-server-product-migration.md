---
title: 'AGREEMENT-015: coordinate the MCP server product migration'
issue: https://github.com/woojubb/robota/issues/1986
status: in-progress
created: 2026-09-03
priority: high
urgency: soon
area: session tool export, stdio server ownership, and bidirectional MCP integration
depends_on: [RULE-023]
children: [MCP-006, MCP-007, MCP-008]
---

# AGREEMENT-015: coordinate the MCP server product migration

## Objective

Coordinate session tool export, stdio server ownership, and bidirectional MCP integration as one exact Issue-to-Task migration graph rooted in [issue #1986](https://github.com/woojubb/robota/issues/1986). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [ ] MCP-006 — todo — `.agents/tasks/MCP-006-export-canonical-session-runtime-tools-through-mcp.md`
- [ ] MCP-007 — todo — `.agents/tasks/MCP-007-ship-robota-mcp-serve-as-a-carrier-owning-stdio-product-mode.md`
- [ ] MCP-008 — todo — `.agents/tasks/MCP-008-prove-an-mcp-served-session-can-also-consume-mcp-tools.md`

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
