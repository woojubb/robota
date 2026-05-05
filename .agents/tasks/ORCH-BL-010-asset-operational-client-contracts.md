---
title: ORCH-BL-010 Asset Operational Client Contracts
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

# ORCH-BL-010 Asset Operational Client Contracts

## Objective

Package asset upload and metadata HTTP contracts before adding asset commands/tools.

## Recommended Direction

Keep storage and persisted metadata ownership in `@robota-sdk/dag-core`. Add operational HTTP aliases
for base64 upload, asset metadata response, and content download metadata in
`@robota-sdk/dag-orchestration-client`. Keep binary streaming behavior transport-specific.

## Plan

- [ ] Extract base64 asset upload request and metadata response aliases.
- [ ] Add client methods for upload and metadata fetch.
- [ ] Document content download as a streaming endpoint with metadata helpers.
- [ ] Update server route tests for success and validation/error envelopes.

## Acceptance Criteria

- [ ] Asset upload/metadata aliases are package-owned.
- [ ] Binary content handling is documented as transport-specific, not JSON-only.
- [ ] CLI/MCP asset expansion waits for server contract tests.

## Test Plan

- `pnpm --filter @robota-sdk/dag-orchestration-client test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm harness:scan:deps`
- `pnpm docs:build`
