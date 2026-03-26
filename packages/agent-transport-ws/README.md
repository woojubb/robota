# @robota-sdk/agent-transport-ws

Framework-agnostic WebSocket transport adapter for exposing `InteractiveSession` over real-time bidirectional connections. Works with any WebSocket implementation (Node.js `ws`, browser `WebSocket`, uWebSockets, etc.) via send/onMessage callbacks — no WebSocket library dependency.

## Installation

```bash
pnpm add @robota-sdk/agent-transport-ws
```

## Usage

```typescript
import { createWsHandler } from '@robota-sdk/agent-transport-ws';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  const { onMessage, cleanup } = createWsHandler({
    session: interactiveSession,
    send: (msg) => ws.send(JSON.stringify(msg)),
  });

  ws.on('message', (data) => onMessage(String(data)));
  ws.on('close', cleanup);
});
```

## Message Protocol

All messages are JSON-encoded objects with a `type` field.

### Client to Server

| type            | payload                           | maps to                      |
| --------------- | --------------------------------- | ---------------------------- |
| `submit`        | `{ prompt: string }`              | `session.submit(prompt)`     |
| `command`       | `{ name: string, args?: string }` | `session.executeCommand()`   |
| `abort`         | —                                 | `session.abort()`            |
| `cancel-queue`  | —                                 | `session.cancelQueue()`      |
| `get-messages`  | —                                 | `session.getMessages()`      |
| `get-context`   | —                                 | `session.getContextState()`  |
| `get-executing` | —                                 | `session.isExecuting()`      |
| `get-pending`   | —                                 | `session.getPendingPrompt()` |

### Server to Client (pushed events)

| type             | payload                             | source                   |
| ---------------- | ----------------------------------- | ------------------------ |
| `text_delta`     | `{ delta: string }`                 | InteractiveSession event |
| `tool_start`     | `{ state: IToolState }`             | InteractiveSession event |
| `tool_end`       | `{ state: IToolState }`             | InteractiveSession event |
| `thinking`       | `{ isThinking: boolean }`           | InteractiveSession event |
| `complete`       | `{ result: IExecutionResult }`      | InteractiveSession event |
| `interrupted`    | `{ result: IExecutionResult }`      | InteractiveSession event |
| `error`          | `{ message: string }`               | InteractiveSession event |
| `command_result` | `{ name, message, success, data? }` | command response         |
| `messages`       | `{ messages: TUniversalMessage[] }` | get-messages response    |
| `context`        | `{ state: IContextWindowState }`    | get-context response     |
| `executing`      | `{ executing: boolean }`            | get-executing response   |
| `pending`        | `{ pending: string\|null }`         | get-pending response     |
| `protocol_error` | `{ message: string }`               | invalid client message   |

## ITransportAdapter

The WebSocket transport implements the `ITransportAdapter` interface from `@robota-sdk/agent-sdk`:

```typescript
import { createWsTransport } from '@robota-sdk/agent-transport-ws';
import type { ITransportAdapter } from '@robota-sdk/agent-sdk';

const transport: ITransportAdapter = createWsTransport({
  send: (msg) => ws.send(JSON.stringify(msg)),
});

transport.attach(interactiveSession);
await transport.start();

// Wire incoming messages
ws.on('message', (data) => transport.onMessage(String(data)));
ws.on('close', () => transport.stop());
```

## Dependencies

- `@robota-sdk/agent-sdk` — `InteractiveSession`
- No WebSocket library dependency (framework-agnostic)
