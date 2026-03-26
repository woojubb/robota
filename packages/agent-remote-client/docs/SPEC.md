# agent-remote-client Specification

## Scope

Owns the client-side remote execution layer for Robota SDK. Provides `RemoteExecutor` (implements `IExecutor`) to proxy AI provider calls to a remote server over HTTP, plus the low-level `HttpClient` used by the executor. Server-side code has been extracted into separate packages (`agent-transport-http`, `agent-transport-ws`) and is no longer part of this package.

## Boundaries

- Does not own core agent/provider contracts (`IExecutor`, `IAIProvider`, `IAssistantMessage`); imports from `@robota-sdk/agent-core`.
- Does not own server-side hosting logic; that belongs to `agent-transport-http` and downstream server packages.
- Does not own WebSocket transport; that belongs to `agent-transport-ws`.
- Has a single production dependency: `@robota-sdk/agent-core`.
- Package is `private: true`; it is not published to npm.

## Architecture Overview

Single entry point `./` backed by `src/index.ts`.

`RemoteExecutor` (`SimpleRemoteExecutor`) is the main facade. It composes `HttpClient` for HTTP communication, validates requests, and maps responses to `IAssistantMessage` / `TUniversalMessage`. It implements both `executeChat` (non-streaming) and `executeChatStream` (SSE streaming).

`HttpClient` provides typed `post`, `get`, `chat`, and `chatStream` methods. It uses the Fetch API and handles SSE frame parsing for streaming responses. It accepts an injected `ILogger` via `IHttpClientConfig`.

Utility functions in `src/utils/transformers.ts` are pure functions with no side effects. They handle message conversion, request/response construction, and JSON safety.

## Type Ownership

This package is SSOT for the following types. All types marked **public** are exported from the `.` entry point; others are internal.

- `IBasicMessage`, `IRequestMessage`, `IResponseMessage`, `ITokenUsage` — message types (**public**).
- `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod` — HTTP types (**public**).
- `ISimpleRemoteConfig` — `RemoteExecutor` constructor configuration (internal).
- `IHttpClientConfig` — `HttpClient` constructor configuration (internal).
- `ISimpleExecutionRequest` — simplified execution request used by `HttpClient.chat` / `chatStream` (internal).
- `IExtendedAssistantMessage` — assistant message extended with provider/model/usage fields (internal).
- `CommunicationProtocol` — protocol enum; currently unused externally but kept as future extension point (internal).
- `IChatRequestBody`, `IChatResponseData`, `ITransportRequest`, `ITransportResponse` — transport payload shapes (internal).
- `IExtendedChatExecutionRequest`, `IExtendedStreamExecutionRequest` — request extensions with temperature/maxTokens (internal).
- `IRemoteConfig`, `IHealthStatus`, `IUserContext`, `IProviderStatus` — shared configuration/status types (internal).

Re-exports from `@robota-sdk/agent-core` via `src/shared/types.ts` (`IExecutor`, `IChatExecutionRequest`, `IStreamExecutionRequest`, `IRemoteExecutorConfig`, `TUniversalMessage`, `IAssistantMessage`) are compatibility shims and do not represent SSOT ownership.

## Public API Surface

| Export                                                                                                                             | Kind      | Description                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `RemoteExecutor` (`SimpleRemoteExecutor`)                                                                                          | class     | `IExecutor` implementation for remote HTTP calls                   |
| `HttpClient`                                                                                                                       | class     | Low-level HTTP client (chat + streaming)                           |
| `toRequestMessage`, `toResponseMessage`, `createHttpRequest`, etc.                                                                 | functions | Pure transformer utilities                                         |
| `IBasicMessage`, `IRequestMessage`, `IResponseMessage`, `ITokenUsage`                                                              | types     | Message contract types                                             |
| `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod`                                                                       | types     | HTTP contract types                                                |
| `IExecutor`, `IChatExecutionRequest`, `IStreamExecutionRequest`, `TUniversalMessage`, `IAssistantMessage`, `IRemoteExecutorConfig` | types     | Re-exported from `@robota-sdk/agent-core` for consumer convenience |

Utility functions exported from `./utils/transformers`: `toRequestMessage`, `toResponseMessage`, `createHttpRequest`, `createHttpResponse`, `extractContent`, `generateId`, `normalizeHeaders`, `safeJsonParse`.

## Extension Points

- `ISimpleRemoteConfig.logger` — inject a custom `ILogger` into `RemoteExecutor`.
- `IHttpClientConfig.logger` — inject a custom `ILogger` into `HttpClient`.
- `ISimpleRemoteConfig.headers` — pass additional HTTP headers to every request.
- `ISimpleRemoteConfig.timeout` — configure request timeout (default: 30 000 ms).

## Error Taxonomy

| Source           | Error / Condition                                    | Trigger                              |
| ---------------- | ---------------------------------------------------- | ------------------------------------ |
| `RemoteExecutor` | `Error('Messages array is required...')`             | `messages` is empty or missing       |
| `RemoteExecutor` | `Error('Provider is required')`                      | `request.provider` is empty          |
| `RemoteExecutor` | `Error('Model is required')`                         | `request.model` is empty             |
| `RemoteExecutor` | `Error('BaseURL is required but not provided')`      | `serverUrl` missing in config        |
| `RemoteExecutor` | `Error('User API key is required but not provided')` | `userApiKey` missing in config       |
| `HttpClient`     | `Error('HTTP <status>: <text>')`                     | Non-2xx HTTP response                |
| `HttpClient`     | `Error('No response body for streaming')`            | Streaming response has no body       |
| `HttpClient`     | `Error('Streaming request failed: ...')`             | Unhandled error during SSE read loop |
| `HttpClient`     | `Error('Request failed: ...')`                       | Unhandled error in `executeRequest`  |

## Class Contract Registry

### Interface Implementations

| Interface          | Implementor            | Location                               |
| ------------------ | ---------------------- | -------------------------------------- |
| `IExecutor` (core) | `SimpleRemoteExecutor` | `src/client/remote-executor-simple.ts` |

### Cross-Package Port Consumers

| Port (Owner)       | Adapter                | Location                               |
| ------------------ | ---------------------- | -------------------------------------- |
| `IExecutor` (core) | `SimpleRemoteExecutor` | `src/client/remote-executor-simple.ts` |
| `ILogger` (core)   | `SimpleRemoteExecutor` | `src/client/remote-executor-simple.ts` |
| `ILogger` (core)   | `HttpClient`           | `src/client/http-client.ts`            |

## Test Strategy

- **Unit tests**: 7 test files covering client and utilities:
  - `src/client/__tests__/http-client.test.ts` — `HttpClient` request/response handling
  - `src/client/__tests__/http-client-chat.test.ts` — `HttpClient.chat` payload mapping
  - `src/client/__tests__/remote-executor-simple.test.ts` — `RemoteExecutor` validation and execution
  - `src/client/__tests__/request-handler-simple.test.ts` — request handler helpers
  - `src/shared/__tests__/types.test.ts` — shared type validation
  - `src/utils/__tests__/transformers.test.ts` — pure transformer functions
  - `src/__tests__/exports.test.ts` — public entry point export surface
- **Coverage gap**: SSE streaming paths have limited coverage.
