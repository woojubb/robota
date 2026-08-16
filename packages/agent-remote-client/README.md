# @robota-sdk/agent-remote-client

Client-side remote execution layer for Robota SDK. Provides `RemoteExecutor` (implements `IExecutor`) to proxy AI provider calls to a remote Robota agent server over HTTP.

Streaming is deliberately **not** implemented (CORE-044): the client used to post to a `/stream`
endpoint no server in this repository serves, so every such call was a 404. Restoring it needs a
transport decision and an owner for chunk assembly — tracked as CORE-046.

> This package is **private** and not published to npm. Server-side hosting is handled by separate packages (`agent-transport-http`, `agent-transport-ws`).

## Installation

This package is used internally within the Robota monorepo via workspace references.

## Usage

```typescript
import { RemoteExecutor } from '@robota-sdk/agent-remote-client';
import { createUserMessage } from '@robota-sdk/agent-core';

const executor = new RemoteExecutor({
  serverUrl: 'https://my-agent-server.example.com',
  userApiKey: 'my-api-key',
  timeout: 30000, // optional, default 30 000 ms
});

const response = await executor.executeChat({
  provider: 'anthropic',
  model: 'claude-opus-4-5',
  messages: [createUserMessage('Hello')],
  // Per-call options travel to the server as one object and are forwarded into the
  // provider call there (CORE-044). Tools are sent alongside them.
  options: {
    model: 'claude-opus-4-5',
    toolChoice: 'required',
    maxTokens: 1024,
  },
});
```

## API

### `RemoteExecutor`

Implements `IExecutor` from `@robota-sdk/agent-core`. Proxies `executeChat` to a remote server via HTTP POST, carrying the caller's `tools` and the serializable members of `IChatOptions`. `executeChatStream` is not implemented — the interface makes it optional, so a provider configured with this executor reports `supportsStreaming: false` rather than failing at a route nobody serves.

The run's `AbortSignal` cannot be serialized, so it is threaded into `fetch`: cancelling the HTTP request IS the cancellation on this seam, and an abort surfaces as an `AbortError` rather than a generic transport failure.

| Config option | Type                     | Required | Description                             |
| ------------- | ------------------------ | -------- | --------------------------------------- |
| `serverUrl`   | `string`                 | Yes      | Base URL of the remote agent server     |
| `userApiKey`  | `string`                 | Yes      | API key sent with every request         |
| `timeout`     | `number`                 | No       | Request timeout in ms (default: 30 000) |
| `headers`     | `Record<string, string>` | No       | Additional HTTP headers                 |
| `logger`      | `ILogger`                | No       | Injected logger instance                |

### `HttpClient`

Low-level HTTP client used internally by `RemoteExecutor`. Provides a typed `chat` method. Accepts an injected `ILogger` via `IHttpClientConfig`.

## Exported Types

| Type                                                         | Description            |
| ------------------------------------------------------------ | ---------------------- |
| `IBasicMessage`, `IRequestMessage`, `IResponseMessage`       | Message contract types |
| `ITokenUsage`                                                | Token usage shape      |
| `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod` | HTTP contract types    |

## Dependencies

- `@robota-sdk/agent-core` — `IExecutor`, `ILogger`, core message types
