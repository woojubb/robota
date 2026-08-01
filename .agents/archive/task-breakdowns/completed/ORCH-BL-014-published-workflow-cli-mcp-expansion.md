---
title: ORCH-BL-014 Published Workflow CLI/MCP Expansion
status: completed
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

- [x] Add a JSON-first `dag-cli` command for starting a published workflow run.
- [x] Add an MCP tool definition and handler for starting a published workflow run.
- [x] Reuse `IDagOrchestrationPublishedWorkflowRunRequest` for request parsing boundaries.
- [x] Update package SPEC files with the new command/tool surface.

## Progress

### 2026-05-05

- Started implementation on `feat/published-workflow-cli-mcp-expansion`.
- Chose `workflows start <dagId> [--version <version>] [--json <json|@file>]` for the CLI surface.
- Chose `dag_workflows_start_run` for the MCP surface.
- Verified CLI/MCP package test, lint, typecheck, and build commands.

## Decisions

- Keep the request body JSON-first and optional so CLI/MCP do not duplicate route validation for
  `input` and `overrides`.
- Use the shared `DagOrchestrationHttpClient.startPublishedWorkflowRun()` method as the only
  operational call path.

## Acceptance Criteria

- [x] CLI published workflow command calls `DagOrchestrationHttpClient` only.
- [x] MCP published workflow tool calls `DagOrchestrationHttpClient` only.
- [x] Neither package imports server route modules or route-local types.
- [x] Command/tool tests cover version query, overrides, and envelope pass-through.

## Test Plan

- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm harness:scan:deps`

## Result

Added `dag-cli workflows start` and the `dag_workflows_start_run` MCP tool for starting published
workflow runs with optional version and JSON request body. Both surfaces call
`DagOrchestrationHttpClient.startPublishedWorkflowRun()` and pass through server response envelopes.
