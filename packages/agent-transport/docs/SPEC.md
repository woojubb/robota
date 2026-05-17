# @robota-sdk/agent-transport — Package Specification

## 1. Purpose

Consolidated transport package for the Robota SDK. Provides protocol-level transport adapter implementations as sub-path imports. TUI (Ink/React) rendering is kept in the `./tui` sub-path to isolate React dependencies from pure-TS consumers.

## 2. Scope

**In scope:**

- Headless transport (`/headless`): Non-interactive text/JSON/stream-JSON output
- HTTP transport (`/http`): Hono-based REST adapter (Cloudflare Workers / Node.js / Lambda)
- WebSocket transport (`/ws`): Framework-agnostic real-time adapter
- MCP transport (`/mcp`): Model Context Protocol server adapter
- TUI transport (`/tui`): Ink/React terminal UI components and `TuiTransport` adapter

**Out of scope:**

- `agent-interface-transport` — stays as an independent package (defines `ITransportAdapter` contract); NOT merged here
- Custom transport implementations — consumers implement `ITransportAdapter` from `agent-interface-transport` directly

**React / Ink policy:**

React and Ink dependencies are confined to the `./tui` sub-path. Pure-TS consumers import only `/headless`, `/http`, `/ws`, or `/mcp` and receive zero React/Ink in their dependency graph.

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

`agent-framework` and `agent-transport` both import from `agent-interface-transport`. They must NEVER import each other.

## 4. Dependencies

```
@robota-sdk/agent-core              workspace:*   (core types)
@robota-sdk/agent-interface-transport workspace:*   (ITransportAdapter contract)
@robota-sdk/agent-framework         workspace:*   (InteractiveSession, etc.)

# WebSocket-specific
ws                      ^8.18.3

# HTTP-specific
hono                    ^4.7.0

# MCP-specific
@modelcontextprotocol/sdk ^1.28.0
zod                     ^3.24.4

# TUI-specific (./tui sub-path only)
react                   19.2.4
ink                     ^7.0.1
ink-select-input        ^6.2.0
ink-spinner             ^5.0.0
ink-text-input          ^6.0.0
chalk                   ^5.3.0
marked                  ^9.1.5
marked-terminal         ^7.3.0
string-width            ^8.2.0
```

## 5. Public API — Sub-path Exports

```typescript
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';

import { createHttpTransport, createAgentRoutes } from '@robota-sdk/agent-transport/http';

import { createWsTransport, WsTransport } from '@robota-sdk/agent-transport/ws';
import type { TServerMessage, TClientMessage } from '@robota-sdk/agent-transport/ws';

import { createMcpTransport, createAgentMcpServer } from '@robota-sdk/agent-transport/mcp';

import { TuiTransport } from '@robota-sdk/agent-transport/tui';
import type { ITuiCliAdapter, IRenderOptions } from '@robota-sdk/agent-transport/tui';
```

Root import re-exports all transports (including TUI):

```typescript
import { createHeadlessTransport, TuiTransport, ... } from '@robota-sdk/agent-transport';
```

## 6. Build Output

- Format: ESM + CJS dual output via tsdown
- Output directory: `dist/node/`
- Entry points: `index`, `headless/index`, `http/index`, `ws/index`, `mcp/index`, `tui/index`
- External (never bundled): all `@robota-sdk/*` packages plus all external deps in §4
- Treeshake: enabled

## 7. Invariants

1. Sub-modules must never cross-import each other
2. `agent-transport` must never import from `agent-cli`
3. `agent-transport` must never import from `agent-framework` in a way that creates a cycle with `agent-interface-transport`
4. `agent-interface-transport` must remain a separate independent package
5. React and Ink dependencies must only be used within `src/tui/` — never imported from other sub-modules

## 8. Migration History

Consolidated from 5 individual packages (v3.0.0-beta.63):

| Old package                            | Import                                 |
| -------------------------------------- | -------------------------------------- |
| `@robota-sdk/agent-transport-headless` | `@robota-sdk/agent-transport/headless` |
| `@robota-sdk/agent-transport-http`     | `@robota-sdk/agent-transport/http`     |
| `@robota-sdk/agent-transport-ws`       | `@robota-sdk/agent-transport/ws`       |
| `@robota-sdk/agent-transport-mcp`      | `@robota-sdk/agent-transport/mcp`      |

TUI re-integrated from brief `agent-transport-tui` split (v3.0.0-beta.66, ARCH-001 revision):

| Old import                        | Current import                    |
| --------------------------------- | --------------------------------- |
| `@robota-sdk/agent-transport-tui` | `@robota-sdk/agent-transport/tui` |

## 9. Testing

```bash
pnpm --filter @robota-sdk/agent-transport test
```

Expected: 10 test files, 80 tests, all passing.
