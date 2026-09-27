# @robota-sdk/agent-remote-client

A client-side executor that sends AI provider calls to a remote provider-proxy server over HTTP instead of
calling the vendor API directly. `RemoteExecutor` implements `IExecutor` from `@robota-sdk/agent-core`,
so a provider configured with it (`new AnthropicProvider({ executor })`, for example) keeps working
unchanged while the server holds the vendor API keys.

It is not the client for `@robota-sdk/agent-transport-http` or `@robota-sdk/agent-transport-ws`: those
serve a running agent _session_ over a different, session-oriented protocol. This package speaks a
per-call provider protocol: one chat request in, one assistant message out.

## Installation

This package is internal to the Robota monorepo (`private: true`, not published to npm). Use it through a
workspace reference.

## Usage

```typescript
import { RemoteExecutor } from '@robota-sdk/agent-remote-client';
import { createUserMessage } from '@robota-sdk/agent-core';

const executor = new RemoteExecutor({
  serverUrl: 'https://agent-server.example.com/api/v1/remote',
  userApiKey: 'token-issued-by-the-server',
  timeout: 30000, // optional, default 30 000 ms
});

const { message, modelEffortOutcome } = await executor.executeChat({
  provider: 'anthropic',
  model: 'claude-opus-4-5',
  messages: [createUserMessage('Hello')],
  // Serializable per-call options travel to the server and are applied to the provider call there.
  options: {
    toolChoice: 'required',
    maxTokens: 1024,
    effort: 'auto',
  },
});

console.log(message.content, modelEffortOutcome);
```

## Wire protocol

The client appends a fixed path to `serverUrl` and sends `Authorization: Bearer <userApiKey>` with every
request:

| Call                | Request                              | Response                                                                   |
| ------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| `executeChat`       | `POST <serverUrl>/chat`              | JSON: the assistant message, plus the effort outcome when one was selected |
| `executeChatStream` | `POST <serverUrl>/chat/stream` (SSE) | Text-delta frames, then one terminal assembled message                     |

Of the per-call options, the serializable ones (`maxTokens`, `temperature`, `effort`, `toolChoice`,
`responseFormat`, `nativeWebTools` and the provider-specific `openai` / `anthropic` / `google` blocks)
travel as one `options` object, with `tools` beside it. Callbacks and the abort signal stay local.

The server assembles the streamed message; the client never stitches provider fragments together. It
forwards each text delta to the caller's `onTextDelta`, then yields exactly one `{ kind: 'message' }`
event and one `{ kind: 'terminal' }` event. A stream that ends without a terminal message is an error,
not a short answer.

The repository's `apps/agent-server` app serves this protocol under `/api/v1/remote`, which is why the
example's `serverUrl` ends with that prefix.

For a selected model-effort tier only the selection crosses the wire. The server resolves it and returns
one outcome, which the client passes to `onModelEffortOutcome` exactly once. The run's `AbortSignal` is
threaded into `fetch`, so cancelling the run cancels the HTTP request, and the abort surfaces as an
`AbortError` rather than a generic transport failure.

## API

### `RemoteExecutor`

Constructor options:

| Option       | Type                     | Required | Description                                       |
| ------------ | ------------------------ | -------- | ------------------------------------------------- |
| `serverUrl`  | `string`                 | Yes      | Base URL; `/chat` and `/chat/stream` are appended |
| `userApiKey` | `string`                 | Yes      | Sent as the bearer token on every request         |
| `timeout`    | `number`                 | No       | Request timeout in ms (default: 30 000)           |
| `headers`    | `Record<string, string>` | No       | Additional HTTP headers                           |
| `logger`     | `ILogger`                | No       | Injected logger (default: silent)                 |

The options type itself is not exported. `IRemoteExecutorConfig`, re-exported from
`@robota-sdk/agent-core`, is a different shape (it has `maxRetries` and no `logger`) and does not
describe these options.

Methods: `executeChat(request)` returns `{ message, modelEffortOutcome? }`; `executeChatStream(request)`
is an async iterable of the two stream events above. Invalid requests (no messages, no provider or model,
malformed messages) and a missing `serverUrl` or `userApiKey` throw with a specific message.

### `HttpClient`

The low-level client `RemoteExecutor` is built on: `post`, `get`, `chat` and `chatStream` against a base
URL, with an injected `ILogger`.

### Other exports

- Message and HTTP types: `IBasicMessage`, `IRequestMessage`, `IResponseMessage`, `ITokenUsage`,
  `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod`, `TDefaultRequestData`.
- Helpers: `toRequestMessage`, `toResponseMessage`, `createHttpRequest`, `createHttpResponse`,
  `extractContent`, `generateId`, `normalizeHeaders`, `safeJsonParse`.
- Re-exported from `@robota-sdk/agent-core` for convenience: `IExecutor`, `IChatExecutionRequest`,
  `IStreamExecutionRequest`, `TUniversalMessage`, `IAssistantMessage`, `IRemoteExecutorConfig`.

## Dependencies

- `@robota-sdk/agent-core` — `IExecutor`, `ILogger`, message types.

See [docs/SPEC.md](./docs/SPEC.md) for the contract.
