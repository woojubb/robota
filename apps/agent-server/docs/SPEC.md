# Agent Server Specification

## Scope

AI provider proxy server with Playground WebSocket support. Deployable standalone or as Firebase Functions.

Key endpoints:

- `GET /` -- server info
- `GET /health` -- global liveness check
- `GET /api/v1/remote/health` -- remote health check with provider list
- `POST /api/v1/remote/chat` -- provider chat proxy (server-side API key)
- `POST /api/v1/byok/chat` -- BYOK chat proxy (caller-supplied API key via `X-Provider-API-Key`)
- `GET /api/v1/remote/ws/status` -- WebSocket connection stats
- `WS /ws/playground` -- Playground WebSocket (auth + broadcast)
- `GET /api/playground/health` -- playground service health
- `GET /api/playground/catalog/providers` -- provider & model catalog
- `GET /api/playground/catalog/tools` -- tool catalog
- `GET /api/playground/catalog/skills` -- skill catalog
- `POST /api/playground/execute` -- SSE streaming agent execution (stateless/legacy)
- `GET /api/playground/sessions` -- list resumable sessions
- `POST /api/playground/sessions` -- create `InteractiveSession`
- `POST /api/playground/sessions/:id/submit` -- submit message to session (SSE stream)
- `DELETE /api/playground/sessions/:id` -- destroy session

Machine-readable API contract: [`openapi.yaml`](../openapi.yaml) (OpenAPI 3.1).

## Boundaries

- Host-level composition only. Core package contracts remain in their respective packages.
- Provider chat/stream routes are inlined (formerly in `@robota-sdk/agent-remote-server-core`, now deleted).
- Provider secrets and direct vendor API calls stay server-side in this app.
- Owns HTTP/WebSocket routing, CORS, rate limiting, and process lifecycle composition, but does not
  own provider semantics, session policy, or Playground UI state.

## Architecture Overview

`createApp()` composes Express with helmet, CORS, rate limiting, and body parsing. Registers AI providers (OpenAI, Anthropic, Google) based on environment API keys. Inlines provider chat/health routes and a BYOK endpoint (whose inline `switch` additionally supports DeepSeek per request). Creates `PlaygroundWebSocketServer` on the HTTP server.

Playground routes are delegated to `playgroundRouter` (`src/routes/playground.ts`), which applies the `byokKeySanitizer` middleware and mounts catalog endpoints, stateless execute, and session lifecycle routes.

Session layer (`src/session/`):

- `playground-session-store.ts` — in-memory `Map<id, InteractiveSession>` with 30-minute idle timeout.
- `persistent-session-store.ts` — lazily initialises a `IInteractiveSessionStore` (from `@robota-sdk/agent-framework`) for resumable sessions.

Catalog layer (`src/catalog/`):

- `providers.ts` — static provider/model definitions with runtime server-key availability check.
- `tools.ts` — built-in tool registry (currently: `current-time`).
- `skills.ts` — built-in skill catalog (currently: `code-reviewer`, `summarizer`).

Firebase Functions entry point (`src/index.ts`) wraps `createApp()` for serverless deployment.

## Type Ownership

This app is SSOT for:

- `IPlaygroundClient` -- WebSocket client connection state (id, userId, sessionId, authentication). `src/websocket-server.ts`
- `IModelEntry` -- model descriptor (id, name, contextWindow, supportsTools). `src/catalog/providers.ts`
- `IProviderEntry` -- provider descriptor with model list and BYOK/server-key flags. `src/catalog/providers.ts`
- `IProviderCatalogResponse` -- response envelope for provider catalog endpoint. `src/catalog/providers.ts`
- `IToolCatalogEntry` -- tool metadata (id, name, description, inputSchema, category). `src/catalog/tools.ts`
- `IToolCatalogResponse` -- response envelope for tool catalog endpoint. `src/catalog/tools.ts`
- `IServerToolEntry` -- `IToolCatalogEntry` extended with `execute` function (server-side only). `src/catalog/tools.ts`
- `ISkillCatalogEntry` -- skill metadata with `skillMdContent`. `src/catalog/skills.ts`
- `ISkillCatalogResponse` -- response envelope for skill catalog endpoint. `src/catalog/skills.ts`
- `IRestoredMessage` -- serialised message shape returned on session resume. `src/routes/handlers/playground-session-create.ts`
- `resolveApiDocsEnabled` -- environment flag resolution utility. `src/utils/env-flags.ts`

## Public API Surface

This is a private app with no published package surface. Internal exports:

| Export                         | Kind               | Location                                  | Description                                     |
| ------------------------------ | ------------------ | ----------------------------------------- | ----------------------------------------------- |
| `createApp`                    | function           | `src/app.ts`                              | Creates configured Express application          |
| `startServer`                  | function           | `src/server.ts`                           | Standalone HTTP+WS server bootstrap             |
| `setPlaygroundWebSocketServer` | function           | `src/app.ts`                              | Sets global WS server reference                 |
| `PlaygroundWebSocketServer`    | class              | `src/websocket-server.ts`                 | WebSocket server for playground                 |
| `playgroundRouter`             | Express `IRouter`  | `src/routes/playground.ts`                | Playground REST routes (catalog + sessions)     |
| `getProviderCatalog`           | function           | `src/catalog/providers.ts`                | Returns `IProviderCatalogResponse`              |
| `getToolCatalog`               | function           | `src/catalog/tools.ts`                    | Returns `IToolCatalogResponse`                  |
| `getToolRegistry`              | function           | `src/catalog/tools.ts`                    | Returns `Map<string, IServerToolEntry>`         |
| `getSkillCatalog`              | function           | `src/catalog/skills.ts`                   | Returns `ISkillCatalogResponse`                 |
| `getSkillById`                 | function           | `src/catalog/skills.ts`                   | Looks up a skill by id                          |
| `addSession`                   | function           | `src/session/playground-session-store.ts` | Registers an in-memory session                  |
| `getSession`                   | function           | `src/session/playground-session-store.ts` | Retrieves session and resets idle timer         |
| `destroySession`               | function           | `src/session/playground-session-store.ts` | Shuts down and removes a session                |
| `sessionCount`                 | function           | `src/session/playground-session-store.ts` | Returns current session count                   |
| `getPlaygroundSessionStore`    | function           | `src/session/persistent-session-store.ts` | Lazy-init `IInteractiveSessionStore`            |
| `byokKeySanitizer`             | Express middleware | `src/middleware/byok-key-sanitizer.ts`    | Moves BYOK key to `req.byokKey`, removes header |
| `api`, `health`                | Firebase Functions | `src/index.ts`                            | Firebase Functions entry points                 |

