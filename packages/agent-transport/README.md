# Agent Transport

Protocol-level transport adapters for the Robota SDK — headless, HTTP, WebSocket, and MCP. This package is pure TypeScript with zero React or Ink dependencies.

> **TUI transport** (Ink/React terminal UI) lives in [`@robota-sdk/agent-transport-tui`](../agent-transport-tui/README.md).

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

## Quick Start

### Headless

```typescript
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';

const transport = createHeadlessTransport({ format: 'text' });
```

### WebSocket

```typescript
import { WsTransport } from '@robota-sdk/agent-transport/ws';

const transport = new WsTransport({ port: 3001 });
```

### HTTP

```typescript
import { createHttpTransport } from '@robota-sdk/agent-transport/http';

const transport = createHttpTransport({ port: 8080 });
```

### MCP

```typescript
import { createMcpTransport } from '@robota-sdk/agent-transport/mcp';

const transport = createMcpTransport({ name: 'my-agent' });
```

## Sub-path Imports

Import only what you need to keep bundles small:

```typescript
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';
import { WsTransport } from '@robota-sdk/agent-transport/ws';
import type { TServerMessage } from '@robota-sdk/agent-transport/ws';
import { createHttpTransport } from '@robota-sdk/agent-transport/http';
import { createMcpTransport } from '@robota-sdk/agent-transport/mcp';
```

Root import re-exports all transports:

```typescript
import { createHeadlessTransport, WsTransport, ... } from '@robota-sdk/agent-transport';
```

## Dependencies

- `@robota-sdk/agent-core`
- `@robota-sdk/agent-interface-transport`
- `@robota-sdk/agent-framework`
- `ws`, `hono`, `@modelcontextprotocol/sdk`, `zod`

## Links

- [npm](https://www.npmjs.com/package/@robota-sdk/agent-transport)
- [GitHub](https://github.com/woojubb/robota)
