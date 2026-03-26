# MCP Transport

Expose InteractiveSession as a Model Context Protocol server.

## Basic Setup

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { createMcpTransport } from '@robota-sdk/agent-transport-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const session = new InteractiveSession({ cwd: process.cwd(), provider });

const transport = createMcpTransport({
  name: 'robota-agent',
  version: '1.0.0',
});

session.attachTransport(transport);
await transport.start();

// Connect via stdio (for Claude Desktop, etc.)
await transport.getServer().connect(new StdioServerTransport());
```

## MCP Tools

The server exposes these tools to MCP clients:

| Tool            | Input                | Description                        |
| --------------- | -------------------- | ---------------------------------- |
| submit          | `{ prompt: string }` | Submit a prompt, wait for response |
| command_help    | `{ args?: string }`  | Show available commands            |
| command_clear   | `{ args?: string }`  | Clear conversation history         |
| command_compact | `{ args?: string }`  | Compress context window            |
| command_mode    | `{ args?: string }`  | Show/change permission mode        |
| command_model   | `{ args?: string }`  | Change AI model                    |
| command_context | `{ args?: string }`  | Context window info                |

System commands are auto-discovered via `session.listCommands()`.
