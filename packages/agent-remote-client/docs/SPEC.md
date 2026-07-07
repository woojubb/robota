# agent-remote-client Specification

## Scope

Owns the client-side remote execution layer for Robota SDK. Provides `RemoteExecutor` (implements `IExecutor`) to proxy AI provider calls to a remote server over HTTP (`POST /chat`, `POST /stream`), plus the low-level `HttpClient` used by the executor. The server it calls is an external provider-gateway (out-of-repo), not part of this monorepo. It is NOT `agent-transport-http`/`agent-transport-ws`: those packages serve a different, session-oriented protocol (`/submit`, `/command`, `/messages`) and are not this client's server counterpart.

## Boundaries

- Does not own core agent/provider contracts (`IExecutor`, `IAIProvider`, `IAssistantMessage`); imports from `@robota-sdk/agent-core`.
- Does not own server-side hosting logic; the server it calls is an external provider-gateway (out-of-repo), not part of this monorepo and not `agent-transport-http` (which serves a different `/submit`,`/command`,`/messages` protocol).
- Does not own WebSocket transport; the in-repo WebSocket transport contract belongs to `agent-transport-ws`.
- Has a single production dependency: `@robota-sdk/agent-core`.
- Package is `private: true`; it is not published to npm.

## Architecture Overview

Single entry point `./` backed by `src/index.ts`.

`RemoteExecutor` (`SimpleRemoteExecutor`, `src/client/remote-executor-simple.ts`) is the main facade. It composes `HttpClient` for HTTP communication, validates requests, and maps responses to `IAssistantMessage` / `TUniversalMessage`. It implements `executeChat` (non-streaming), `executeChatStream` (SSE streaming), `supportsTools()`, `validateConfig()`, and `dispose()`.

`HttpClient` (`src/client/http-client.ts`) provides typed `post`, `get`, `chat`, and `chatStream` methods. It uses the Fetch API and delegates the actual chat/stream HTTP logic to `chat-http-methods.ts`. It accepts an injected `ILogger` via `IHttpClientConfig`.

`chat-http-methods.ts` (`src/client/chat-http-methods.ts`) contains the extracted HTTP chat logic: `executeChatRequest` (non-streaming POST to `/chat`) and `executeChatStreamRequest` (SSE streaming POST to `/stream`). Also exports `validateToolCallArray` (internal guard) and defines `IChatRequestMessage` / `IChatResponsePayload` payload shapes. Extracted from `http-client.ts` to keep files under 300 lines.

`request-handler-simple.ts` (`src/client/request-handler-simple.ts`) provides pure helper functions for request/response transformation: `createChatTransportRequest`, `createStreamTransportRequest`, `transformToAssistantMessage`, `validateChatRequest`, `validateStreamRequest`. These are not exported from the package entry point.

Utility functions in `src/utils/transformers.ts` are pure functions with no side effects. They handle message conversion, request/response construction, and JSON safety.

`src/server.ts` is a stub retained as a placeholder; it contains only a JSDoc header and exports nothing.

## Type Ownership

This package is SSOT for the following types. All types marked **public** are exported from the `.` entry point; others are internal.

- `IBasicMessage`, `IRequestMessage`, `IResponseMessage` — message types (**public**).
- `IEnhancedResponseMessage` — `IResponseMessage` extended with `usage` and `tools` fields (internal, `src/types/message-types.ts`).
- `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod` — HTTP contract types (**public**).
- `IHttpHeaders` — typed header map with optional string values (internal, `src/types/http-types.ts`).
- `TDefaultRequestData` — flexible JSON-serializable request data alias (internal, `src/types/http-types.ts`).
- `ISimpleRemoteConfig` — `RemoteExecutor` constructor configuration (internal, `src/client/remote-executor-simple.ts`).
- `IHttpClientConfig` — `HttpClient` constructor configuration (internal, `src/client/http-client.ts`).
- `ISimpleExecutionRequest` — simplified execution request used by `HttpClient.chat` / `chatStream` (internal).
- `IExtendedAssistantMessage` — assistant message extended with provider/model/usage fields (internal, `src/shared/types.ts`).
- `IChatRequestMessage` — message shape for chat request body, including optional `toolCalls`/`toolCallId` (internal, `src/client/chat-http-methods.ts`).
- `IChatResponsePayload` — shape of the response payload from the chat endpoint (internal, `src/client/chat-http-methods.ts`).
- `CommunicationProtocol` — protocol enum; currently unused externally but kept as future extension point (internal).
- `IChatRequestBody`, `IChatResponseData`, `ITransportRequest`, `ITransportResponse` — transport payload shapes (internal).
- `IExtendedChatExecutionRequest`, `IExtendedStreamExecutionRequest` — request extensions with temperature/maxTokens (internal).
- `IRemoteConfig`, `IHealthStatus`, `IUserContext`, `IProviderStatus` — shared configuration/status types (internal).

