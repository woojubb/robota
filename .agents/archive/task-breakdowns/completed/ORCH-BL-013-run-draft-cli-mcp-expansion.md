---
title: ORCH-BL-013 Run Draft CLI/MCP Expansion
status: completed
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

- [x] Add JSON-first `dag-cli` subcommands for run draft create/get/replace/reset/overwrite.
- [x] Add MCP tool definitions and handlers for the same run draft operations.
- [x] Reuse `DagOrchestrationHttpClient` methods and shared response payload contracts.
- [x] Update package SPEC files with the new command/tool surface.

## Progress

### 2026-05-05

- Started implementation on `feat/run-draft-cli-mcp-expansion`.
- Added `dag-cli run-drafts` dispatch through `DagOrchestrationHttpClient`.
- Added MCP run draft tool definitions and handlers through `IDagOrchestrationHttpClient`.
- Updated `dag-cli` and `dag-mcp-server` SPEC command/tool inventories.
- Verified the affected CLI/MCP packages and repository harness checks.

## Decisions

- Use `run-drafts` as the CLI command group to mirror the server route segment.
- Use `--json <json|@file>` for create, replace, and overwrite so the CLI stays payload-shape agnostic and JSON-first.
- Use `dag_run_drafts_*` MCP tool names to keep operation grouping explicit.

## Acceptance Criteria

- [x] CLI run draft commands call `DagOrchestrationHttpClient` only.
- [x] MCP run draft tools call `DagOrchestrationHttpClient` only.
- [x] Neither package imports server route modules or route-local types.
- [x] Command/tool tests cover request routing and envelope pass-through.

## Test Plan

- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm harness:scan:deps`

## Result

Added JSON-first `dag-cli run-drafts` commands and matching `dag_run_drafts_*` MCP tools for create,
get, replace, reset, and overwrite operations. Both surfaces route through
`@robota-sdk/dag-orchestration-client` and reuse shared run draft payload contracts without importing
server route modules.
