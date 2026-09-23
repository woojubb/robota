# MCP Transport

Expose InteractiveSession as a Model Context Protocol server.

## Basic Setup

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
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

The server lists the session's canonical runtime tools with their existing names and input schemas.
Model-invocable commands appear as `robota_command_<name>` when available. The separate
`command_<name>` catalog is gone. `robota_submit` is a Robota extension that submits a prompt and
waits for the session's response. Direct tool calls use the session's permissions and hooks; a call
that needs interactive permission fails visibly unless the host supplies an approved policy.

This minimum server exposes tools only. Prompts and resources require their own canonical session
registries before they can be offered through MCP.

## Advanced: Direct MCP Server

For more control, use `createAgentMcpServer` directly:

```typescript
import { createAgentMcpServer } from '@robota-sdk/agent-transport-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { IMcpTransportSession } from '@robota-sdk/agent-transport-mcp';

declare const interactiveSession: IMcpTransportSession;

const server = await createAgentMcpServer({
  name: 'robota-agent',
  version: '1.0.0',
  session: interactiveSession,
});

await server.connect(new StdioServerTransport());
```