`ITokenUsage` is owned by `@robota-sdk/agent-core`; this package re-exports it for consumer convenience only.

Re-exports from `@robota-sdk/agent-core` via `src/shared/types.ts` (`IExecutor`, `IChatExecutionRequest`, `IStreamExecutionRequest`, `IRemoteExecutorConfig`, `TUniversalMessage`, `IAssistantMessage`) are compatibility shims and do not represent SSOT ownership.

## Public API Surface

| Export                                                                                                                             | Kind     | Description                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `RemoteExecutor` (`SimpleRemoteExecutor`)                                                                                          | class    | `IExecutor` implementation for remote HTTP calls                                 |
| `HttpClient`                                                                                                                       | class    | Low-level HTTP client (chat + streaming)                                         |
| `toRequestMessage`                                                                                                                 | function | Transform `IBasicMessage` → `IRequestMessage`                                    |
| `toResponseMessage`                                                                                                                | function | Transform `IBasicMessage` → `IResponseMessage`                                   |
| `createHttpRequest`                                                                                                                | function | Build a typed `IHttpRequest<TData>`                                              |
| `createHttpResponse`                                                                                                               | function | Build a typed `IHttpResponse<TData>`                                             |
| `extractContent`                                                                                                                   | function | Extract content string from a nested `IHttpResponse` envelope                    |
| `generateId`                                                                                                                       | function | Generate a prefixed unique ID string                                             |
| `normalizeHeaders`                                                                                                                 | function | Coerce `Record<string, string \| number \| boolean>` to `Record<string, string>` |
| `safeJsonParse`                                                                                                                    | function | JSON.parse with null on parse failure (caller must validate shape)               |
| `IBasicMessage`, `IRequestMessage`, `IResponseMessage`, `ITokenUsage`                                                              | types    | Message contract types (`ITokenUsage` re-exported from agent-core)               |
| `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod`                                                                       | types    | HTTP contract types                                                              |
| `IExecutor`, `IChatExecutionRequest`, `IStreamExecutionRequest`, `TUniversalMessage`, `IAssistantMessage`, `IRemoteExecutorConfig` | types    | Re-exported from `@robota-sdk/agent-core` for consumer convenience               |

## Extension Points

- `ISimpleRemoteConfig.logger` — inject a custom `ILogger` into `RemoteExecutor`.
- `IHttpClientConfig.logger` — inject a custom `ILogger` into `HttpClient`.
- `ISimpleRemoteConfig.headers` — pass additional HTTP headers to every request.
- `ISimpleRemoteConfig.timeout` — configure request timeout (default: 30 000 ms).

## Error Taxonomy

| Source              | Error / Condition                                           | Trigger                                              |
| ------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `RemoteExecutor`    | `Error('Messages array is required and cannot be empty')`   | `messages` is empty or missing                       |
| `RemoteExecutor`    | `Error('Provider is required')`                             | `request.provider` is empty                          |
| `RemoteExecutor`    | `Error('Model is required')`                                | `request.model` is empty                             |
| `RemoteExecutor`    | `Error('Invalid message at index N: role and content ...')` | Message at index N has non-string role or content    |
| `RemoteExecutor`    | `Error('BaseURL is required but not provided')`             | `serverUrl` missing in config                        |
| `RemoteExecutor`    | `Error('User API key is required but not provided')`        | `userApiKey` missing in config                       |
| `chat-http-methods` | `Error('HTTP <status>: <statusText>')`                      | Non-2xx HTTP response from `/chat` or `/stream`      |
| `chat-http-methods` | `Error('No response body for streaming')`                   | Streaming response has no body                       |
| `chat-http-methods` | `Error('Streaming request failed: ...')`                    | Unhandled error during SSE read loop                 |
| `chat-http-methods` | `Error('Request failed: ...')`                              | Unhandled error in `executeChatRequest`              |
| `HttpClient`        | `Error('HTTP <status>: <statusText>')`                      | Non-2xx HTTP response in `executeRequest` (post/get) |
| `HttpClient`        | `Error('Request failed: ...')`                              | Unhandled error in `executeRequest`                  |

## Class Contract Registry

### Interface Implementations

| Interface          | Implementor            | Location                               |
| ------------------ | ---------------------- | -------------------------------------- |
| `IExecutor` (core) | `SimpleRemoteExecutor` | `src/client/remote-executor-simple.ts` |

### Cross-Package Port Consumers

| Port (Owner)     | Consumer                   | Location                               |
| ---------------- | -------------------------- | -------------------------------------- |
| `ILogger` (core) | `SimpleRemoteExecutor`     | `src/client/remote-executor-simple.ts` |
| `ILogger` (core) | `HttpClient`               | `src/client/http-client.ts`            |
| `ILogger` (core) | `executeChatRequest`       | `src/client/chat-http-methods.ts`      |
| `ILogger` (core) | `executeChatStreamRequest` | `src/client/chat-http-methods.ts`      |

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
