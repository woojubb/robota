---
title: 'CLI-058: agent-tool-mcp protocol and connection layers are stubs — tool always fails'
status: todo
created: 2026-06-10
priority: critical
urgency: soon
area: packages/agent-tool-mcp
depends_on: []
---

# CLI-058: agent-tool-mcp protocol/connection stubs

## Problem

The MCP tool package is non-functional end to end:

1. `executeMCPRequest()` (`packages/agent-tool-mcp/src/mcp-protocol.ts:100-102`) is a stub:
   `// TODO: Implement actual MCP protocol communication` followed by
   `throw new Error('Not implemented: actual MCP execution is not yet available')`.
2. `ensureConnection()` (`packages/agent-tool-mcp/src/mcp-tool.ts:166`) fakes connection with a
   100ms `setTimeout`, then reports "connected"; `disconnect()` (mcp-tool.ts:196) is an empty
   TODO. The error branch setting status `'error'` is unreachable.
3. `IMCPConfig.timeout/retries/headers/apiKey` are accepted but never used.
4. The always-failing protocol error is wrapped by `processMCPResponse()` so
   `MCPTool.execute()` returns a "successful" envelope containing error data, masking the
   failure from callers.
5. The package SPEC itself records zero test coverage
   (`packages/agent-tool-mcp/docs/SPEC.md:70-74`).

Every runtime invocation of an MCP tool fails. The package is published surface
(`@robota-sdk/agent-tool-mcp`) advertising MCP support the product does not have.

## Expected Behavior

Spec-first decision: either implement real MCP client communication (stdio/HTTP transport,
JSON-RPC, connection lifecycle, timeout/retries/headers honored, failures surfaced as tool
errors), or withdraw the package from the public surface until it exists (no deprecated
half-state, per project rules). Tests covering connection state machine, protocol helpers, and
execute paths are required either way.

## Test Plan

- Unit tests: validateParameters, buildMCPRequest, processMCPResponse, connection state
  machine, execute success/failure propagation.
- Integration test against a local mock MCP server (fixture to be built by this work).
- `pnpm --filter @robota-sdk/agent-tool-mcp build && pnpm --filter @robota-sdk/agent-tool-mcp test`

## User Execution Test Scenarios

- Prerequisite: a local mock/example MCP server (this work must build the fixture — it does not
  exist yet); CLI or SDK example wiring an MCPTool instance.
- Steps: run the SDK example (`node examples/mcp-tool-example.js` or equivalent added by this
  work) that registers an MCP tool against the local server and invokes it once.
- Expected observable result: the tool call round-trips to the MCP server and returns real
  result data (not "Not implemented"); killing the server makes the next call fail with a clear
  connection error.
- Cleanup: stop the local server.
- Evidence: (fill after implementation — example output for success and failure cases)
