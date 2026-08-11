---
title: ORCH-BL-015 Asset CLI/MCP Expansion
status: completed
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

- [x] Add JSON-first `dag-cli` commands for asset upload and metadata lookup.
- [x] Add a `dag-cli` content download command that streams bytes to an explicit output target.
- [x] Add MCP tool definitions and handlers for upload and metadata lookup.
- [x] Decide whether MCP content download should return a URL helper only or support resource-style binary access.
- [x] Update package SPEC files with the new command/tool surface.

## Progress

### 2026-05-05

- Started implementation on `feat/asset-cli-mcp-expansion`.
- Chose `assets upload`, `assets get`, and `assets download` for the CLI surface.
- Chose MCP upload, metadata, and content-info tools; binary content remains outside MCP tool
  payloads.
- Verified CLI/MCP package test, lint, typecheck, and build commands.

## Decisions

- CLI binary download uses `getAssetContentDownloadInfo()` plus a separate fetch/write stream path,
  not the JSON client request path.
- MCP content access returns download metadata only; direct binary resource serving needs a separate
  MCP resource design.

## Acceptance Criteria

- [x] CLI asset upload and metadata commands call `DagOrchestrationHttpClient` only.
- [x] MCP asset tools call `DagOrchestrationHttpClient` only.
- [x] Binary content handling does not buffer large files through the JSON client.
- [x] Command/tool tests cover upload body routing, metadata envelope pass-through, and content URL encoding.

## Test Plan

- `pnpm --filter @robota-sdk/dag-cli test`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm harness:scan:deps`

## Result

Added `dag-cli assets` upload/get/download commands and MCP asset upload, metadata, and content-info
tools. JSON operations route through `DagOrchestrationHttpClient`; CLI content download uses
`getAssetContentDownloadInfo()` plus a separate binary stream writer, and MCP returns content
download metadata instead of binary payloads.
