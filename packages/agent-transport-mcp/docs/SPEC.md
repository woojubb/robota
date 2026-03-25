# @robota-sdk/agent-transport-mcp SPEC

## Scope

MCP transport adapter for exposing InteractiveSession as a Model Context Protocol server. Allows MCP-compatible clients (Claude, other agents) to interact with a Robota agent via the standard MCP tool protocol.

## Boundaries

- Does NOT own InteractiveSession — imported from `@robota-sdk/agent-sdk`
- Does NOT own SystemCommandExecutor — imported from `@robota-sdk/agent-sdk`
- Does NOT own MCP protocol — uses `@modelcontextprotocol/sdk`
- OWNS: Tool registration mapping from InteractiveSession API to MCP tools

## Architecture

```
MCP Client (Claude, etc.)
  ↓ MCP protocol (stdio / HTTP)
McpServer (agent-transport-mcp)
  ├── tool: submit        → session.submit(prompt) → wait for complete → text response
  ├── tool: command_clear → commandExecutor.execute('clear') → text response
  ├── tool: command_mode  → commandExecutor.execute('mode') → text response
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
  commandExecutor,
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

## Dependencies

- `@robota-sdk/agent-sdk` (InteractiveSession, SystemCommandExecutor)
- `@modelcontextprotocol/sdk` (MCP server implementation)
- `zod` (input schema definitions)
