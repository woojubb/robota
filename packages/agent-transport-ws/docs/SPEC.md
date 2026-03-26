# @robota-sdk/agent-transport-ws SPEC

## Scope

WebSocket transport adapter for exposing InteractiveSession over real-time bidirectional connections. Framework-agnostic — works with any WebSocket implementation via send/onMessage callbacks.

## Boundaries

- Does NOT own InteractiveSession — imported from `@robota-sdk/agent-sdk`
- Does NOT own system commands — uses `session.executeCommand()` from InteractiveSession
- Does NOT depend on any WebSocket library (ws, uWebSockets, etc.)
- OWNS: Message protocol definition, event subscription/forwarding, message routing

## Architecture

```
WebSocket Client (browser, agent, etc.)
  ↕ JSON messages
createWsHandler (agent-transport-ws)
  ├── client→server: submit, command, abort, cancel-queue, get-*
  ├── server→client: text_delta, tool_start, tool_end, thinking, complete, ...
  ↓
InteractiveSession (agent-sdk)
```

## Public API

### `createWsHandler(options)`

Returns `{ onMessage, cleanup }` — wire to any WebSocket implementation.

```typescript
import { createWsHandler } from '@robota-sdk/agent-transport-ws';

const { onMessage, cleanup } = createWsHandler({
  session: interactiveSession,
  send: (msg) => ws.send(JSON.stringify(msg)),
});

ws.on('message', (data) => onMessage(String(data)));
ws.on('close', cleanup);
```

## Message Protocol

### Client → Server

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

### Server → Client (pushed events)

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
| `messages`       | `{ messages: [...] }`               | get-messages response    |
| `context`        | `{ state: {...} }`                  | get-context response     |
| `executing`      | `{ executing: boolean }`            | get-executing response   |
| `pending`        | `{ pending: string\|null }`         | get-pending response     |
| `protocol_error` | `{ message: string }`               | invalid client message   |

## Dependencies

- `@robota-sdk/agent-sdk` (InteractiveSession)
- No WebSocket library dependency (framework-agnostic)
