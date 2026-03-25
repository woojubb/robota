# @robota-sdk/agent-remote-client

Client-side remote execution layer for Robota SDK. Provides `RemoteExecutor` (implements `IExecutor`) to proxy AI provider calls to a remote Robota agent server over HTTP, including SSE streaming support.

> This package is **private** and not published to npm. Server-side hosting is handled by separate packages (`agent-transport-http`, `agent-transport-ws`).

## Installation

This package is used internally within the Robota monorepo via workspace references.

## Usage

```typescript
import { RemoteExecutor } from '@robota-sdk/agent-remote-client';

const executor = new RemoteExecutor({
  serverUrl: 'https://my-agent-server.example.com',
  userApiKey: 'my-api-key',
  timeout: 30000, // optional, default 30 000 ms
});

// Non-streaming
const response = await executor.executeChat({
  provider: 'anthropic',
  model: 'claude-opus-4-5',
  messages: [{ role: 'user', content: 'Hello' }],
});

// Streaming (SSE)
for await (const chunk of executor.executeChatStream({
  provider: 'anthropic',
  model: 'claude-opus-4-5',
  messages: [{ role: 'user', content: 'Hello' }],
})) {
  process.stdout.write(chunk.content ?? '');
}
```

## API

### `RemoteExecutor`

Implements `IExecutor` from `@robota-sdk/agent-core`. Proxies `executeChat` and `executeChatStream` calls to a remote server via HTTP POST.

| Config option | Type                     | Required | Description                             |
| ------------- | ------------------------ | -------- | --------------------------------------- |
| `serverUrl`   | `string`                 | Yes      | Base URL of the remote agent server     |
| `userApiKey`  | `string`                 | Yes      | API key sent with every request         |
| `timeout`     | `number`                 | No       | Request timeout in ms (default: 30 000) |
| `headers`     | `Record<string, string>` | No       | Additional HTTP headers                 |
| `logger`      | `ILogger`                | No       | Injected logger instance                |

### `HttpClient`

Low-level HTTP client used internally by `RemoteExecutor`. Provides typed `chat` and `chatStream` methods. Accepts an injected `ILogger` via `IHttpClientConfig`.

## Exported Types

| Type                                                         | Description            |
| ------------------------------------------------------------ | ---------------------- |
| `IBasicMessage`, `IRequestMessage`, `IResponseMessage`       | Message contract types |
| `ITokenUsage`                                                | Token usage shape      |
| `IHttpRequest`, `IHttpResponse`, `IHttpError`, `THttpMethod` | HTTP contract types    |

## Dependencies

- `@robota-sdk/agent-core` — `IExecutor`, `ILogger`, core message types
