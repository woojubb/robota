# @robota-sdk/agent-transport-http

Hono-based HTTP transport adapter for exposing `InteractiveSession` over REST API. Compatible with Cloudflare Workers, Node.js, and AWS Lambda.

## Installation

```bash
pnpm add @robota-sdk/agent-transport-http
```

## Usage

```typescript
import { createAgentRoutes } from '@robota-sdk/agent-transport-http';
import { InteractiveSession, SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { Hono } from 'hono';

const app = new Hono();

const routes = createAgentRoutes({
  sessionFactory: (_req) => interactiveSession, // resolve per-request
  commandExecutor,
});

// Mount under a prefix
app.route('/agent', routes);

// Or export directly for Cloudflare Workers
export default routes;
```

The `sessionFactory` callback receives the Hono request context and returns an `InteractiveSession`. Use this to resolve sessions by auth token, session ID, or any request-scoped data.

## Endpoints

| Method | Path          | Request Body                     | Response                         | Description                  |
| ------ | ------------- | -------------------------------- | -------------------------------- | ---------------------------- |
| POST   | /submit       | `{ prompt: string }`             | SSE stream                       | Submit prompt, stream events |
| POST   | /command      | `{ name: string, args: string }` | `ICommandResult` JSON            | Execute system command       |
| POST   | /abort        | —                                | `{ ok: true }`                   | Abort current execution      |
| POST   | /cancel-queue | —                                | `{ ok: true }`                   | Cancel queued prompt         |
| GET    | /messages     | —                                | `TUniversalMessage[]` JSON       | Get message history          |
| GET    | /context      | —                                | `IContextWindowState` JSON       | Get context window state     |
| GET    | /executing    | —                                | `{ executing: boolean }` JSON    | Check if currently executing |
| GET    | /pending      | —                                | `{ pending: string\|null }` JSON | Get queued prompt            |

### SSE Event Types (POST /submit)

| Event         | Data                      | Description             |
| ------------- | ------------------------- | ----------------------- |
| `text_delta`  | `{ delta: string }`       | Streaming text chunk    |
| `tool_start`  | `IToolState`              | Tool execution began    |
| `tool_end`    | `IToolState`              | Tool execution finished |
| `thinking`    | `{ isThinking: boolean }` | Execution state changed |
| `complete`    | `IExecutionResult`        | Prompt completed        |
| `interrupted` | `IExecutionResult`        | Execution was aborted   |
| `error`       | `{ message: string }`     | Execution error         |

## Dependencies

- `@robota-sdk/agent-sdk` — `InteractiveSession`, `SystemCommandExecutor`
- `hono` — HTTP framework
