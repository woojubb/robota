---
title: ORCH-BL-009 Published Workflow Operational Client Contracts
status: completed
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-core
  - dag-orchestration-client
  - dag-orchestrator-server
  - dag-cli
  - dag-mcp-server
---

# ORCH-BL-009 Published Workflow Operational Client Contracts

## Objective

Package the `/v1/dag/workflows/:dagId/runs` request and response contract before exposing published
workflow run commands or MCP tools.

## Recommended Direction

Keep persisted definition ownership in `@robota-sdk/dag-core`. Move workflow-run request body,
override map, and accepted-run response aliases into `@robota-sdk/dag-orchestration-client`; keep
route-only lookup and asset synchronization logic in `dag-orchestrator-server`.

## Plan

- [x] Extract published workflow run request body and response aliases.
- [x] Add a client method for starting a published workflow run.
- [x] Update server route utilities to consume the package-owned aliases.
- [x] Decide CLI/MCP command names only after the HTTP contract lands.

## Acceptance Criteria

- [x] Published workflow run HTTP aliases are exported from `@robota-sdk/dag-orchestration-client`.
- [x] Override validation remains server-side but uses the shared request shape.
- [x] CLI/MCP expansion is blocked until endpoint tests pass.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm harness:scan:deps`
- `pnpm docs:build`

## Progress

### 2026-05-05

- Started from `develop` on branch `feat/published-workflow-operational-contracts`.
- Selected `dag-orchestration-client` as the HTTP contract owner while leaving persisted definition ownership in `dag-core`.
- Added `orchestration-http-contracts.ts` so shared HTTP aliases stay separate from concrete request execution and below the file-size threshold.
- Exported published workflow run aliases and `DagOrchestrationHttpClient.startPublishedWorkflowRun()`.
- Updated published workflow server routes and tests to consume the shared aliases while keeping validation and definition lookup server-local.
- Updated the `dag-mcp-server` test fake client so MCP typechecks continue to validate the full shared HTTP client interface.
- Added follow-up `ORCH-BL-014` for CLI/MCP command and tool expansion.

## Decisions

- `dag-core` remains the SSOT for persisted `IDagDefinition` state.
- `dag-orchestration-client` owns the published workflow run request, override map, accepted-run success payload, and client method.
- CLI/MCP command/tool names are deferred to a follow-up task after this HTTP contract is verified.

## Result

Published workflow run HTTP contracts are now package-owned by `@robota-sdk/dag-orchestration-client`.
The server imports the shared request/override/success aliases, while server-only validation,
definition lookup, override application, asset synchronization, and runtime execution remain in
`dag-orchestrator-server`. CLI/MCP expansion is tracked separately in `ORCH-BL-014`.

## Verification

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestration-client typecheck`
- `pnpm --filter @robota-sdk/dag-orchestration-client lint`
- `pnpm --filter @robota-sdk/dag-orchestration-client build`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server typecheck`
- `pnpm --filter @robota-sdk/dag-orchestrator-server lint` (existing 28 warnings, 0 errors)
- `pnpm --filter @robota-sdk/dag-orchestrator-server build`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm harness:scan:deps`
- `pnpm docs:build`
- `pnpm harness:scan` (existing file-size baseline only)
- `git diff --check`
