# @robota-sdk/agent-transport-http

HTTP transport (built on [Hono](https://hono.dev)) for the Robota SDK. It exposes a running
`IInteractiveSession` over HTTP routes so a browser, another service, or any HTTP client can
drive an agent session.

## Installation

```bash
npm install @robota-sdk/agent-transport-http
# or
pnpm add @robota-sdk/agent-transport-http
```

## Usage

`createAgentRoutes` builds the agent route handlers from a `sessionFactory` that resolves an
`IInteractiveSession` per request (e.g. by auth token or session id). `createHttpTransport`
wraps them as a mountable transport with an optional `basePath`.

```typescript
import { createAgentRoutes } from '@robota-sdk/agent-transport-http';
import { Hono } from 'hono';

const app = new Hono();
app.route(
  '/agent',
  createAgentRoutes({
    // Resolve (or create) the session for this request.
    sessionFactory: (c) => resolveSessionForRequest(c),
  }),
);
```

## Exports

| Symbol                  | Kind      | Description                                               |
| ----------------------- | --------- | --------------------------------------------------------- |
| `createHttpTransport`   | function  | `(options?: IHttpTransportOptions)` — mountable transport |
| `createAgentRoutes`     | function  | `(options: IAgentRoutesOptions)` — Hono agent routes      |
| `IHttpTransportOptions` | interface | `{ basePath?: string }`                                   |
| `IAgentRoutesOptions`   | interface | `{ sessionFactory: TSessionFactory }`                     |
| `TSessionFactory`       | type      | Resolves an `IInteractiveSession` per request             |

See [docs/SPEC.md](./docs/SPEC.md) for the full contract and route surface.
