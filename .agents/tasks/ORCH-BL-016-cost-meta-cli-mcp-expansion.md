---
title: ORCH-BL-016 Cost Meta CLI MCP Expansion
status: backlog
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-cli
  - dag-mcp-server
  - dag-orchestration-client
---

# ORCH-BL-016 Cost Meta CLI MCP Expansion

## Objective

Expose cost metadata operations through `dag-cli` and `dag-mcp-server` using only the package-owned
contracts and methods from `@robota-sdk/dag-orchestration-client`.

## Recommended Direction

Keep both product shells thin. They should call `DagOrchestrationHttpClient` methods for list,
get, create, update, delete, validate, and preview operations, then own only argument parsing and
JSON/MCP result formatting. They must not import route-local server files or duplicate HTTP path
construction.

## Plan

- [ ] Inventory existing DAG CLI command structure and MCP tool definition patterns.
- [ ] Add CLI subcommands for cost metadata CRUD, formula validation, and preview.
- [ ] Add MCP tools for the same operational surface.
- [ ] Add tests that assert delegation to `IDagOrchestrationHttpClient` methods.
- [ ] Update package SPEC files for the new CLI/MCP surface.

## Acceptance Criteria

- [ ] CLI and MCP cost metadata operations use `dag-orchestration-client` methods only.
- [ ] No route-local cost metadata request/response shapes are imported outside the server.
- [ ] JSON output keeps the server envelope intact unless a product shell explicitly formats it.
- [ ] Tests cover required argument validation before calling the server.

## Test Plan

- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`
