# @robota-sdk/agent-transport-mcp

MCP transport adapter for exposing `InteractiveSession` as a Model Context Protocol server. Allows MCP-compatible clients (Claude, other agents) to interact with a Robota agent via the standard MCP tool protocol.

## Installation

```bash
pnpm add @robota-sdk/agent-transport-mcp
```

## Usage

```typescript
import { createAgentMcpServer } from '@robota-sdk/agent-transport-mcp';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const mcpServer = createAgentMcpServer({
  name: 'robota-agent',
  version: '1.0.0',
  session: interactiveSession,
});

// Connect via stdio (subprocess / Claude Desktop)
await mcpServer.connect(new StdioServerTransport());
```

## MCP Tools

Each tool maps directly to an `InteractiveSession` operation or a system command.

| Tool Name         | Input                | Description                             |
| ----------------- | -------------------- | --------------------------------------- |
| `submit`          | `{ prompt: string }` | Submit a prompt, wait for full response |
| `command_help`    | `{ args?: string }`  | Show available commands                 |
| `command_clear`   | `{ args?: string }`  | Clear conversation history              |
| `command_compact` | `{ args?: string }`  | Compress the context window             |
| `command_mode`    | `{ args?: string }`  | Show or change permission mode          |
| `command_model`   | `{ args?: string }`  | Change the active AI model              |
| `command_context` | `{ args?: string }`  | Show context window info                |
| ...               | ...                  | One tool per registered system command  |

The `submit` tool waits for the session to reach `complete` or `interrupted` state before returning, so MCP clients receive a single text response rather than a stream.

## Dependencies

- `@robota-sdk/agent-sdk` — `InteractiveSession`
- `@modelcontextprotocol/sdk` — MCP server implementation
- `zod` — input schema definitions
