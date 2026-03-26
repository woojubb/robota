# Transport Unified Interface Design

## Goal

All transport adapters implement a common `ITransportAdapter` interface so they can be composed consistently with InteractiveSession.

## Current State

| Transport | Factory                                            | Session injection   | Return                   | Lifecycle         |
| --------- | -------------------------------------------------- | ------------------- | ------------------------ | ----------------- |
| HTTP      | `createAgentRoutes({ sessionFactory })`            | Per-request factory | Hono app                 | mount → serve     |
| WS        | `createWsHandler({ session, send })`               | Direct              | `{ onMessage, cleanup }` | connect → cleanup |
| MCP       | `createAgentMcpServer({ name, version, session })` | Direct              | MCP Server               | connect → serve   |
| Headless  | `createHeadlessRunner({ session, outputFormat })`  | Direct              | `{ run }`                | run → exit        |

## Problem

No shared interface. Each transport has different construction, session injection, and lifecycle patterns. Adding a new transport requires reading existing ones to understand the pattern.

## Design

### ITransportAdapter interface

Defined in `@robota-sdk/agent-sdk` (since all transports depend on it):

```typescript
/**
 * Common interface for all transport adapters.
 * Each transport exposes InteractiveSession over a specific protocol.
 */
export interface ITransportAdapter {
  /** Human-readable transport name (e.g., 'http', 'ws', 'mcp', 'headless') */
  readonly name: string;

  /** Attach an InteractiveSession to this transport. */
  attach(session: InteractiveSession): void;

  /** Start serving. What this means depends on the transport. */
  start(): Promise<void>;

  /** Stop serving and clean up resources. */
  stop(): Promise<void>;
}
```

### How each transport adapts

**HTTP** — `attach` stores sessionFactory wrapper. `start` returns (Hono app is stateless). `stop` no-op.

```typescript
const http = createHttpTransport({ port: 3000 });
http.attach(session); // wraps as sessionFactory
await http.start(); // returns Hono app (or starts server)
```

**WS** — `attach` stores session. `start` subscribes to events. `stop` calls cleanup.

```typescript
const ws = createWsTransport({ send: (msg) => socket.send(JSON.stringify(msg)) });
ws.attach(session);
await ws.start();
// later...
await ws.stop(); // unsubscribes events
```

**MCP** — `attach` stores session. `start` registers tools and connects. `stop` closes server.

```typescript
const mcp = createMcpTransport({ name: 'robota', version: '1.0.0', transport: stdioTransport });
mcp.attach(session);
await mcp.start(); // registers tools, connects
```

**Headless** — `attach` stores session. `start` runs prompt and writes output. `stop` no-op.

```typescript
const headless = createHeadlessTransport({ outputFormat: 'json', prompt: 'query' });
headless.attach(session);
await headless.start(); // runs, writes output, resolves when done
```

### HTTP sessionFactory pattern

HTTP currently uses `sessionFactory` (per-request session). With `attach(session)`, every request gets the same session. If per-request sessions are needed, the consumer wraps:

```typescript
// Single session (most common)
const http = createHttpTransport({});
http.attach(session);

// Per-request (advanced) — consumer manages
app.route('/agent', createAgentRoutes({ sessionFactory: () => createNewSession() }));
```

The existing `createAgentRoutes` with `sessionFactory` remains available for advanced use. `createHttpTransport` is the simplified ITransportAdapter version.

### Where the interface lives

`packages/agent-sdk/src/interactive/types.ts` — alongside IInteractiveSessionEvents, IExecutionResult.

Each transport package imports the interface and implements it.

## Changes

| Package                    | Change                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `agent-sdk`                | Add `ITransportAdapter` interface to `types.ts`, export from index                                               |
| `agent-transport-http`     | Add `createHttpTransport()` that implements `ITransportAdapter`. Keep existing `createAgentRoutes` as-is.        |
| `agent-transport-ws`       | Add `createWsTransport()` that implements `ITransportAdapter`. Keep existing `createWsHandler` as-is.            |
| `agent-transport-mcp`      | Add `createMcpTransport()` that implements `ITransportAdapter`. Keep existing `createAgentMcpServer` as-is.      |
| `agent-transport-headless` | Add `createHeadlessTransport()` that implements `ITransportAdapter`. Keep existing `createHeadlessRunner` as-is. |

Existing factory functions are NOT removed — they remain for backward compatibility and advanced use. The new `ITransportAdapter` wrappers delegate to them.

## Out of Scope

- Multi-transport orchestration (attaching multiple transports to one session)
- Transport discovery/auto-configuration
- CLI changes (CLI continues to use transport-headless directly)
