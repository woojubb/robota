# @robota-sdk/agent-transport-mcp SPEC

## Scope

MCP transport adapter for exposing InteractiveSession as a Model Context Protocol server. Allows MCP-compatible clients (Claude, other agents) to interact with a Robota agent via the standard MCP tool protocol.

## Boundaries

- Does NOT own InteractiveSession — imported from `@robota-sdk/agent-sdk`
- Does NOT own system commands — uses `session.executeCommand()` and `session.listCommands()` from InteractiveSession
- Does NOT own MCP protocol — uses `@modelcontextprotocol/sdk`
- OWNS: Tool registration mapping from InteractiveSession API to MCP tools

## Architecture

```
MCP Client (Claude, etc.)
  ↓ MCP protocol (stdio / HTTP)
McpServer (agent-transport-mcp)
  ├── tool: submit        → session.submit(prompt) → wait for complete → text response
  ├── tool: command_clear → session.executeCommand('clear') → text response
  ├── tool: command_mode  → session.executeCommand('mode') → text response
  └── ... (one tool per system command)
  ↓
InteractiveSession (agent-sdk)
  ↓
Session (agent-sessions) → Core
```

## Public API

### `createAgentMcpServer(options)`

Factory function that returns a configured `McpServer` instance.

```typescript
import { createAgentMcpServer } from '@robota-sdk/agent-transport-mcp';

const mcpServer = createAgentMcpServer({
  name: 'robota-agent',
  version: '1.0.0',
  session: interactiveSession,
});

// Connect via stdio (subprocess)
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
await mcpServer.connect(new StdioServerTransport());
```

## MCP Tools

| Tool Name         | Input                | Description                            |
| ----------------- | -------------------- | -------------------------------------- |
| `submit`          | `{ prompt: string }` | Submit prompt, wait for response       |
| `command_help`    | `{ args?: string }`  | Show available commands                |
| `command_clear`   | `{ args?: string }`  | Clear conversation history             |
| `command_compact` | `{ args?: string }`  | Compress context window                |
| `command_mode`    | `{ args?: string }`  | Show/change permission mode            |
| `command_model`   | `{ args?: string }`  | Change AI model                        |
| `command_context` | `{ args?: string }`  | Context window info                    |
| ...               | ...                  | One tool per registered system command |

## ITransportAdapter

This package implements the `ITransportAdapter` interface from `@robota-sdk/agent-sdk`.

### `createMcpTransport(options)`

Factory that returns an `ITransportAdapter` with `name: 'mcp'`.

**Options:**

| Field            | Type      | Description                                    |
| ---------------- | --------- | ---------------------------------------------- |
| `name`           | `string`  | Server name for MCP protocol identification    |
| `version`        | `string`  | Server version string                          |
| `exposeCommands` | `boolean` | Whether to expose system commands as MCP tools |

**Extra method:**

- `getServer(): Server` — Returns the underlying MCP `Server` instance (available after `start()`).

**Lifecycle:**

1. `attach(session)` — Stores the `InteractiveSession` reference
2. `start()` — Creates the MCP server, registers tools (submit + system commands)
3. `stop()` — Closes the MCP server and releases resources

## Dependencies

- `@robota-sdk/agent-sdk` (InteractiveSession)
- `@modelcontextprotocol/sdk` (MCP server implementation)
- `zod` (input schema definitions)
