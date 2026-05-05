---
title: ORCH-BL-016 Cost Meta CLI MCP Expansion
status: completed
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

- [x] Inventory existing DAG CLI command structure and MCP tool definition patterns.
- [x] Add CLI subcommands for cost metadata CRUD, formula validation, and preview.
- [x] Add MCP tools for the same operational surface.
- [x] Add tests that assert delegation to `IDagOrchestrationHttpClient` methods.
- [x] Update package SPEC files for the new CLI/MCP surface.

## Progress

### 2026-05-05

- Started on `feat/cost-meta-cli-mcp-expansion`.
- Confirmed cost metadata contracts and `IDagOrchestrationHttpClient` methods already exist in
  `@robota-sdk/dag-orchestration-client`.
- Recommended CLI command group `cost-meta` and MCP tool names `dag_cost_meta_*`; product shells
  will only parse arguments and delegate to the shared client.
- Added and verified CLI/MCP cost metadata command/tool surfaces.
- Updated `dag-cli` and `dag-mcp-server` SPEC files plus the central architecture map without
  adding companion architecture documents.

## Decisions

- Keep architecture documentation centralized in `.agents/specs/ARCHITECTURE-MAP.md`; do not add
  extra architecture files for this slice.
- Extract reusable MCP tool runtime helpers because `dag-mcp-tools.ts` is already at the 300-line
  production-file limit and adding cost-meta handlers inline would violate the repository rule.

## Blockers

- None.

## Result

Completed. `dag-cli` now exposes `cost-meta` CRUD, validation, and preview commands through
`DagOrchestrationHttpClient`. `dag-mcp-server` now exposes matching `dag_cost_meta_*` tools. Tests
cover success routing and missing-argument validation before server calls. The MCP tool runtime
helpers were extracted to keep production files under the 300-line limit.

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
