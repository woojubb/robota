# @robota-sdk/agent-transport-mcp

Model Context Protocol (MCP) server transport for the Robota SDK. It exposes a running
`IInteractiveSession` as an MCP server so MCP-aware clients (e.g. Claude Desktop, IDE
integrations) can drive the agent and call its canonical, permission-wrapped runtime tools.

## Installation

```bash
npm install @robota-sdk/agent-transport-mcp
# or
pnpm add @robota-sdk/agent-transport-mcp
```

## Usage

`createAgentMcpServer` asynchronously validates and exposes the session runtime catalog.
`createMcpTransport` wraps it for the SDK transport registry. Canonical command tools retain their
`robota_command_*` names; the old `command_*` catalog and `exposeCommands` option are removed.
The reserved `robota_submit` extension accepts `{ prompt: string }` and returns its own turn response.
Runtime tool results are serialized execution envelopes; failures set `isError`. Request cancellation
reaches only the corresponding invocation. Prompts and resources are unsupported.

```typescript
import { createAgentMcpServer } from '@robota-sdk/agent-transport-mcp';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

declare const session: IInteractiveSession;
const server = await createAgentMcpServer({
  name: 'robota-agent',
  version: '1.0.0',
  session, // an IInteractiveSession
});

// Connect `server` to your MCP stdio/SSE transport of choice.
```

## Exports

| Symbol                 | Kind      | Description                                               |
| ---------------------- | --------- | --------------------------------------------------------- |
| `createAgentMcpServer` | function  | `(options: IAgentMcpOptions)` — MCP server for a session  |
| `createMcpTransport`   | function  | `(options: IMcpTransportOptions)` — SDK transport wrapper |
| `IAgentMcpOptions`     | interface | `{ name, version, session }`                              |
| `IMcpTransportOptions` | interface | Transport-registry options                                |

See [docs/SPEC.md](./docs/SPEC.md) for the full contract.
