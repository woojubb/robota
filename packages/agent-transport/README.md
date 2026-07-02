# Agent Transport

Protocol-level transport adapters for the Robota SDK — headless, HTTP, WebSocket, MCP, and TUI (Ink/React terminal UI).

## Installation

```bash
npm install @robota-sdk/agent-transport
```

## Available Transports

| Transport | Sub-path     | Description                                             |
| --------- | ------------ | ------------------------------------------------------- |
| Headless  | `./headless` | Non-interactive text / JSON / stream-JSON output        |
| HTTP      | `./http`     | Hono-based REST adapter (Node.js / CF Workers / Lambda) |
| WebSocket | `./ws`       | Framework-agnostic real-time bidirectional adapter      |
| MCP       | `./mcp`      | Model Context Protocol server adapter                   |
| TUI       | `./tui`      | Ink/React terminal UI components and `TuiTransport`     |

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

> React and Ink dependencies are confined to the `./tui` sub-path. Importing from
> other sub-paths keeps your bundle React-free.

## Sub-path Imports

Import only what you need to keep bundles small:

```typescript
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';
import { WsTransport } from '@robota-sdk/agent-transport-ws';
import type { TServerMessage } from '@robota-sdk/agent-transport-ws';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';
import { createMcpTransport } from '@robota-sdk/agent-transport-mcp';
import { TuiTransport } from '@robota-sdk/agent-transport-tui';
```

Root import re-exports all transports:

<!-- doc-example-skip: intentional ellipsis fragment (import surface overview, not runnable) -->

```typescript
import { createHeadlessTransport, WsTransport, TuiTransport, ... } from '@robota-sdk/agent-transport';
```

## Dependencies

- `@robota-sdk/agent-core`
- `@robota-sdk/agent-interface-transport`
- `@robota-sdk/agent-framework`
- `ws`, `hono`, `@modelcontextprotocol/sdk`, `zod`
- `react`, `ink`, `ink-select-input`, `ink-spinner`, `ink-text-input`, `chalk`, `marked`, `marked-terminal`, `string-width` _(TUI sub-path only)_

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-transport)
- [GitHub](https://github.com/woojubb/robota)
