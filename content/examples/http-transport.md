# HTTP Transport

Expose InteractiveSession over REST API using Hono.

## Basic Setup

<!-- doc-example-skip: requires the host app's hono dependency -->

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';
import { serve } from '@hono/node-server';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const session = new InteractiveSession({ cwd: process.cwd(), provider });

const transport = createHttpTransport();
session.attachTransport(transport);
await transport.start();

// SEC-008: with no `admission` option the transport MINTS a credential rather than serving open.
// Every request must present it, including your own — so print it, or hand it to whatever you are
// spawning. `null` here means the transport was deliberately opened; see "Admission" below.
console.log('token:', transport.getAdmissionToken());

serve({ fetch: transport.getApp().fetch, port: 3000 });
```

Every example below sends that token. A request without it gets `401`, and that is the default: a
transport reaches `session.submit` and `session.executeCommand`, so it is not open unless you say so.

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
# $TOKEN is what `transport.getAdmissionToken()` printed at startup. Without the header this is 401.
curl -X POST http://localhost:3000/submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain this project"}'
```

Events: text_delta, tool_start, tool_end, thinking, complete, interrupted, error.

## Advanced: Session Factory

For per-request sessions (e.g., multi-tenant):

```typescript
import { createAgentRoutes, type TSessionFactory } from '@robota-sdk/agent-transport-http';

declare const resolveSessionByToken: TSessionFactory;

const routes = createAgentRoutes({
  sessionFactory: (req) => resolveSessionByToken(req),
  // SEC-008: required. Every request must present this credential, or the route refuses it before
  // the session is reached. Pass `{ open: true, openReason: '…' }` only if something in front of
  // this already decides who may reach it — and say what that is.
  //
  // Read the variable STRICTLY. An empty string is not a token: `resolveAdmission` treats it as "no
  // credential given" and mints a fresh random one per process, so a reader who forgot to set the
  // variable would believe a fixed shared credential was in effect while every process had its own.
  // Safe, but silent — and silent is the half this whole change exists to remove.
  admission: { token: requiredEnv('AGENT_HTTP_TOKEN') },
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set — the HTTP transport has no credential to require.`);
  return value;
}
```
