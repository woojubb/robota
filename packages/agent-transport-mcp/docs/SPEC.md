# agent-transport-mcp Specification

## Transport Admission (SEC-008)

transport-admission: none — the MCP server speaks over stdio to a client process the user launched, so the boundary is process spawn: a peer that can write to this stdin already runs as the user. What this package DOES enforce is what that peer may reach — SEC-008 admits only the canonical runtime catalog, where non-model-invocable commands are absent; all calls use the session permission wrapper without interactive approval prompts.

## Scope

Model Context Protocol (MCP) server transport for the Robota SDK. Split out of the consolidated
`agent-transport` package (DQ-AUDIT-005) so the `@modelcontextprotocol/sdk` dependency is an
isolated unit.

## Boundaries

- Owns the MCP server transport adapter and agent MCP server builder.
- Depends on `agent-interface-session` and `agent-interface-transport` contracts, not framework internals.
- No other transport package depends on this one.

## Architecture Overview

```
agent-transport-mcp
  ├── createMcpTransport    ← ITransportAdapter over the MCP server
  └── createAgentMcpServer  ← MCP server exposing an agent session
```

## Type Ownership

Owns `IMcpTransportOptions`, `IAgentMcpOptions`, and `IMcpTransportSession`. MCP consumes only the
turn-submission and runtime-tool roles. The public transport preserves its legacy
`ITransportAdapter<IInteractiveSession>` declaration and adds a narrow
`attach(IMcpTransportSession)` overload.

## Public API Surface

| Export                 | Kind      | Description                                            |
| ---------------------- | --------- | ------------------------------------------------------ |
| `createMcpTransport`   | function  | MCP server transport adapter                           |
| `createAgentMcpServer` | function  | Build an MCP server for an agent                       |
| `IMcpTransport`        | interface | Legacy adapter declaration plus narrow attach overload |
| `IMcpTransportSession` | interface | Exact submission + runtime-tool session roles          |

## Extension Points

New executable tools belong to the canonical session runtime catalog. Prompts and resources are explicitly unsupported in the minimum slice.

## Lifecycle Conformance (ARCH-011)

`createMcpTransport` is a frozen `service` lifecycle. Readiness means the MCP `Server` exists through
`getServer()`; carrier connection remains the host's responsibility. Start before attach and repeated
active start reject `TransportLifecycleError`; repeated stop is safe and restart requires a new
attach. The shared suite owner id is `@robota-sdk/agent-transport-mcp#createMcpTransport`.

## Error Taxonomy

MCP protocol errors surface through the MCP SDK; no new error classes.

## Test Strategy

Server + transport unit tests under `src/__tests__`.

## Dependencies

- `@robota-sdk/agent-interface-transport` and `@robota-sdk/agent-interface-session`.
- External: `@modelcontextprotocol/sdk`.

### Canonical catalog and invocation (MCP-006)

`createAgentMcpServer` is asynchronous: it checks the canonical catalog before accepting calls.
`exposeCommands` is removed. Tools use their canonical runtime names, descriptions and input schemas;
`command_*` and direct `executeCommand` have no compatibility route.

The reserved `robota_submit` tool is a Robota extension for submitting a prompt. A runtime-tool collision
with this name fails startup; later catalog collisions fail listing/calling visibly. Resources and
prompts are not advertised and receive the SDK's unsupported-method response.

MCP tool calls delegate to `invokeRuntimeTool` with the request cancellation signal. The session
execution envelope is serialized as text and failures set `isError: true`. Unknown names, permission
denial, interactive permission requirements, busy state and cancellation are visible tool errors.
Submission cancellation forwards `ISubmitOptions.signal` for the accepted turn; it never aborts another caller's active turn.

Tests use in-memory MCP peers and actual session execution to verify canonical names, policy, hooks,
truncation, cancellation, busy/shutdown behavior, reserved-name collisions and failure isolation.
