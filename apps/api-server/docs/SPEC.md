# API Server Host Specification

## Scope

Hosts the Robota API server with two independent server modes:

1. **Remote API server** (`src/server.ts`) -- Express.js application proxying AI provider requests via `@robota-sdk/remote-server-core`, with WebSocket support for Playground real-time communication. Deployable standalone or as Firebase Functions.
2. **DAG dev server** (`src/dag-dev-server.ts`) -- bootstraps the DAG development runtime via `@robota-sdk/dag-server-core` with bundled node definitions, file-based storage, and local asset management.

Key endpoints (Remote mode):
- `POST /api/v1/remote/chat` -- chat completion proxy
- `POST /api/v1/remote/stream` -- SSE streaming proxy
- `GET /api/v1/remote/health` -- health check
- `GET /api/v1/remote/providers/:provider/capabilities` -- provider capabilities
- `WS /ws/playground` -- WebSocket for playground real-time

Key endpoints (DAG mode):
- `POST /v1/dag/runs` -- create and start DAG run
- `DELETE /v1/dag/runs/:dagRunId` -- cleanup run
- `DELETE /v1/dag/dev/definitions/:dagId` -- cleanup definition

## Boundaries

- Host-level composition only. Core package contracts remain in their respective packages.
- Does not own `RemoteServer` routes (owned by `@robota-sdk/remote-server-core`).
- Does not own DAG server routes (owned by `@robota-sdk/dag-server-core`).
- `.local-assets/` and `.dag-storage/` are local runtime data and must never be committed.

## Architecture Overview

Two independent entry points sharing the same package:

**Remote mode** (`pnpm dev` / `pnpm start`): `createApp()` composes Express with helmet, CORS, rate limiting, and body parsing. Registers AI providers (OpenAI, Anthropic, Google) based on environment API keys. Mounts remote routes via `registerRemoteServerRoutes`. Creates `PlaygroundWebSocketServer` on the HTTP server.

**DAG mode** (`pnpm dag:dev` / `pnpm dag:start`): `bootstrapDagDevServer()` registers all bundled node definitions (`InputNode`, `TransformNode`, `LlmTextOpenAiNode`, etc.), creates file storage and asset store, then starts the DAG server via `startDagServer`.

Firebase Functions entry point (`src/index.ts`) wraps `createApp()` for serverless deployment.

## Type Ownership

This app is SSOT for:

- `IPlaygroundClient` -- WebSocket client connection state (id, userId, sessionId, authentication).
- `PlaygroundWebSocketServer` -- WebSocket server managing playground connections, authentication, and message routing.
- Environment variable resolution functions (`resolveApiDocsEnabled`, `resolvePort`, `resolveDagStorageRoot`, etc.).

## Public API Surface

This is a private app with no published package surface. Internal exports:

| Export | Kind | Description |
|--------|------|-------------|
| `createApp` | function | Creates configured Express application |
| `startServer` | function | Standalone HTTP+WS server bootstrap |
| `PlaygroundWebSocketServer` | class | WebSocket server for playground |
| `setPlaygroundWebSocketServer` | function | Sets global WS server reference |
| `api`, `health` | Firebase Functions | Firebase Functions entry points |
| `LocalFsAssetStore` | class | Local filesystem asset storage for DAG mode |

## Extension Points

- **Provider registration**: Add new AI providers by checking for additional `*_API_KEY` environment variables in `createApp()`.
- **Node definitions**: Add new DAG node types by importing and registering them in `bootstrapDagDevServer()`.
- **Environment configuration**: `CORS_ORIGINS`, `RATE_LIMIT_MAX`, `PORT`, `DAG_DEV_PORT`, `DAG_STORAGE_ROOT`, `ASSET_STORAGE_ROOT`, `API_DOCS_ENABLED`, `DAG_REQUEST_BODY_LIMIT`, `DAG_DEFAULT_TIMEOUT_MS`, `DAG_SSE_KEEPALIVE_MS`.

## Error Taxonomy

| Source | Response | Condition |
|--------|----------|-----------|
| Rate limiter | HTTP 429 `{ error: 'Too many requests' }` | Rate limit exceeded |
| 404 handler | HTTP 404 `{ error: 'Not Found' }` | Unknown route |
| Global error handler | HTTP 500/statusCode `{ error: { message, status } }` | Unhandled errors |
| WebSocket | `{ type: 'auth', data: { error } }` | Invalid message, auth failure |
| DAG bootstrap | Process exit(1) | Server startup failure |

## Class Contract Registry

### Interface Implementations

| Interface | Implementor | Kind | Location |
|-----------|------------|------|----------|
| `IAssetStore` (dag-server-core) | `LocalFsAssetStore` | production | `src/services/local-fs-asset-store.ts` |

### Inheritance Chains

None. Classes are standalone.

### Classes

| Class | Kind | Location | Notes |
|-------|------|----------|-------|
| `PlaygroundWebSocketServer` | standalone | `src/websocket-server.ts` | WebSocket server for playground real-time communication |
| `LocalFsAssetStore` | `IAssetStore` impl | `src/services/local-fs-asset-store.ts` | Local filesystem asset storage |

### Cross-Package Port Consumers

| Port (Owner) | Consumer | Location |
|--------------|---------|----------|
| `IAssetStore` (dag-server-core) | `LocalFsAssetStore` | `src/services/local-fs-asset-store.ts` |
| `RemoteServer` (remote) | `createApp` | `src/server.ts` |
| `startDagServer` (dag-server-core) | `bootstrapDagDevServer` | `src/dag-dev-server.ts` |
| `IAIProvider` (agents) | Provider registration in `createApp` | `src/server.ts` |

## Test Strategy

- **Test framework**: Vitest configured with `--passWithNoTests`.
- **Current state**: No test files exist in this app.
- **Coverage gaps**: No tests for Express middleware composition, WebSocket authentication flow, provider registration, DAG server bootstrap, or Firebase Functions entry point.
- Recommended: integration tests for route registration, WebSocket auth flow, and health endpoint.
