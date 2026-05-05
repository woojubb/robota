---
title: ORCH-BL-013 Run Draft CLI/MCP Expansion
status: backlog
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-cli
  - dag-mcp-server
  - dag-orchestration-client
---

# ORCH-BL-013 Run Draft CLI/MCP Expansion

## Objective

Expose run draft create/get/replace/reset/overwrite operations through `dag-cli` and
`dag-mcp-server` after the shared run draft HTTP contracts are available in
`@robota-sdk/dag-orchestration-client`.

## Recommended Direction

Keep command/tool implementations thin. Both CLI and MCP should call `DagOrchestrationHttpClient`
methods and format existing response envelopes without importing `dag-orchestrator-server` route
internals.

## Plan

- [ ] Add JSON-first `dag-cli` subcommands for run draft create/get/replace/reset/overwrite.
- [ ] Add MCP tool definitions and handlers for the same run draft operations.
- [ ] Reuse `DagOrchestrationHttpClient` methods and shared response payload contracts.
- [ ] Update package SPEC files with the new command/tool surface.

## Acceptance Criteria

- [ ] CLI run draft commands call `DagOrchestrationHttpClient` only.
- [ ] MCP run draft tools call `DagOrchestrationHttpClient` only.
- [ ] Neither package imports server route modules or route-local types.
- [ ] Command/tool tests cover request routing and envelope pass-through.

## Test Plan

- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm harness:scan:deps`
