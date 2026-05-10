# Agent Server Specification

## Scope

AI provider proxy server with Playground WebSocket support. Deployable standalone or as Firebase Functions.

Key endpoints:

- `GET /` -- server info
- `GET /health` -- global liveness check
- `GET /api/v1/remote/health` -- remote health check with provider list
- `POST /api/v1/remote/chat` -- provider chat proxy
- `GET /api/v1/remote/ws/status` -- WebSocket connection stats
- `WS /ws/playground` -- Playground WebSocket (auth + broadcast)

Machine-readable API contract: [`openapi.yaml`](../openapi.yaml) (OpenAPI 3.1).

## Boundaries

- Host-level composition only. Core package contracts remain in their respective packages.
- Provider chat/stream routes are inlined (formerly in `@robota-sdk/agent-remote-server-core`, now deleted).
- Provider secrets and direct vendor API calls stay server-side in this app.
- Owns HTTP/WebSocket routing, CORS, rate limiting, and process lifecycle composition, but does not
  own provider semantics, session policy, or Playground UI state.

## Architecture Overview

`createApp()` composes Express with helmet, CORS, rate limiting, and body parsing. Registers AI providers (OpenAI, Anthropic, Google) based on environment API keys. Inlines provider chat/health routes. Creates `PlaygroundWebSocketServer` on the HTTP server.

Firebase Functions entry point (`src/index.ts`) wraps `createApp()` for serverless deployment.

## Type Ownership

This app is SSOT for:

- `IPlaygroundClient` -- WebSocket client connection state (id, userId, sessionId, authentication).
- `PlaygroundWebSocketServer` -- WebSocket server managing playground connections, authentication, and message routing.
- `resolveApiDocsEnabled` -- Environment flag resolution utility.

## Public API Surface

This is a private app with no published package surface. Internal exports:

| Export                         | Kind               | Description                            |
| ------------------------------ | ------------------ | -------------------------------------- |
| `createApp`                    | function           | Creates configured Express application |
| `startServer`                  | function           | Standalone HTTP+WS server bootstrap    |
| `PlaygroundWebSocketServer`    | class              | WebSocket server for playground        |
| `setPlaygroundWebSocketServer` | function           | Sets global WS server reference        |
| `api`, `health`                | Firebase Functions | Firebase Functions entry points        |

## Extension Points

- **Provider registration**: Add new AI providers by checking for additional `*_API_KEY` environment variables in `createApp()`.
- **Environment configuration**: `CORS_ORIGINS`, `RATE_LIMIT_MAX`, `PORT`, `API_DOCS_ENABLED`.

## Error Taxonomy

| Source               | Response                                             | Condition                     |
| -------------------- | ---------------------------------------------------- | ----------------------------- |
| Rate limiter         | HTTP 429 `{ error: 'Too many requests' }`            | Rate limit exceeded           |
| 404 handler          | HTTP 404 `{ error: 'Not Found' }`                    | Unknown route                 |
| Global error handler | HTTP 500/statusCode `{ error: { message, status } }` | Unhandled errors              |
| WebSocket            | `{ type: 'auth', data: { error } }`                  | Invalid message, auth failure |

## Class Contract Registry

### Classes

| Class                       | Kind       | Location                  | Notes                                                   |
| --------------------------- | ---------- | ------------------------- | ------------------------------------------------------- |
| `PlaygroundWebSocketServer` | standalone | `src/websocket-server.ts` | WebSocket server for playground real-time communication |

### Cross-Package Port Consumers

| Port (Owner)            | Consumer                             | Location     |
| ----------------------- | ------------------------------------ | ------------ |
| `RemoteServer` (remote) | `createApp`                          | `src/app.ts` |
| `IAIProvider` (agents)  | Provider registration in `createApp` | `src/app.ts` |

## Test Strategy

- **Test framework**: Vitest configured with `--passWithNoTests`.
- **Current state**: No test files exist in this app.
- Recommended: integration tests for route registration, WebSocket auth flow, and health endpoint.
