---
title: 'ARCH-FIX-027: Fix agent-transport-http/mcp to import from agent-interface-transport'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-transport-http, packages/agent-transport-mcp
---

## Problem

`agent-transport-http` and `agent-transport-mcp` import `ITransportAdapter` from
`@robota-sdk/agent-sdk` and list `agent-sdk` as a production dependency. This unnecessarily
couples transports to the full assembly layer.

`agent-transport-tui` and `agent-transport-headless` correctly depend on
`@robota-sdk/agent-interface-transport`. HTTP and MCP transports should follow the same pattern.

**Evidence**:

- `agent-transport-http/src/http-transport.ts` line 8: imports from `@robota-sdk/agent-sdk`
- `agent-transport-mcp/src/mcp-transport.ts` line 8: same pattern

**Source**: ARCH-SA-004 (System Architect review 2026-05-15)

## Scope

1. Add `@robota-sdk/agent-interface-transport` as a direct dependency to
   `agent-transport-http/package.json` and `agent-transport-mcp/package.json`
2. Update import in `http-transport.ts` — source `ITransportAdapter` from
   `@robota-sdk/agent-interface-transport`
3. Update import in `mcp-transport.ts` — same redirect
4. Remove `@robota-sdk/agent-sdk` from production dependencies of both packages if no other usage
5. Add harness check: `agent-transport-*` packages must not import transport interface types from
   `@robota-sdk/agent-sdk`

## Test Plan

- `pnpm --filter @robota-sdk/agent-transport-http build` passes
- `pnpm --filter @robota-sdk/agent-transport-mcp build` passes
- `pnpm typecheck` clean
- `pnpm test` passes
- `agent-sdk` absent from production deps of both transport packages

## User Execution Test Scenarios

**Scenario**: HTTP transport still registers and handles requests after dependency fix

Prerequisites: Full build passing. `agent-server` using HTTP transport.

Steps:

1. Start `apps/agent-server` locally
2. Send an HTTP request to a transport-backed endpoint
3. Observe that the request is handled correctly

Expected: No transport registration errors. HTTP and MCP transports function identically to before.

Evidence: (to be filled after implementation)