## Extension Points

- **Provider registration**: In `createApp()`, server-key providers are registered by inline `if` blocks that check `*_API_KEY` environment variables, and the BYOK endpoint selects a per-request provider via an inline `switch` on the caller's provider name — add a new provider by extending both. Playground routes construct providers through `createProvider()` in `src/routes/handlers/playground-session-create.ts` and `playground-execute.ts`.
- **Tool catalog**: Add entries to `TOOL_REGISTRY` in `src/catalog/tools.ts`.
- **Skill catalog**: Add entries to `SKILL_CATALOG` in `src/catalog/skills.ts`.
- **Environment configuration**: `CORS_ORIGINS`, `RATE_LIMIT_MAX`, `PORT`, `API_DOCS_ENABLED`, `JWT_SECRET`.

## Error Taxonomy

| Source                 | Response                                             | Condition                                     |
| ---------------------- | ---------------------------------------------------- | --------------------------------------------- |
| Rate limiter           | HTTP 429 `{ error: 'Too many requests' }`            | Rate limit exceeded                           |
| 404 handler            | HTTP 404 `{ error: 'Not Found' }`                    | Unknown route                                 |
| Global error handler   | HTTP 500/statusCode `{ error: { message, status } }` | Unhandled errors                              |
| WebSocket              | `{ type: 'error', data: { error } }`                 | Invalid message format, auth failure          |
| Chat/BYOK validation   | HTTP 400 `{ error: '...' }`                          | Missing/invalid provider, messages, or apiKey |
| Chat unknown provider  | HTTP 400 `{ error: 'Unknown provider: ...' }`        | Provider not registered (server-key mode)     |
| BYOK unsupported       | HTTP 400 `{ error: 'Unsupported provider: ...' }`    | Provider not in BYOK switch case              |
| No API key available   | HTTP 400 `{ error: 'No API key available for ...' }` | Neither BYOK header nor env key present       |
| Session not found      | HTTP 404 `{ error: 'Session not found: ...' }`       | `sessions/:id/submit` with unknown session id |
| Invalid RATE_LIMIT_MAX | Server startup throws `Error`                        | Env var is non-numeric or <= 0                |

## Class Contract Registry

### Classes

| Class                       | Kind       | Location                  | Notes                                                   |
| --------------------------- | ---------- | ------------------------- | ------------------------------------------------------- |
| `PlaygroundWebSocketServer` | standalone | `src/websocket-server.ts` | WebSocket server for playground real-time communication |

### Cross-Package Port Consumers

| Port (interface/type owner)                                    | Consumer                                                 | Location                                      |
| -------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `IAIProvider` (`@robota-sdk/agent-core`)                       | Provider instantiation in `createApp` and route handlers | `src/app.ts`, `src/routes/handlers/`          |
| `InteractiveSession` (`@robota-sdk/agent-framework`)           | Session create/submit/destroy handlers                   | `src/routes/handlers/playground-session-*.ts` |
| `IInteractiveSessionStore` (`@robota-sdk/agent-framework`)     | `getPlaygroundSessionStore`                              | `src/session/persistent-session-store.ts`     |
| `IPlaygroundWebSocketMessage` (`@robota-sdk/agent-playground`) | Message parsing in `PlaygroundWebSocketServer`           | `src/websocket-server.ts`                     |

## Graceful Shutdown

Signal handling is implemented in `src/server.ts`. The process must shut down cleanly on the
following signals:

| Signal  | Handler      |
| ------- | ------------ |
| SIGTERM | `shutdown()` |
| SIGINT  | `shutdown()` |

Shutdown sequence:

1. `server.close()` — stop accepting new HTTP connections; wait for in-flight requests to drain.
2. `wsServer.close()` — close the WebSocket server and tear down all active WebSocket connections.
3. `process.exit(0)` — exit cleanly after HTTP server close callback fires.

Timeout: if the drain does not complete within **30 seconds** (`GRACEFUL_SHUTDOWN_TIMEOUT_MS`),
force-exit with `process.exit(1)`.

Abnormal exit: if the server fails to start (`startServer()` throws), log the error and call
`process.exit(1)` immediately without attempting graceful shutdown.

## Test Strategy

- **Test framework**: Vitest (`pnpm test` runs `vitest run --passWithNoTests`).
- **Current state**: 2 test files exist.
  - `src/__tests__/app.test.ts` — HTTP route integration tests (health, remote health, root info, WS status, chat validation, 404, CORS headers).
  - `src/__tests__/websocket-server.test.ts` — Unit/integration tests for `PlaygroundWebSocketServer` (close clears interval, getStats returns zero counts, empty-token rejection — SEC-001 regression).
- **Coverage gaps**: No tests for playground session lifecycle routes, catalog endpoints, or BYOK chat endpoint.
