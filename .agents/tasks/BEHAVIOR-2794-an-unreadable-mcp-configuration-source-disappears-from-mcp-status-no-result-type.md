---
title: 'BEHAVIOR-2794: An unreadable MCP configuration source disappears from `/mcp status`: no result type can carry a source-level problem'
issue: https://github.com/woojubb/robota/issues/2794
status: todo
created: 2026-09-21
priority: medium
urgency: soon
area: packages/agent-mcp
depends_on: []
---

# BEHAVIOR-2794: An unreadable MCP configuration source disappears from `/mcp status`: no result type can carry a source-level problem

## Objective

A problem that belongs to a whole SOURCE has no server name, and `IMCPResolvedEntry[]` — the
pipeline's only output type — is keyed by server name. `resolveByPrecedence` is the one function
that sees both and narrows it away, so every management surface built on it is structurally unable
to report an unreadable source. An entirely unreadable managed policy yields
`statusOf → {total: 0, unresolved: 0}` and says nothing.

The reported `continue` in `precedence.ts` is CORRECT; fixing it there would leave the cause.

## Plan

- [ ] Give `resolveByPrecedence` a source-level channel (`{ entries, sourceProblems }`)
- [ ] Carry it through `IMCPListResult` and `IMCPStatusResult`
- [ ] Render it wherever `/mcp status` is surfaced, so an unreadable source is visible beside the servers that resolved
- [ ] Remove the containment note from `precedence.ts`

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Pending design. This Task records a cause found during the MCP-001 review and filed under finding-depth.md; its user-execution disposition is decided when the change is planned, not when the cause is recorded.
