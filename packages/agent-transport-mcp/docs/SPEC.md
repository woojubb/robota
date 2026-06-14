# agent-transport-mcp Specification

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

Owns `IMcpTransportOptions`, `IAgentMcpOptions`.

## Public API Surface

| Export                 | Kind     | Description                      |
| ---------------------- | -------- | -------------------------------- |
| `createMcpTransport`   | function | MCP server transport adapter     |
| `createAgentMcpServer` | function | Build an MCP server for an agent |

## Extension Points

New tools/resources extend `createAgentMcpServer`; new options extend the option interfaces.

## Error Taxonomy

MCP protocol errors surface through the MCP SDK; no new error classes.

## Test Strategy

Server + transport unit tests under `src/__tests__`.

## Dependencies

- `@robota-sdk/agent-interface-transport`.
- External: `@modelcontextprotocol/sdk`.
