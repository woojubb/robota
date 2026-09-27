# WebSocket Transport

Drive an `InteractiveSession` over a WebSocket connection with `@robota-sdk/agent-transport-ws`. The
client sends JSON messages (submit a prompt, run a command, answer a permission prompt) and receives
the session's events as they happen.

## Basic setup

`createWsTransport()` connects one session to one socket you already have. It adds no
authentication: whoever can open a socket on your server can drive the session, so bind the server
to loopback or authenticate the upgrade yourself.

<!-- doc-example-skip: requires the host app's ws dependency -->

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { createWsTransport } from '@robota-sdk/agent-transport-ws';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ host: '127.0.0.1', port: 8080 });
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

wss.on('connection', async (ws) => {
  const session = new InteractiveSession({ cwd: process.cwd(), provider });
  const transport = createWsTransport({
    send: (msg) => ws.send(JSON.stringify(msg)),
    // Called once if a message cannot be delivered; the transport stops forwarding after it.
    onDeliveryError: () => ws.close(1011, 'Outbound delivery failed'),
  });

  session.attachTransport(transport);
  await transport.start();

  ws.on('message', (data) => transport.onMessage?.(String(data)));
  ws.on('close', () => {
    void transport.stop();
    void session.shutdown();
  });
});
```

`transport.onMessage` is set by `start()` and cleared by `stop()` or a delivery failure, hence the
`?.`.

## Message protocol

The main messages are below. The full set is the `TClientMessage` and `TServerMessage` types exported
by `@robota-sdk/agent-transport`.

### Client → server

```json
{ "type": "submit", "prompt": "Fix the bug" }
{ "type": "command", "name": "compact", "args": "focus on the API" }
{ "type": "abort" }
{ "type": "cancel-queue" }
{ "type": "get-messages" }
{ "type": "get-context" }
{ "type": "permission-response", "id": "<request id>", "result": true }
```

`command` runs one of the session's commands. An `InteractiveSession` has only the commands passed
in its `commandModules` option; the CLI composes its slash commands this way.

### Server → client

```json
{ "type": "text_delta", "delta": "Here is..." }
{ "type": "tool_start", "state": { "toolName": "Read", "isRunning": true } }
{ "type": "complete", "result": { "response": "Done." } }
{ "type": "command_result", "name": "compact", "message": "Context compacted.", "success": true }
{ "type": "permission_request", "event": { "id": "<request id>", "toolName": "Bash", "toolArgs": { "command": "pnpm test" } } }
```

A `permission_request` waits for a `permission-response` with the same `id`. `result` is `true` (allow
once), `false` (deny), `"allow-session"` or `"allow-project"`.

## Advanced: direct handler

`createWsTransport()` is a thin wrapper. To control the connection yourself, pair the carrier-neutral
session handler with an outbound delivery boundary:

<!-- doc-example-skip: requires the host app's ws dependency -->

```typescript
import {
  createOutboundDelivery,
  createSessionMessageHandler,
  type IProtocolSession,
} from '@robota-sdk/agent-transport';
import type { WebSocketServer } from 'ws';

declare const wss: WebSocketServer;
declare const session: IProtocolSession; // for example an InteractiveSession

wss.on('connection', (ws) => {
  const deliver = createOutboundDelivery(
    (message) => ws.send(JSON.stringify(message)),
    () => ws.close(1011, 'Outbound delivery failed'),
  );
  const { onMessage, cleanup } = createSessionMessageHandler({ session, deliver });

  ws.on('message', (data) => onMessage(String(data)));
  ws.on('close', cleanup);
});
```

For a ready-made server with token admission, use the package's `WsTransport` class;
[examples/capabilities/multi-surface-deploy](../../examples/capabilities/multi-surface-deploy/README.md)
serves one session over WebSocket and HTTP together.
[examples/websocket-chat](../../examples/websocket-chat/README.md) is a complete chat server that
defines its own small message protocol instead.
