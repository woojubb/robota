# WebSocket Transport

Real-time bidirectional communication with InteractiveSession.

## Basic Setup

```typescript
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { createWsTransport } from '@robota-sdk/agent-transport-ws';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws) => {
  const session = new InteractiveSession({ cwd: process.cwd(), provider });
  const transport = createWsTransport({
    send: (msg) => ws.send(JSON.stringify(msg)),
  });

  session.attachTransport(transport);
  await transport.start();

  ws.on('message', (data) => transport.onMessage(String(data)));
  ws.on('close', () => transport.stop());
});
```

## Message Protocol

### Client → Server

```json
{ "type": "submit", "prompt": "Fix the bug" }
{ "type": "command", "name": "clear" }
{ "type": "abort" }
{ "type": "cancel-queue" }
{ "type": "get-messages" }
{ "type": "get-context" }
```

### Server → Client

```json
{ "type": "text_delta", "delta": "Here is..." }
{ "type": "tool_start", "state": { "toolName": "Read", "isRunning": true } }
{ "type": "complete", "result": { "response": "Done." } }
{ "type": "command_result", "name": "clear", "success": true }
```

## Advanced: Direct Handler

For more control, use `createWsHandler` directly:

```typescript
import { createWsHandler } from '@robota-sdk/agent-transport-ws';

wss.on('connection', (ws) => {
  const { onMessage, cleanup } = createWsHandler({
    session: interactiveSession,
    send: (msg) => ws.send(JSON.stringify(msg)),
  });

  ws.on('message', (data) => onMessage(String(data)));
  ws.on('close', cleanup);
});
```
