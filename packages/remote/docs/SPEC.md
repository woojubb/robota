# Remote Specification

## Scope

Owns the remote execution system for Robota SDK. Provides client-side `RemoteExecutor` (implements `IExecutor`) for proxying AI provider calls to a remote server, server-side `RemoteServer` for hosting provider endpoints, HTTP/WebSocket transport layers, and shared message/transport type contracts. Dual-export: browser entry (`RemoteExecutor`, client utilities) and server entry (`RemoteServer`).

## Boundaries

- Does not own core agent/provider contracts (`IExecutor`, `IAIProvider`, `IAssistantMessage`); imports from `@robota-sdk/agents`.
- Does not own application-level server composition; that belongs to `apps/api-server` and `@robota-sdk/remote-server-core`.
- Keeps transport-specific behavior (HTTP, WebSocket) isolated behind the `ITransport` interface.

## Architecture Overview

Two entry points: `./` (browser/client) and `./server` (Node.js server).

**Client side**: `SimpleRemoteExecutor` composes `HttpClient` for HTTP communication, validates requests, and maps responses to `IAssistantMessage`/`TUniversalMessage`. Supports both chat and streaming execution.

**Server side**: `RemoteServer` creates an Express router with `/health`, `/providers`, `/chat`, `/stream`, and `/providers/:provider/capabilities` endpoints. Delegates to registered `IAIProvider` instances.

**Transport layer**: `ITransport` interface with `HttpTransport` and `SimpleWebSocketTransport` implementations. `TransportError` provides structured transport-level errors.

## Type Ownership

This package is SSOT for:

- `IBasicMessage`, `IRequestMessage`, `IResponseMessage`, `IEnhancedResponseMessage` -- message types.
- `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod` -- HTTP types.
- `ITransport`, `ITransportCapabilities`, `ITransportConfig`, `TransportError` -- transport contracts.
- `ISimpleRemoteConfig` -- client executor configuration.
- `IRemoteServerConfig` -- server configuration.
- `IRemoteConfig`, `IHealthStatus`, `IUserContext`, `IProviderStatus` -- shared configuration/status types.
- `IChatRequestBody`, `IChatResponseData`, `ITransportRequest`, `ITransportResponse` -- transport payload shapes.
- `IExtendedAssistantMessage`, `IExtendedChatExecutionRequest`, `IExtendedStreamExecutionRequest` -- extended request/response types.
- `CommunicationProtocol` -- supported protocol enum.
- `IPlaygroundWebSocketMessage`, `TPlaygroundWebSocketMessageKind` -- playground WebSocket message contract.

## Public API Surface

| Export | Kind | Entry | Description |
|--------|------|-------|-------------|
| `RemoteExecutor` (`SimpleRemoteExecutor`) | class | `.` | `IExecutor` for remote AI provider calls |
| `HttpClient` | class | `.` | Low-level HTTP client |
| `WebSocketTransport` | class | `.` | WebSocket transport implementation |
| `toRequestMessage`, `toResponseMessage`, etc. | functions | `.` | Pure utility transformers |
| `RemoteServer` | class | `./server` | Express-based provider proxy server |

## Extension Points

- `ITransport` -- consumers can implement custom transport layers with `send`, `sendStream`, `connect`, `disconnect`.
- `IRemoteServerConfig.logger` -- inject custom `ILogger` into server.
- `ISimpleRemoteConfig.logger` -- inject custom `ILogger` into client executor.

## Error Taxonomy

| Source | Error | Condition |
|--------|-------|-----------|
| `SimpleRemoteExecutor` | `Error('Messages array is required...')` | Empty messages |
| `SimpleRemoteExecutor` | `Error('Provider is required')` | Missing provider |
| `SimpleRemoteExecutor` | `Error('Model is required')` | Missing model |
| `SimpleRemoteExecutor` | `Error('BaseURL is required...')` | Missing server URL |
| `SimpleRemoteExecutor` | `Error('User API key is required...')` | Missing API key |
| `TransportError` | structured with `code`, `status`, `details` | Transport-level failures |
| `RemoteServer` | HTTP 400 JSON | Missing fields or unknown provider |
| `RemoteServer` | HTTP 500 JSON | Provider execution failure |

## Class Contract Registry

### Interface Implementations

| Interface | Implementor | Kind | Location |
|-----------|------------|------|----------|
| `IExecutor` (agents) | `SimpleRemoteExecutor` | production | `src/client/remote-executor-simple.ts` |
| `ITransport` | `HttpTransport` | production | `src/transport/http-transport.ts` |
| `ITransport` | `SimpleWebSocketTransport` | production | `src/transport/websocket-transport.ts` |

### Inheritance Chains

| Base | Derived | Location | Notes |
|------|---------|----------|-------|
| `Error` | `TransportError` | `src/transport/transport-error.ts` | Structured transport error |

### Cross-Package Port Consumers

| Port (Owner) | Adapter | Location |
|--------------|---------|----------|
| `IExecutor` (agents) | `SimpleRemoteExecutor` | `src/client/remote-executor-simple.ts` |
| `ILogger` (agents) | `RemoteServer`, `SimpleRemoteExecutor` | `src/server/`, `src/client/` |
| `IAIProvider` (agents) | `RemoteServer` (registers providers) | `src/server/remote-server.ts` |

## Test Strategy

- **Unit tests**: 3 test files under `src/client/__tests__/` and `src/utils/__tests__/`:
  - `http-client.test.ts` -- HTTP client request/response handling.
  - `remote-executor-simple.test.ts` -- executor validation and chat execution.
  - `transformers.test.ts` -- pure utility function tests.
- **Coverage gaps**: No tests for `RemoteServer`, WebSocket transport, or streaming paths.
