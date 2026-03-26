# @robota-sdk/agent-transport-http SPEC

## Scope

HTTP transport adapter for exposing InteractiveSession over REST API. Built on Hono for Cloudflare Workers + Node.js + AWS Lambda compatibility.

## Boundaries

- Does NOT own InteractiveSession — imported from `@robota-sdk/agent-sdk`
- Does NOT own system commands (via session.executeCommand) — imported from `@robota-sdk/agent-sdk`
- Does NOT own Session, tools, providers — those are SDK internals
- OWNS: HTTP route definitions, SSE streaming, request/response serialization

## Architecture

```
Client (browser, curl, etc.)
  ↓ HTTP
Hono Router (agent-transport-http)
  ├── POST /submit       → session.submit(prompt) → SSE stream
  ├── POST /command      → session.executeCommand() → JSON
  ├── POST /abort        → session.abort() → JSON
  ├── POST /cancel-queue → session.cancelQueue() → JSON
  ├── GET  /messages     → session.getMessages() → JSON
  ├── GET  /context      → session.getContextState() → JSON
  ├── GET  /executing    → isExecuting → JSON
  └── GET  /pending      → pendingPrompt → JSON
  ↓
InteractiveSession (agent-sdk)
  ↓
Session (agent-sessions) → Core
```

## Public API Surface

### `createAgentRoutes(options)`

Factory function that returns a Hono app with all routes configured.

```typescript
import { createAgentRoutes } from '@robota-sdk/agent-transport-http';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';

const routes = createAgentRoutes({
  sessionFactory: (req) => interactiveSession,
});

// Mount on existing Hono app
app.route('/agent', routes);

// Or use standalone
export default routes; // Cloudflare Workers
```

### Session Factory

The `sessionFactory` callback receives the HTTP request context and returns an InteractiveSession. This allows per-request session resolution (e.g., by auth token, session ID).

## Endpoints

| Method | Path          | Request Body                     | Response                         | Description                  |
| ------ | ------------- | -------------------------------- | -------------------------------- | ---------------------------- |
| POST   | /submit       | `{ prompt: string }`             | SSE stream                       | Submit prompt, stream events |
| POST   | /command      | `{ name: string, args: string }` | `ICommandResult` JSON            | Execute system command       |
| POST   | /abort        | —                                | `{ ok: true }`                   | Abort current execution      |
| POST   | /cancel-queue | —                                | `{ ok: true }`                   | Cancel queued prompt         |
| GET    | /messages     | —                                | `TUniversalMessage[]` JSON       | Get message history          |
| GET    | /context      | —                                | `IContextWindowState` JSON       | Get context window state     |
| GET    | /executing    | —                                | `{ executing: boolean }` JSON    | Check if executing           |
| GET    | /pending      | —                                | `{ pending: string\|null }` JSON | Get pending queued prompt    |

### SSE Event Types (POST /submit)

| Event       | Data                      | Description             |
| ----------- | ------------------------- | ----------------------- |
| text_delta  | `{ delta: string }`       | Streaming text chunk    |
| tool_start  | `IToolState`              | Tool execution began    |
| tool_end    | `IToolState`              | Tool execution finished |
| thinking    | `{ isThinking: boolean }` | Execution state changed |
| complete    | `IExecutionResult`        | Prompt completed        |
| interrupted | `IExecutionResult`        | Execution was aborted   |
| error       | `{ message: string }`     | Execution error         |

## ITransportAdapter

This package implements the `ITransportAdapter` interface from `@robota-sdk/agent-sdk`.

### `createHttpTransport(options?)`

Factory that returns an `ITransportAdapter` with `name: 'http'`.

**Extra method:**

- `getApp(): Hono` — Returns the configured Hono app instance (available after `start()`).

**Lifecycle:**

1. `attach(session)` — Stores the `InteractiveSession` reference
2. `start()` — Creates the Hono app with all route handlers bound to the attached session
3. `stop()` — Clears the Hono app and releases resources

## Dependencies

- `@robota-sdk/agent-sdk` (InteractiveSession)
- `hono` (HTTP framework)
