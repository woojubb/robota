---
title: ORCH-BL-010 Asset Operational Client Contracts
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

# ORCH-BL-010 Asset Operational Client Contracts

## Objective

Package asset upload and metadata HTTP contracts before adding asset commands/tools.

## Recommended Direction

Keep storage and persisted metadata ownership in `@robota-sdk/dag-core`. Add operational HTTP aliases
for base64 upload, asset metadata response, and content download metadata in
`@robota-sdk/dag-orchestration-client`. Keep binary streaming behavior transport-specific.

Recommended implementation detail: expose upload and metadata fetch as JSON `DagOrchestrationHttpClient`
methods, and expose content download as an encoded URL helper plus documented response headers. Do
not make the JSON HTTP client buffer binary content.

## Plan

- [x] Extract base64 asset upload request and metadata response aliases.
- [x] Add client methods for upload and metadata fetch.
- [x] Document content download as a streaming endpoint with metadata helpers.
- [x] Update server route tests for success and validation/error envelopes.

## Acceptance Criteria

- [x] Asset upload/metadata aliases are package-owned.
- [x] Binary content handling is documented as transport-specific, not JSON-only.
- [x] CLI/MCP asset expansion waits for server contract tests.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm harness:scan:deps`
- `pnpm docs:build`

## Progress

### 2026-05-05

- Started from `develop` on branch `feat/asset-operational-client-contracts`.
- Chose `dag-orchestration-client` for JSON HTTP aliases and `dag-core` for persisted asset metadata/storage ports.
- Added shared asset upload, asset reference, success payload, and content download info aliases.
- Added `DagOrchestrationHttpClient.uploadAsset()`, `getAssetMetadata()`, and `getAssetContentDownloadInfo()`.
- Updated server asset routes to consume shared aliases and split the route file enough to remove its max-lines lint warnings.
- Added asset route contract tests for upload validation, metadata envelope, and binary content headers.
- Added follow-up `ORCH-BL-015` for CLI/MCP asset operations.

## Decisions

- Binary content download remains transport-specific; the shared JSON client will provide an encoded content URL helper instead of reading binary streams.

## Result

Asset upload and metadata HTTP contracts are now owned by `@robota-sdk/dag-orchestration-client`.
`dag-orchestrator-server` still owns storage/runtime upload behavior, while binary content download
is represented as a content URL and response-header metadata for transport-specific consumers.
CLI/MCP expansion is tracked separately in `ORCH-BL-015`.

## Verification

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestration-client typecheck`
- `pnpm --filter @robota-sdk/dag-orchestration-client lint`
- `pnpm --filter @robota-sdk/dag-orchestration-client build`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server typecheck`
- `pnpm --filter @robota-sdk/dag-orchestrator-server lint` (existing warnings reduced from 28 to 25, 0 errors)
- `pnpm --filter @robota-sdk/dag-orchestrator-server build`
- `pnpm --filter @robota-sdk/dag-cli typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server typecheck`
- `pnpm --filter @robota-sdk/dag-mcp-server test`
- `pnpm harness:scan:deps`
- `pnpm docs:build`
- `pnpm harness:scan` (existing file-size baseline only)
- `git diff --check`
