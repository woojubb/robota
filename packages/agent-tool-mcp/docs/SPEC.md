# agent-tool-mcp Specification

## Scope

MCP (Model Context Protocol) tool implementations for Robota SDK. Provides `MCPTool` (a JSON-RPC 2.0 tool executor) and `RelayMcpTool` (a relay adapter that bridges third-party MCP commands into Robota agent flows). The package is published to npm under `@robota-sdk/agent-tool-mcp`.

## Boundaries

- Allowed dependencies: `@robota-sdk/agent-core`. Peer dependencies also include `@robota-sdk/agent-tools` and `@modelcontextprotocol/sdk`, but neither is currently imported in source — both are reserved for future protocol transport implementation.
- Must not import `agent-sdk`, `agent-sessions`, `agent-cli`, or any other `agent-*` package.
- `MCPTool` and `RelayMcpTool` both implement `ITool` directly (not via `AbstractTool`) to avoid a circular runtime dependency (`agent-tool-mcp` → `agents` → `tools` → `agents`).
- Does not own a tool registry or factory. The consumer (composition root or CLI) selects and wires tools at construction time.
- `executeMCPRequest` in `mcp-protocol.ts` is a protocol stub — actual MCP transport is not yet implemented.

## Architecture Overview

Single entry point `./` backed by `src/index.ts`.

**`MCPTool`** (`src/mcp-tool.ts`) implements `ITool` and wraps JSON-RPC 2.0 communication with a remote MCP server. It manages a `TMCPConnectionStatus` state machine (`disconnected → connecting → connected → disconnecting → disconnected | error`). Protocol helpers (`buildMCPRequest`, `executeMCPRequest`, `processMCPResponse`) live in `src/mcp-protocol.ts`.

**`RelayMcpTool`** (`src/relay-mcp-tool.ts`) is a minimal relay that accepts a caller-provided `run()` callback. It appends a single agent `IOwnerPathSegment` to the incoming `ownerPath` and forwards control to the callback with the augmented `IRelayMcpContext`. No prefix injection, no fallback, no context creation inside.

**`mcp-protocol.ts`** owns the JSON-RPC 2.0 message types (`IMCPRequest`, `IMCPResponse`, `IMCPRequestParams`, `IMCPResultData`, `IMCPError`) and the protocol helper functions. It is not exported from the package entry point.

## Type Ownership

This package is SSOT for the following types. Types marked **public** are exported from the `.` entry point; others are internal.

- `IMCPConfig` — `MCPTool` constructor configuration (**public**).
- `IRelayMcpOptions` — `RelayMcpTool` constructor options (**public**).
- `IRelayMcpContext` — context passed to the `run()` callback (**public**).
- `TMCPConnectionStatus` — connection state union (`'connected' | 'disconnected' | 'connecting' | 'disconnecting' | 'error'`) (internal).
- `IMCPRequest`, `IMCPResponse`, `IMCPRequestParams`, `IMCPResultData`, `IMCPError` — JSON-RPC 2.0 protocol message shapes (internal).

All `ITool`-related types (`ITool`, `IToolResult`, `IToolExecutionContext`, `TToolParameters`, `IParameterValidationResult`, `IToolSchema`) are owned by `@robota-sdk/agent-core`.

## Public API Surface

| Export             | Kind      | Description                                                                |
| ------------------ | --------- | -------------------------------------------------------------------------- |
| `MCPTool`          | class     | `ITool` implementation for JSON-RPC 2.0 MCP server communication           |
| `createMCPTool`    | function  | Factory: `(config: IMCPConfig, schema: IToolSchema) => MCPTool`            |
| `RelayMcpTool`     | class     | Relay adapter that bridges MCP commands into Robota agent flows            |
| `IMCPConfig`       | interface | MCP server connection configuration (`endpoint`, `apiKey`, `timeout`, ...) |
| `IRelayMcpOptions` | interface | `RelayMcpTool` constructor options (`schema`, `run`)                       |
| `IRelayMcpContext` | interface | Context passed to `RelayMcpTool.run()` callback                            |

## Extension Points

- `IMCPConfig.timeout` — override the default 30 000 ms execution timeout.
- `IMCPConfig.retries` — override the default retry count (3).
- `IMCPConfig.headers` — pass additional HTTP headers; forwarded as `metadata` in the MCP request params.
- `IMCPConfig.apiKey` — optional API key for MCP server authentication.
- `IRelayMcpOptions.run` — inject the relay executor callback that creates and runs a Robota agent flow.

## Error Taxonomy

| Source         | Error / Condition                                                             | Trigger                                                    |
| -------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `MCPTool`      | `ToolExecutionError('MCP tool execution failed: ...')`                        | Any unhandled error during `execute()`                     |
| `MCPTool`      | `Error('MCP connection timeout: still connecting after Nms')`                 | `ensureConnection()` poll exceeds 50 iterations (5 000 ms) |
| `MCPTool`      | `Error('Failed to connect to MCP server: ...')`                               | Error thrown during `ensureConnection()`                   |
| `MCPTool`      | `Error('Error disconnecting from MCP server: ...')`                           | Error thrown during `disconnect()`                         |
| `RelayMcpTool` | `ToolExecutionError('RelayMcpTool requires tool-call scoped EventService')`   | `context.eventService` is absent                           |
| `RelayMcpTool` | `ToolExecutionError('RelayMcpTool requires baseEventService')`                | `context.baseEventService` is absent                       |
| `RelayMcpTool` | `ToolExecutionError('RelayMcpTool requires ownerPath bound to tool segment')` | `context.ownerPath` is absent or empty                     |

`ToolExecutionError` and `ValidationError` are re-thrown as-is; all other errors are wrapped in `ToolExecutionError`.

## Test Strategy

- No test files exist for this package (`vitest run --passWithNoTests`).
- Coverage gap: all execution paths, including the `MCPTool` connection state machine, the JSON-RPC protocol helpers, and `RelayMcpTool.execute()`, are untested.
- Recommended: unit tests for `validateParameters()`, `buildMCPRequest()`, `processMCPResponse()`, and `RelayMcpTool.execute()` with mock `IToolExecutionContext`.

## Class Contract Registry

### Interface Implementations

| Interface      | Implementor    | Location                |
| -------------- | -------------- | ----------------------- |
| `ITool` (core) | `MCPTool`      | `src/mcp-tool.ts`       |
| `ITool` (core) | `RelayMcpTool` | `src/relay-mcp-tool.ts` |

### Cross-Package Port Consumers

| Port (Owner)                   | Consumer       | Location                |
| ------------------------------ | -------------- | ----------------------- |
| `ITool` (core)                 | `MCPTool`      | `src/mcp-tool.ts`       |
| `ITool` (core)                 | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
| `IToolExecutionContext` (core) | `MCPTool`      | `src/mcp-tool.ts`       |
| `IToolExecutionContext` (core) | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
| `IEventService` (core)         | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
| `IOwnerPathSegment` (core)     | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
| `ToolExecutionError` (core)    | `MCPTool`      | `src/mcp-tool.ts`       |
| `ToolExecutionError` (core)    | `RelayMcpTool` | `src/relay-mcp-tool.ts` |
