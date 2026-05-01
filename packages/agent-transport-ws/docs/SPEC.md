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

| type                        | payload                                                 | maps to                             |
| --------------------------- | ------------------------------------------------------- | ----------------------------------- |
| `submit`                    | `{ prompt: string }`                                    | `session.submit(prompt)`            |
| `command`                   | `{ name: string, args?: string }`                       | `session.executeCommand()`          |
| `abort`                     | —                                                       | `session.abort()`                   |
| `cancel-queue`              | —                                                       | `session.cancelQueue()`             |
| `get-messages`              | —                                                       | `session.getMessages()`             |
| `get-context`               | —                                                       | `session.getContextState()`         |
| `get-executing`             | —                                                       | `session.isExecuting()`             |
| `get-pending`               | —                                                       | `session.getPendingPrompt()`        |
| `get-background-tasks`      | `{ filter?: IBackgroundTaskListFilter }`                | `session.listBackgroundTasks()`     |
| `get-background-task`       | `{ taskId: string }`                                    | `session.getBackgroundTask()`       |
| `cancel-background-task`    | `{ taskId: string, reason?: string }`                   | `session.cancelBackgroundTask()`    |
| `close-background-task`     | `{ taskId: string }`                                    | `session.closeBackgroundTask()`     |
| `send-background-task`      | `{ taskId: string, input: IBackgroundTaskInput }`       | `session.sendBackgroundTask()`      |
| `read-background-task-log`  | `{ taskId: string, cursor?: IBackgroundTaskLogCursor }` | `session.readBackgroundTaskLog()`   |
| `get-background-job-groups` | `{}`                                                    | `session.listBackgroundJobGroups()` |
| `get-background-job-group`  | `{ groupId: string }`                                   | `session.getBackgroundJobGroup()`   |
| `wait-background-job-group` | `{ groupId: string }`                                   | `session.waitBackgroundJobGroup()`  |

### Server → Client (pushed events)

| type                             | payload                                                      | source                                        |
| -------------------------------- | ------------------------------------------------------------ | --------------------------------------------- |
| `text_delta`                     | `{ delta: string }`                                          | InteractiveSession event                      |
| `tool_start`                     | `{ state: IToolState }`                                      | InteractiveSession event                      |
| `tool_end`                       | `{ state: IToolState }`                                      | InteractiveSession event                      |
| `thinking`                       | `{ isThinking: boolean }`                                    | InteractiveSession event                      |
| `complete`                       | `{ result: IExecutionResult }`                               | InteractiveSession event                      |
| `interrupted`                    | `{ result: IExecutionResult }`                               | InteractiveSession event                      |
| `error`                          | `{ message: string }`                                        | InteractiveSession event                      |
| `command_result`                 | `{ name, message, success, data? }`                          | command response                              |
| `messages`                       | `{ messages: [...] }`                                        | get-messages response                         |
| `context`                        | `{ state: {...} }`                                           | get-context response                          |
| `executing`                      | `{ executing: boolean }`                                     | get-executing response                        |
| `pending`                        | `{ pending: string\|null }`                                  | get-pending response                          |
| `background_task_event`          | `{ event: TBackgroundTaskEvent }`                            | InteractiveSession background task event      |
| `background_job_group_event`     | `{ event: TBackgroundJobGroupEvent }`                        | InteractiveSession background job group event |
| `background_tasks`               | `{ tasks: IBackgroundTaskState[] }`                          | get-background-tasks response                 |
| `background_task`                | `{ taskId: string, task: IBackgroundTaskState\|null }`       | get-background-task response                  |
| `background_task_log`            | `{ taskId: string, page: IBackgroundTaskLogPage }`           | read-background-task-log response             |
| `background_job_groups`          | `{ groups: IBackgroundJobGroupState[] }`                     | get-background-job-groups response            |
| `background_job_group`           | `{ groupId: string, group: IBackgroundJobGroupState\|null }` | get/wait-background-job-group response        |
| `background_task_control_result` | `{ action, taskId, success, message? }`                      | cancel/close/send response                    |
| `protocol_error`                 | `{ message: string }`                                        | invalid client message                        |

The `command` message is generic. Available commands depend on the `ICommandModule` instances composed into the upstream `InteractiveSession`; this transport does not know command names in advance.

## ITransportAdapter

This package implements the `ITransportAdapter` interface from `@robota-sdk/agent-sdk`.

### `createWsTransport(options)`

Factory that returns an `ITransportAdapter` with `name: 'ws'`.

**Options:**

| Field  | Type                                | Description                             |
| ------ | ----------------------------------- | --------------------------------------- |
| `send` | `(message: TServerMessage) => void` | Callback to send messages to the client |

**Extra property:**

- `onMessage: (data: string) => void` — Available after `start()`. Wire this to your WebSocket's message handler.

**Lifecycle:**

1. `attach(session)` — Stores the `InteractiveSession` reference
2. `start()` — Subscribes to session events, sets up the `onMessage` handler for incoming client messages
3. `stop()` — Unsubscribes from session events and cleans up handlers

## Dependencies

- `@robota-sdk/agent-sdk` (InteractiveSession)
- No WebSocket library dependency (framework-agnostic)
