# @robota-sdk/agent-transport-mcp

Model Context Protocol (MCP) server transport for the Robota SDK. It exposes a running
`IInteractiveSession` as an MCP server so MCP-aware clients (e.g. Claude Desktop, IDE
integrations) can drive the agent and call its system commands as MCP tools.

## Installation

```bash
npm install @robota-sdk/agent-transport-mcp
# or
pnpm add @robota-sdk/agent-transport-mcp
```

## Usage

`createAgentMcpServer` builds an MCP server from an `IInteractiveSession`. By default each
system command is registered as a separate MCP tool (`exposeCommands`). `createMcpTransport`
wraps it for the SDK's transport registry.

```typescript
import { createAgentMcpServer } from '@robota-sdk/agent-transport-mcp';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

declare const session: IInteractiveSession;
const server = createAgentMcpServer({
  name: 'robota-agent',
  version: '1.0.0',
  session, // an IInteractiveSession
  exposeCommands: true,
});

// Connect `server` to your MCP stdio/SSE transport of choice.
```

## Exports

| Symbol                 | Kind      | Description                                               |
| ---------------------- | --------- | --------------------------------------------------------- |
| `createAgentMcpServer` | function  | `(options: IAgentMcpOptions)` — MCP server for a session  |
| `createMcpTransport`   | function  | `(options: IMcpTransportOptions)` — SDK transport wrapper |
| `IAgentMcpOptions`     | interface | `{ name, version, session, exposeCommands? }`             |
| `IMcpTransportOptions` | interface | Transport-registry options                                |

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.
