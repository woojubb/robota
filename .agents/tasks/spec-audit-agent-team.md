---
title: 'Spec Audit: agent-team'
status: backlog
priority: low
created: 2026-03-20
packages:
  - agent-team
---

# Spec Audit: agent-team

## Goal

agent-team SPEC.md has function signature errors and incorrect dependency attributions.

## Issues Found (5)

### MEDIUM (4)

1. **createAssignTaskRelayTool signature wrong**: SPEC shows 1 param, actual takes 2 (eventService, aiProviders).
2. **TemplateEntry type name/kind wrong**: SPEC says `TemplateEntry` (type alias). Actual: `ITemplateEntry` (interface).
3. **FunctionTool/RelayMcpTool source packages wrong**: SPEC says agent-core. Actual: FunctionTool from agent-tools, RelayMcpTool from agent-tool-mcp.
4. **agent-event-service dependency undocumented**: `bindWithOwnerPath` imported but package not mentioned in SPEC.

### LOW (1)

5. Test Strategy says "No test files exist" but `relay-assign-task.test.ts` exists (182 lines).
