# MCP Transport

Expose InteractiveSession as a Model Context Protocol server.

## Basic Setup

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { createMcpTransport } from '@robota-sdk/agent-transport-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
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

The server exposes `submit` plus one `command_<name>` MCP tool for each command returned by `session.listCommands()`:

| Tool            | Input                | Description                        |
| --------------- | -------------------- | ---------------------------------- |
| submit          | `{ prompt: string }` | Submit a prompt, wait for response |
| command_help    | `{ args?: string }`  | Show available commands            |
| command_clear   | `{ args?: string }`  | Clear conversation history         |
| command_compact | `{ args?: string }`  | Compress context window            |
| command_mode    | `{ args?: string }`  | Show/change permission mode        |
| command_model   | `{ args?: string }`  | Change AI model                    |
| command_context | `{ args?: string }`  | Context window info                |
| command_resume  | `{ args?: string }`  | Resume a previous session          |
| command_rename  | `{ args?: string }`  | Rename the current session         |

Other auto-discovered commands, such as `memory`, `rewind`, `provider`, `background`, `plugin`, `reload-plugins`, and command-module entries like `agent`, are exposed the same way when they are available on the session.

## Advanced: Direct MCP Server

For more control, use `createAgentMcpServer` directly:

```typescript
import { createAgentMcpServer } from '@robota-sdk/agent-transport-mcp';

const server = createAgentMcpServer({
  name: 'robota-agent',
  version: '1.0.0',
  session: interactiveSession,
  exposeCommands: true, // register system commands as MCP tools
});

await server.connect(new StdioServerTransport());
```
