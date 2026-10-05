# HTTP Transport

Serve an `InteractiveSession` over REST endpoints with `@robota-sdk/agent-transport-http`. Prompts
stream back as Server-Sent Events. The routes are a [Hono](https://hono.dev) app, so you can serve
them with any Hono adapter.

## Basic setup

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
// The session initializes in the background; /submit refuses (500) until it has.
await session.whenInitialized();

// With no `admission` option the transport mints a credential, and every request must present it
// — including your own. Print it, or hand it to the client you start.
console.log('token:', transport.getAdmissionToken());

serve({ fetch: transport.getApp().fetch, port: 3000 });
```

A request without the token gets `401`. The transport reaches `session.submit` and
`session.executeCommand`, so it is closed unless you open it: pass
`admission: { token: '…' }` to choose the credential, or `admission: { open: true, openReason: '…' }`
when something in front of it already decides who may connect. `getAdmissionToken()` returns `null`
for an open transport.

A client that can answer permission and ask prompts sends `receivePrompts: true` with `/submit` (see
[Answering prompts](#answering-prompts)). Without it, a tool call that would ask and that no other
surface answers is denied, so a client that never answers relies on the session's `permissionMode`.

## Endpoints

| Method | Path          | Description                          |
| ------ | ------------- | ------------------------------------ |
| POST   | /submit       | Submit prompt, stream events via SSE |
| POST   | /command      | Execute a session command            |
| POST   | /abort        | Abort current execution              |
| POST   | /cancel-queue | Cancel queued prompt                 |
| GET    | /messages     | Get message history                  |
| GET    | /context      | Get context window state             |
| GET    | /executing    | Check if executing                   |
| GET    | /pending      | Get pending queued prompt            |
| GET    | /prompts      | List open permission/ask prompts     |
| POST   | /prompts/:id  | Answer an open prompt                |

## Submitting a prompt

```bash
# $TOKEN is what transport.getAdmissionToken() printed at startup.
curl -X POST http://localhost:3000/submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain this project"}'
```

The response is an SSE stream with these events: `text_delta`, `tool_start`, `tool_end`, `thinking`,
`complete`, `interrupted`, `error`.

## Answering prompts

With `"receivePrompts": true` the stream also carries `permission_request` and `ask_request`, each
with an `id`, and `prompt_resolved` once a prompt is settled. Answer while the stream stays open:

```bash
curl -N -X POST http://localhost:3000/submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "List the files here", "receivePrompts": true}'

# From another request, using the id from the permission_request event:
curl -X POST http://localhost:3000/prompts/p1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"result": true}'
```

A permission takes `result`: `true`, `false`, `"allow-session"` or `"allow-project"`. An ask takes
`response`: `{ "type": "answer", "values": [...], "text"?: "..." }` or `{ "type": "cancelled" }`.
`GET /prompts` lists the prompts still open, for a client that connects after one was asked. An id
that is not open gets `404`. Closing the stream aborts the turn and denies what it left open.

## Session per request

`createAgentRoutes()` gives you the same routes with a session chosen per request — for example one
session per signed-in user. Mount them on your own Hono app.

```typescript
import { createAgentRoutes, type TSessionFactory } from '@robota-sdk/agent-transport-http';

// Receives each request's Hono context and returns the session that should handle it.
declare const resolveSession: TSessionFactory;

const routes = createAgentRoutes({
  sessionFactory: resolveSession,
  // Required. Every request must present this token before the session is reached.
  admission: { token: requiredEnv('AGENT_HTTP_TOKEN') },
});

// An empty string is not a token: it would make each process mint its own random one.
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`${name} is not set — the HTTP routes have no credential to require.`);
  return value;
}
```

[examples/capabilities/multi-surface-deploy](../../examples/capabilities/multi-surface-deploy/README.md)
serves one session over HTTP and WebSocket at the same time.
