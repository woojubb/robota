import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import { startWsServer } from '../ws-server.js';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';

vi.mock('@robota-sdk/agent-transport-ws', () => ({
  createWsHandler: () => ({
    onMessage: vi.fn(),
    cleanup: vi.fn(),
  }),
}));

function makeMockSession(): InteractiveSession {
  const emitter = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
  };
  return emitter as unknown as InteractiveSession;
}

describe('startWsServer', () => {
  it('binds to the requested port when free', async () => {
    const session = makeMockSession();
    const ws = await startWsServer(session, 19100);
    expect(ws.port).toBe(19100);
    await ws.stop();
  });

  it('retries on EADDRINUSE and binds to next free port', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(19110, '127.0.0.1', resolve));

    const session = makeMockSession();
    try {
      const ws = await startWsServer(session, 19110);
      expect(ws.port).toBe(19111);
      await ws.stop();
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});
