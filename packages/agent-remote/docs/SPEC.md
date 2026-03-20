# Remote Specification

## Scope

Owns the remote execution system for Robota SDK. Provides client-side `RemoteExecutor` (implements `IExecutor`) for proxying AI provider calls to a remote server, server-side `RemoteServer` for hosting provider endpoints, HTTP/WebSocket transport layers, and shared message/transport type contracts. Dual-export: browser entry (`RemoteExecutor`, client utilities) and server entry (`RemoteServer`).

## Boundaries

- Does not own core agent/provider contracts (`IExecutor`, `IAIProvider`, `IAssistantMessage`); imports from `@robota-sdk/agent-core`.
- Does not own application-level server composition; that belongs to `apps/agent-server` and `@robota-sdk/agent-remote-server-core`.
- Keeps transport-specific behavior (HTTP, WebSocket) isolated behind the `ITransport` interface.

## Architecture Overview

Two entry points: `./` (browser/client, resolved via `browser.ts`) and `./server` (Node.js server, resolved via `server.ts`).

**Client side**: `SimpleRemoteExecutor` composes `HttpClient` for HTTP communication, validates requests, and maps responses to `IAssistantMessage`/`TUniversalMessage`. Supports both chat and streaming execution.

**Server side**: `RemoteServer` creates an Express router with `/health`, `/providers`, `/chat`, `/stream`, and `/providers/:provider/capabilities` endpoints. Delegates to registered `IAIProvider` instances.

**Transport layer**: `ITransport` interface with `HttpTransport` (internal) and `SimpleWebSocketTransport` implementations. `TransportError` provides structured transport-level errors. `HttpTransport` is used internally and is not exported from the public entry point.

## Type Ownership

This package is SSOT for the following types. Types marked **public** are exported from the `.` or `./server` entry points; others are internal SSOT used within this package.

- `IBasicMessage`, `IRequestMessage`, `IResponseMessage` -- message types (**public** from `.`).
- `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod` -- HTTP types (**public** from `.`).
- `IPlaygroundWebSocketMessage`, `TPlaygroundWebSocketMessageKind` -- playground WebSocket message contract (**public** from `.`).
- `ITransport`, `ITransportCapabilities`, `ITransportConfig`, `TransportError` -- transport contracts (internal).
- `ISimpleRemoteConfig` -- client executor configuration (internal).
- `IHttpClientConfig` -- HTTP client configuration (internal).
- `IRemoteServerConfig` -- server configuration (internal).
- `IRemoteConfig`, `IHealthStatus`, `IUserContext`, `IProviderStatus` -- shared configuration/status types (internal).
- `IChatRequestBody`, `IChatResponseData`, `ITransportRequest`, `ITransportResponse` -- transport payload shapes (internal).
- `IExtendedAssistantMessage`, `IExtendedChatExecutionRequest`, `IExtendedStreamExecutionRequest` -- extended request/response types (internal).
- `CommunicationProtocol` -- supported protocol enum (internal).
- `IEnhancedResponseMessage` -- enhanced message type (internal).

Note: `src/shared/types.ts` re-exports some `@robota-sdk/agent-core` types as compatibility shims. These re-exports are internal plumbing and do not represent SSOT ownership.

## Public API Surface

| Export                                                                | Kind      | Entry      | Description                              |
| --------------------------------------------------------------------- | --------- | ---------- | ---------------------------------------- |
| `RemoteExecutor` (`SimpleRemoteExecutor`)                             | class     | `.`        | `IExecutor` for remote AI provider calls |
| `HttpClient`                                                          | class     | `.`        | Low-level HTTP client                    |
| `WebSocketTransport` (`SimpleWebSocketTransport`)                     | class     | `.`        | WebSocket transport implementation       |
| `toRequestMessage`, `toResponseMessage`, etc.                         | functions | `.`        | Pure utility transformers                |
| `IBasicMessage`, `IRequestMessage`, `IResponseMessage`, `ITokenUsage` | types     | `.`        | Message types                            |
| `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod`          | types     | `.`        | HTTP types                               |
| `IPlaygroundWebSocketMessage`, `TPlaygroundWebSocketMessageKind`      | types     | `.`        | Playground WebSocket types               |
| `RemoteServer`                                                        | class     | `./server` | Express-based provider proxy server      |

Note: `HttpTransport` is not exported from the public entry point. It is used internally by the transport layer.

## Extension Points

- `ITransport` -- consumers can implement custom transport layers with `send`, `sendStream`, `connect`, `disconnect`.
- `IRemoteServerConfig.logger` -- inject custom `ILogger` into server.
- `ISimpleRemoteConfig.logger` -- inject custom `ILogger` into client executor.

## Error Taxonomy

| Source                 | Error                                       | Condition                          |
| ---------------------- | ------------------------------------------- | ---------------------------------- |
| `SimpleRemoteExecutor` | `Error('Messages array is required...')`    | Empty messages                     |
| `SimpleRemoteExecutor` | `Error('Provider is required')`             | Missing provider                   |
| `SimpleRemoteExecutor` | `Error('Model is required')`                | Missing model                      |
| `SimpleRemoteExecutor` | `Error('BaseURL is required...')`           | Missing server URL                 |
| `SimpleRemoteExecutor` | `Error('User API key is required...')`      | Missing API key                    |
| `TransportError`       | structured with `code`, `status`, `details` | Transport-level failures           |
| `RemoteServer`         | HTTP 400 JSON                               | Missing fields or unknown provider |
| `RemoteServer`         | HTTP 500 JSON                               | Provider execution failure         |

## Class Contract Registry

### Interface Implementations

| Interface            | Implementor                | Kind       | Location                                      |
| -------------------- | -------------------------- | ---------- | --------------------------------------------- |
| `IExecutor` (agents) | `SimpleRemoteExecutor`     | production | `src/client/remote-executor-simple.ts`        |
| `ITransport`         | `HttpTransport`            | production | `src/transport/http-transport.ts`             |
| `ITransport`         | `SimpleWebSocketTransport` | production | `src/transport/websocket-transport-simple.ts` |

### Inheritance Chains

| Base    | Derived          | Location                           | Notes                      |
| ------- | ---------------- | ---------------------------------- | -------------------------- |
| `Error` | `TransportError` | `src/transport/transport-error.ts` | Structured transport error |

### Cross-Package Port Consumers

| Port (Owner)           | Adapter                                | Location                               |
| ---------------------- | -------------------------------------- | -------------------------------------- |
| `IExecutor` (agents)   | `SimpleRemoteExecutor`                 | `src/client/remote-executor-simple.ts` |
| `ILogger` (agents)     | `RemoteServer`, `SimpleRemoteExecutor` | `src/server/`, `src/client/`           |
| `IAIProvider` (agents) | `RemoteServer` (registers providers)   | `src/server/remote-server.ts`          |

## Test Strategy

- **Unit tests**: 12 test files covering client, transport, server, shared types, and utilities:
  - `src/client/__tests__/`: `http-client.test.ts`, `http-client-chat.test.ts`, `remote-executor-simple.test.ts`, `request-handler-simple.test.ts`
  - `src/transport/__tests__/`: `http-transport.test.ts`, `websocket-transport-simple.test.ts`, `websocket-utils.test.ts`, `transport-error.test.ts`
  - `src/server/__tests__/remote-server.test.ts` -- RemoteServer route handling
  - `src/utils/__tests__/transformers.test.ts` -- pure utility function tests
  - `src/shared/__tests__/types.test.ts` -- shared type validation
  - `src/__tests__/exports.test.ts` -- public entry point exports
- **Coverage gaps**: Streaming paths have limited coverage.
