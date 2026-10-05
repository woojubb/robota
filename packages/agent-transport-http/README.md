# @robota-sdk/agent-transport-http

HTTP transport for the Robota SDK, built on [Hono](https://hono.dev). It exposes a running agent session
as a small set of HTTP routes, so a browser, another service, or any HTTP client can submit prompts,
stream the agent's response as Server-Sent Events, and read the session's state. The result is a Hono
app rather than a listening server: you mount it in your own Hono application or serve it yourself.

## Installation

```bash
npm install @robota-sdk/agent-transport-http
```

Requires Node.js 22.12 or later. To serve or mount the routes yourself, also add `hono` to your
application. `@robota-sdk/agent-transport` is only needed if you import its admission helpers
directly (see below).

## Usage

`createHttpTransport` wraps the routes as a transport with the standard `attach` / `start` / `stop`
lifecycle. After `start()`, `getApp()` returns the Hono app to serve.

```typescript
import { createHttpTransport } from '@robota-sdk/agent-transport-http';
import type { IHttpTransportSession } from '@robota-sdk/agent-transport-http';

declare const session: IHttpTransportSession; // e.g. an InteractiveSession from @robota-sdk/agent-framework

const transport = createHttpTransport({ basePath: '/agent' });
transport.attach(session);
await transport.start();

const app = transport.getApp(); // a Hono app; serve it, or mount it in your own app
const token = transport.getAdmissionToken(); // hand this to your client
```

Every request must carry `Authorization: Bearer <token>`; anything else is answered `401` before it
reaches a route. When you omit `admission`, a random per-launch token is minted and
`getAdmissionToken()` returns it. Pass `admission: { token }` to use a token you chose, or
`admission: { open: true, openReason: '…' }` to run without a credential when something in front of
the routes (a gateway, your own auth middleware) already decides who may reach them. `openReason` is
required, and a token together with `open: true` is rejected.

### Mounting the routes in your own app

`createAgentRoutes` returns the same routes as a Hono router. It resolves the session per request
through `sessionFactory`, which receives the Hono request context, so one app can serve several
sessions (for example, looked up from a request header). Here `admission` is required. A token minted
inside `createAgentRoutes` could never be read back, so pass one you know: your own, or the result of
`resolveAdmission()` from `@robota-sdk/agent-transport/node`.

```typescript
import { createAgentRoutes } from '@robota-sdk/agent-transport-http';
import type { IHttpTransportSession } from '@robota-sdk/agent-transport-http';
import { Hono } from 'hono';

declare const session: IHttpTransportSession;
declare const agentToken: string; // shared with your clients out of band

const app = new Hono();
app.route(
  '/agent',
  createAgentRoutes({
    sessionFactory: () => session, // may also look the session up from the request context
    admission: { token: agentToken },
  }),
);
```

`sessionFactory` may return a new wrapper object on each call. `/submit` keys its one-turn-at-a-time
check on `getSession().getSessionId()`, not on object identity.

## Routes

| Method | Path            | Purpose                                                                                                                                                                                           |
| ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/submit`       | Body `{ "prompt": string }`. Runs a turn and streams `text_delta`, `tool_start`, `tool_end`, `thinking`, then `complete`, `interrupted` or `error` as SSE. `409` while a turn is already running. |
| POST   | `/command`      | Body `{ "name": string, "args"?: string }`. Runs a session command on behalf of a remote caller.                                                                                                  |
| POST   | `/abort`        | Aborts the running turn.                                                                                                                                                                          |
| POST   | `/cancel-queue` | Drops the queued prompt.                                                                                                                                                                          |
| GET    | `/messages`     | The conversation history.                                                                                                                                                                         |
| GET    | `/context`      | The context-window state.                                                                                                                                                                         |
| GET    | `/executing`    | `{ "executing": boolean }`, using the same rule `/submit` uses to answer `409`.                                                                                                                   |
| GET    | `/pending`      | `{ "pending": … }`, the queued prompt, if any.                                                                                                                                                    |

Paths are relative to where the routes are mounted (`basePath`, or the prefix you pass to
`app.route`).

## Exports

| Symbol                   | Kind      | Description                                                                                           |
| ------------------------ | --------- | ----------------------------------------------------------------------------------------------------- |
| `createHttpTransport`    | function  | `(options?: IHttpTransportOptions) => IHttpTransport`                                                 |
| `createAgentRoutes`      | function  | `(options: IAgentRoutesOptions) => Hono`                                                              |
| `IHttpTransportOptions`  | interface | `{ basePath?, admission?, onStreamFailure?, attribution? }`                                           |
| `IHttpTransport`         | interface | The transport; adds `getApp()` and `getAdmissionToken()` to the standard transport lifecycle          |
| `IAgentRoutesOptions`    | interface | `{ sessionFactory, admission, onStreamFailure?, attribution? }`                                       |
| `TSessionFactory`        | type      | `(c: Context) => IHttpTransportSession \| Promise<IHttpTransportSession>`                             |
| `IHttpTransportSession`  | interface | The session capabilities the routes use; a full interactive session satisfies it                      |
| `TTurnAttribution`       | type      | Host-assigned `driverId`/`surface` for `/submit` turns; never read from the request                   |
| `TStreamFailureListener` | type      | Receives the details of a stream that fails after headers were sent (the client sees a generic error) |

## Related

- [`@robota-sdk/agent-transport`](../agent-transport/README.md) — the admission helpers these routes use.
- [`@robota-sdk/agent-transport-ws`](../agent-transport-ws/README.md) — the WebSocket transport, which
  carries the full session protocol (this HTTP surface covers a subset).
- [docs/SPEC.md](./docs/SPEC.md) — package contract and invariants.
