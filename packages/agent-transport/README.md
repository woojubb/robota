# Agent Transport

Protocol-level transport adapters for the Robota SDK — headless, HTTP, WebSocket, MCP, and TUI (Ink/React terminal UI).

## Installation

```bash
npm install @robota-sdk/agent-transport
```

## Available Transports

Headless is a sub-path of this package. HTTP, WebSocket, MCP, and TUI ship as
standalone packages.

| Transport | Package / Sub-path                     | Description                                             |
| --------- | -------------------------------------- | ------------------------------------------------------- |
| Headless  | `@robota-sdk/agent-transport/headless` | Non-interactive text / JSON / stream-JSON output        |
| HTTP      | `@robota-sdk/agent-transport-http`     | Hono-based REST adapter (Node.js / CF Workers / Lambda) |
| WebSocket | `@robota-sdk/agent-transport-ws`       | Framework-agnostic real-time bidirectional adapter      |
| MCP       | `@robota-sdk/agent-transport-mcp`      | Model Context Protocol server adapter                   |
| TUI       | `@robota-sdk/agent-transport-tui`      | Ink/React terminal UI components and `TuiTransport`     |

This package also exposes the `./testing` (scripted-provider fixtures) and
`./programmatic` sub-paths.

## Quick Start

### Headless

```typescript
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';

const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'Hello!' });
```

### WebSocket

```typescript
import { WsTransport } from '@robota-sdk/agent-transport-ws';

const transport = new WsTransport({ port: 3001 });
```

### HTTP

```typescript
import { createHttpTransport } from '@robota-sdk/agent-transport-http';

const transport = createHttpTransport({ basePath: '/agent' }); // mount on your own server
```

### MCP

```typescript
import { createMcpTransport } from '@robota-sdk/agent-transport-mcp';

const transport = createMcpTransport({ name: 'my-agent', version: '1.0.0' });
```

### TUI (Ink/React)

```typescript
import { TuiTransport } from '@robota-sdk/agent-transport-tui';
import type { IRenderOptions } from '@robota-sdk/agent-transport-tui';

declare const options: IRenderOptions;
const transport = new TuiTransport(options);
```

> React and Ink dependencies are confined to the standalone
> `@robota-sdk/agent-transport-tui` package. This core package stays React-free.

## Sub-path Imports

Import only what you need to keep bundles small:

```typescript
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';
import { WsTransport } from '@robota-sdk/agent-transport-ws';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';
import { createMcpTransport } from '@robota-sdk/agent-transport-mcp';
import { TuiTransport } from '@robota-sdk/agent-transport-tui';
```

The root import exposes only the headless and programmatic surfaces (plus the
`TransportRegistry`). The HTTP, WebSocket, MCP, and TUI transports are not
re-exported here — import them from their own packages shown above.

```typescript
import { createHeadlessTransport } from '@robota-sdk/agent-transport';
```

## Dependencies

- `@robota-sdk/agent-core`
- `@robota-sdk/agent-interface-transport`
- `@robota-sdk/agent-framework`

The heavier protocol dependencies (`ws`, `hono`, `@modelcontextprotocol/sdk`,
`react`, `ink`, and friends) now live in the split transport packages
(`@robota-sdk/agent-transport-{http,ws,mcp,tui}`).

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-transport)
- [GitHub](https://github.com/woojubb/robota)
