---
title: ORCH-BL-015 Asset CLI/MCP Expansion
status: backlog
priority: medium
urgency: next
created: 2026-05-05
packages:
  - dag-cli
  - dag-mcp-server
  - dag-orchestration-client
---

# ORCH-BL-015 Asset CLI/MCP Expansion

## Objective

Expose asset upload, metadata lookup, and content download operations through `dag-cli` and
`dag-mcp-server` after the shared asset HTTP contracts are available in
`@robota-sdk/dag-orchestration-client`.

## Recommended Direction

Keep command/tool implementations thin. Upload and metadata operations should call
`DagOrchestrationHttpClient` methods. Content download should use
`getAssetContentDownloadInfo()` and remain transport-specific so binary bytes are not forced through
the JSON client abstraction.

## Plan

- [ ] Add JSON-first `dag-cli` commands for asset upload and metadata lookup.
- [ ] Add a `dag-cli` content download command that streams bytes to an explicit output target.
- [ ] Add MCP tool definitions and handlers for upload and metadata lookup.
- [ ] Decide whether MCP content download should return a URL helper only or support resource-style binary access.
- [ ] Update package SPEC files with the new command/tool surface.

## Acceptance Criteria

- [ ] CLI asset upload and metadata commands call `DagOrchestrationHttpClient` only.
- [ ] MCP asset tools call `DagOrchestrationHttpClient` only.
- [ ] Binary content handling does not buffer large files through the JSON client.
- [ ] Command/tool tests cover upload body routing, metadata envelope pass-through, and content URL encoding.

## Test Plan

- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm harness:scan:deps`
