# HTTP Transport

Expose InteractiveSession over REST API using Hono.

## Basic Setup

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';
import { serve } from '@hono/node-server';

const session = new InteractiveSession({ cwd: process.cwd(), provider });

const transport = createHttpTransport();
session.attachTransport(transport);
await transport.start();

serve({ fetch: transport.getApp().fetch, port: 3000 });
```

## Endpoints

| Method | Path          | Description                          |
| ------ | ------------- | ------------------------------------ |
| POST   | /submit       | Submit prompt, stream events via SSE |
| POST   | /command      | Execute system command               |
| POST   | /abort        | Abort current execution              |
| POST   | /cancel-queue | Cancel queued prompt                 |
| GET    | /messages     | Get message history                  |
| GET    | /context      | Get context window state             |
| GET    | /executing    | Check if executing                   |
| GET    | /pending      | Get pending queued prompt            |

## SSE Events (POST /submit)

```bash
curl -X POST http://localhost:3000/submit \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain this project"}'
```

Events: text_delta, tool_start, tool_end, thinking, complete, interrupted, error.

## Advanced: Session Factory

For per-request sessions (e.g., multi-tenant):

```typescript
import { createAgentRoutes } from '@robota-sdk/agent-transport-http';

const routes = createAgentRoutes({
  sessionFactory: (req) => resolveSessionByToken(req),
});
```
