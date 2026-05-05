---
title: ORCH-BL-009 Published Workflow Operational Client Contracts
status: backlog
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

- [ ] Extract published workflow run request body and response aliases.
- [ ] Add a client method for starting a published workflow run.
- [ ] Update server route utilities to consume the package-owned aliases.
- [ ] Decide CLI/MCP command names only after the HTTP contract lands.

## Acceptance Criteria

- [ ] Published workflow run HTTP aliases are exported from `@robota-sdk/dag-orchestration-client`.
- [ ] Override validation remains server-side but uses the shared request shape.
- [ ] CLI/MCP expansion is blocked until endpoint tests pass.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm harness:scan:deps`
- `pnpm docs:build`
