import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlaygroundWebSocketClient,
  PLAYGROUND_WS_CLIENT_EVENTS,
  PLAYGROUND_WS_MESSAGE_TYPES,
  type IPlaygroundWebSocketMessage,
  type TPlaygroundWebSocketEventPayload,
} from '../websocket-client';

class WebSocketDouble {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: WebSocketDouble[] = [];

  readonly sent: string[] = [];
  readonly url: string;
  readyState = WebSocketDouble.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    WebSocketDouble.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = WebSocketDouble.CLOSED;
    this.onclose?.({ code, reason } as CloseEvent);
  }

  open(): void {
    this.readyState = WebSocketDouble.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(message: IPlaygroundWebSocketMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
}

function latestSocket(): WebSocketDouble {
  const socket = WebSocketDouble.instances.at(-1);
  if (!socket) {
    throw new Error('expected WebSocket instance');
  }
  return socket;
}

function parseSent(socket: WebSocketDouble, index: number): IPlaygroundWebSocketMessage {
  return JSON.parse(socket.sent[index] ?? '') as IPlaygroundWebSocketMessage;
}

async function connectAndOpen(client: PlaygroundWebSocketClient): Promise<WebSocketDouble> {
  const connection = client.connect();
  const socket = latestSocket();
  socket.open();
  await expect(connection).resolves.toBe(true);
  return socket;
}

describe('PlaygroundWebSocketClient', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', WebSocketDouble);
    WebSocketDouble.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('connects to the playground websocket endpoint and emits connection status', async () => {
    const client = new PlaygroundWebSocketClient('https://api.example.test');
    const events: TPlaygroundWebSocketEventPayload[] = [];
    client.on(PLAYGROUND_WS_CLIENT_EVENTS.CONNECTION, (payload) => events.push(payload));

    const socket = await connectAndOpen(client);

    expect(socket.url).toBe('wss://api.example.test/ws/playground');
    expect(client.getStatus()).toEqual({ connected: true, authenticated: false });
    expect(events).toEqual([{ connected: true }]);

    client.disconnect();
    expect(client.getStatus()).toEqual({ connected: false, authenticated: false });
  });

  it('sends timestamped messages and includes playground identity on broadcasts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const client = new PlaygroundWebSocketClient('http://localhost:3000', 'user-1', 'session-1');
    const socket = await connectAndOpen(client);

    expect(client.sendMessage({ type: PLAYGROUND_WS_MESSAGE_TYPES.PING })).toBe(true);
    expect(client.broadcastUpdate({ status: 'running' })).toBe(true);

    expect(parseSent(socket, 0)).toEqual({
      type: PLAYGROUND_WS_MESSAGE_TYPES.PING,
      timestamp: '2026-01-02T03:04:05.000Z',
    });
    expect(parseSent(socket, 1)).toEqual({
      type: PLAYGROUND_WS_MESSAGE_TYPES.PLAYGROUND_UPDATE,
      data: { status: 'running' },
      userId: 'user-1',
      sessionId: 'session-1',
      timestamp: '2026-01-02T03:04:05.000Z',
    });
  });

  it('authenticates after connect when credentials are present', async () => {
    const client = new PlaygroundWebSocketClient('http://localhost:3000', 'user-1', 's-1', 'token');
    const connection = client.connect();
    const socket = latestSocket();

    socket.open();
    expect(parseSent(socket, 0)).toMatchObject({
      type: PLAYGROUND_WS_MESSAGE_TYPES.AUTH,
      data: { userId: 'user-1', sessionId: 's-1', token: 'token' },
    });
    socket.receive({
      type: PLAYGROUND_WS_MESSAGE_TYPES.AUTH,
      timestamp: '2026-01-02T03:04:05.000Z',
      data: { success: true, userId: 'user-1', sessionId: 's-1', clientId: 'conn-1' },
    });

    await expect(connection).resolves.toBe(true);
    expect(client.getStatus()).toEqual({
      connected: true,
      authenticated: true,
      connectionId: 'conn-1',
      lastActivity: expect.any(Date),
    });
  });

  it('routes playground updates to registered event handlers', async () => {
    const client = new PlaygroundWebSocketClient('http://localhost:3000');
    const updates: TPlaygroundWebSocketEventPayload[] = [];
    client.on(PLAYGROUND_WS_CLIENT_EVENTS.PLAYGROUND_UPDATE, (payload) => updates.push(payload));
    const socket = await connectAndOpen(client);

    socket.receive({
      type: PLAYGROUND_WS_MESSAGE_TYPES.PLAYGROUND_UPDATE,
      timestamp: '2026-01-02T03:04:05.000Z',
      data: { blockId: 'block-1' },
    });

    expect(updates).toEqual([
      {
        type: PLAYGROUND_WS_MESSAGE_TYPES.PLAYGROUND_UPDATE,
        timestamp: '2026-01-02T03:04:05.000Z',
        data: { blockId: 'block-1' },
      },
    ]);
  });
});
