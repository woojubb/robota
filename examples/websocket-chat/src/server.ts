import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import type { InteractiveSession } from '@robota-sdk/agent-framework';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY environment variable is required');
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? '8080');

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey }),
});

const sessions = new Map<WebSocket, InteractiveSession>();

type ClientMessage = { type: 'message'; text: string } | { type: 'abort' };

type ServerMessage =
  | { type: 'delta'; text: string }
  | { type: 'done'; response: string }
  | { type: 'error'; message: string };

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket chat server running');
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  const session = runtime.createSession({
    permissionMode: 'bypassPermissions',
    bare: true,
  });

  let accumulated = '';

  session.on('text_delta', (delta) => {
    accumulated += delta;
    send(ws, { type: 'delta', text: delta });
  });

  session.on('complete', (result) => {
    send(ws, { type: 'done', response: result.response });
    accumulated = '';
  });

  session.on('interrupted', (result) => {
    send(ws, { type: 'done', response: result.response });
    accumulated = '';
  });

  session.on('error', (err) => {
    send(ws, { type: 'error', message: err.message });
    accumulated = '';
  });

  sessions.set(ws, session);
  console.log(`Client connected (${sessions.size} active)`);

  ws.on('message', (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
      send(ws, { type: 'error', message: 'Missing "type" field' });
      return;
    }

    const msg = parsed as ClientMessage;

    if (msg.type === 'abort') {
      session.abort();
      return;
    }

    if (msg.type === 'message') {
      if (typeof msg.text !== 'string' || !msg.text.trim()) {
        send(ws, { type: 'error', message: '"text" must be a non-empty string' });
        return;
      }
      session.submit(msg.text.trim()).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        send(ws, { type: 'error', message });
      });
      return;
    }

    send(ws, { type: 'error', message: `Unknown message type` });
  });

  ws.on('close', () => {
    session.abort();
    sessions.delete(ws);
    console.log(`Client disconnected (${sessions.size} active)`);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

httpServer.listen(PORT, () => {
  console.log(`WebSocket chat server listening on ws://localhost:${PORT}`);
  console.log('Open src/client.html in a browser to connect.');
});
