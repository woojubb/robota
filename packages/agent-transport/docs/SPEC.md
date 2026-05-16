# @robota-sdk/agent-transport — Package Specification

## 1. Purpose

Consolidated transport package for the Robota SDK. Provides all official transport adapter implementations as sub-path imports, replacing 5 individual `agent-transport-*` packages.

## 2. Scope

**In scope:**

- TUI transport (`/tui`): Ink-based interactive terminal UI
- Headless transport (`/headless`): Non-interactive text/JSON/stream-JSON output
- HTTP transport (`/http`): Hono-based REST adapter (Cloudflare Workers / Node.js / Lambda)
- WebSocket transport (`/ws`): Framework-agnostic real-time adapter
- MCP transport (`/mcp`): Model Context Protocol server adapter

**Out of scope:**

- `agent-interface-transport` — stays as an independent package (defines `ITransportAdapter` contract used by both `agent-framework` and `agent-transport`); NOT merged here
- Custom transport implementations — consumers implement `ITransportAdapter` from `agent-interface-transport` directly

## 3. Diamond Dependency Structure

```
                agent-core
                    ↑
       ┌────────────┴────────────┐
agent-framework         agent-transport
       ↑                        ↑
agent-interface-transport ──────┘
      (contract only, no impl)
```

`agent-framework` and `agent-transport` both import from `agent-interface-transport`. They must NEVER import each other. Breaking this structure causes circular dependencies.

## 4. Dependencies

```
@robota-sdk/agent-core              workspace:*   (core types)
@robota-sdk/agent-interface-transport workspace:*   (ITransportAdapter contract)
@robota-sdk/agent-framework         workspace:*   (InteractiveSession, etc.)

# TUI-specific
ink                     ^7.0.1
ink-select-input        ^6.2.0
ink-spinner             ^5.0.0
ink-text-input          ^6.0.0
react                   19.x
chalk                   ^5.3.0
marked                  ^9.1.5
marked-terminal         ^7.3.0
string-width            ^8.2.0

# WebSocket-specific
ws                      ^8.18.3

# HTTP-specific
hono                    ^4.7.0

# MCP-specific
@modelcontextprotocol/sdk ^1.28.0
zod                     ^3.24.4
```

## 5. Public API — Sub-path Exports

Each transport is isolated in its own sub-path to allow treeshaking:

```typescript
import { TuiTransport } from '@robota-sdk/agent-transport/tui';
import type { ITuiCliAdapter } from '@robota-sdk/agent-transport/tui';

import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';

import { createHttpTransport, createAgentRoutes } from '@robota-sdk/agent-transport/http';

import { createWsTransport, WsTransport } from '@robota-sdk/agent-transport/ws';
import type { TServerMessage, TClientMessage } from '@robota-sdk/agent-transport/ws';

import { createMcpTransport, createAgentMcpServer } from '@robota-sdk/agent-transport/mcp';
```

Root import re-exports all transports (use only when you need all):

```typescript
import { TuiTransport, createHeadlessTransport, ... } from '@robota-sdk/agent-transport';
```

## 6. Build Output

- Format: ESM + CJS dual output via tsdown
- Output directory: `dist/node/`
- Entry points built: `index`, `tui/index`, `headless/index`, `http/index`, `ws/index`, `mcp/index`
- External (never bundled): all `@robota-sdk/*` packages plus all external deps listed in §4
- Treeshake: enabled

## 7. Invariants

1. Sub-modules must never cross-import each other (e.g., `tui` must not import from `headless`)
2. `agent-transport` must never import from `agent-cli`
3. `agent-transport` must never import from `agent-framework` in a way that creates a cycle with `agent-interface-transport`
4. `agent-interface-transport` must remain a separate independent package
5. Consumers that use only one transport should import the sub-path — not the root

## 8. Migration

Consolidated from 5 individual packages (v3.0.0-beta.63):

| Old package                            | New import                             |
| -------------------------------------- | -------------------------------------- |
| `@robota-sdk/agent-transport-tui`      | `@robota-sdk/agent-transport/tui`      |
| `@robota-sdk/agent-transport-headless` | `@robota-sdk/agent-transport/headless` |
| `@robota-sdk/agent-transport-http`     | `@robota-sdk/agent-transport/http`     |
| `@robota-sdk/agent-transport-ws`       | `@robota-sdk/agent-transport/ws`       |
| `@robota-sdk/agent-transport-mcp`      | `@robota-sdk/agent-transport/mcp`      |

## 9. Testing

Run:

```bash
pnpm --filter @robota-sdk/agent-transport test
```

Expected: 48 test files, 401+ tests, all passing.
