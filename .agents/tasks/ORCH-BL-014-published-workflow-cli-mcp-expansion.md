---
title: ORCH-BL-014 Published Workflow CLI/MCP Expansion
status: backlog
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-cli
  - dag-mcp-server
  - dag-orchestration-client
---

# ORCH-BL-014 Published Workflow CLI/MCP Expansion

## Objective

Expose published workflow run start operations through `dag-cli` and `dag-mcp-server` after the
shared published workflow HTTP contracts are available in `@robota-sdk/dag-orchestration-client`.

## Recommended Direction

Keep CLI and MCP surfaces thin. Both packages should call
`DagOrchestrationHttpClient.startPublishedWorkflowRun()` and pass through server envelopes without
duplicating published workflow route validation.

## Plan

- [ ] Add a JSON-first `dag-cli` command for starting a published workflow run.
- [ ] Add an MCP tool definition and handler for starting a published workflow run.
- [ ] Reuse `IDagOrchestrationPublishedWorkflowRunRequest` for request parsing boundaries.
- [ ] Update package SPEC files with the new command/tool surface.

## Acceptance Criteria

- [ ] CLI published workflow command calls `DagOrchestrationHttpClient` only.
- [ ] MCP published workflow tool calls `DagOrchestrationHttpClient` only.
- [ ] Neither package imports server route modules or route-local types.
- [ ] Command/tool tests cover version query, overrides, and envelope pass-through.

## Test Plan

- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm harness:scan:deps`
