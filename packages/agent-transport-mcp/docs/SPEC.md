# agent-transport-mcp Specification

## Transport Admission (SEC-008)

transport-admission: none — the MCP server speaks over stdio to a client process the user launched, so the boundary is process spawn: a peer that can write to this stdin already runs as the user. What this package DOES enforce is what that peer may reach — SEC-008 stops it being offered commands marked `modelInvocable: false`, and attributes its calls as `'remote'` rather than as the local operator.

## Scope

Model Context Protocol (MCP) server transport for the Robota SDK. Split out of the consolidated
`agent-transport` package (DQ-AUDIT-005) so the `@modelcontextprotocol/sdk` dependency is an
isolated unit.

## Boundaries

- Owns the MCP server transport adapter and agent MCP server builder.
- Depends only on `agent-interface-transport` (transport contracts).
- No other transport package depends on this one.

## Architecture Overview

```
agent-transport-mcp
  ├── createMcpTransport    ← ITransportAdapter over the MCP server
  └── createAgentMcpServer  ← MCP server exposing an agent session
```

## Type Ownership

Owns `IMcpTransportOptions`, `IAgentMcpOptions`, and `IMcpTransportSession`. MCP consumes only the
turn-submission and command roles. The public transport preserves its legacy
`ITransportAdapter<IInteractiveSession>` declaration and adds a narrow
`attach(IMcpTransportSession)` overload.

## Public API Surface

| Export                 | Kind      | Description                                            |
| ---------------------- | --------- | ------------------------------------------------------ |
| `createMcpTransport`   | function  | MCP server transport adapter                           |
| `createAgentMcpServer` | function  | Build an MCP server for an agent                       |
| `IMcpTransport`        | interface | Legacy adapter declaration plus narrow attach overload |
| `IMcpTransportSession` | interface | Exact submission + command session roles               |

## Extension Points

New tools/resources extend `createAgentMcpServer`; new options extend the option interfaces.

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

- `@robota-sdk/agent-interface-transport`.
- External: `@modelcontextprotocol/sdk`.
