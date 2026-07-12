import { AddressInfo } from 'node:net';

import { WebSocket } from 'ws';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { WsTransport } from '../ws-transport-configurable.js';

import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

/**
 * GUI-002 TC-03 — required loopback auth token. A configured token MUST be presented (query param or
 * `Sec-WebSocket-Protocol` subprotocol) or the socket is closed BEFORE any session data (`messages` /
 * `execution_workspace_event`) is emitted. No token configured = unchanged (open) behavior.
 */

function mockSession(): IInteractiveSession {
  return {
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue({ entries: [] }),
    on: vi.fn(),
    off: vi.fn(),
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    executeCommand: vi.fn(),
    resolvePermission: vi.fn(),
    resolveAsk: vi.fn(),
  } as unknown as IInteractiveSession;
}

const started: WsTransport[] = [];

async function startOn(config: { token?: string }): Promise<number> {
  // Use a high, unlikely-occupied base port; retry covers rare collisions.
  const port = 17000 + Math.floor((started.length + 1) * 7);
  const t = new WsTransport({ port, maxRetries: 30, ...config });
  t.attach(mockSession());
  await t.start();
  started.push(t);
  return port;
}

afterEach(async () => {
  while (started.length) await started.pop()!.stop();
});

/**
 * Connect and resolve with the outcome: `'messages'` if a `messages` frame arrives first, or `'closed'`
 * with the close code if the socket closes before any frame. 1.5s guard so a hang fails loudly.
 */
function probe(port: number, opts: { token?: string; subprotocol?: string } = {}): Promise<string> {
  const url = `ws://127.0.0.1:${port}${opts.token ? `?token=${encodeURIComponent(opts.token)}` : ''}`;
  const ws = opts.subprotocol ? new WebSocket(url, opts.subprotocol) : new WebSocket(url);
  return new Promise<string>((resolve) => {
    const done = (v: string): void => {
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      resolve(v);
    };
    const timer = setTimeout(() => done('timeout'), 1500);
    ws.on('message', (data) => {
      const msg = JSON.parse(String(data)) as { type: string };
      if (msg.type === 'messages') {
        clearTimeout(timer);
        done('messages');
      }
    });
    ws.on('close', (code) => {
      clearTimeout(timer);
      done(`closed:${code}`);
    });
    ws.on('error', () => {
      clearTimeout(timer);
      done('closed:error');
    });
  });
}

describe('WsTransport loopback auth (GUI-002 TC-03)', () => {
  it('accepts a connection presenting the correct token via query param', async () => {
    const port = await startOn({ token: 'secret-nonce' });
    expect(await probe(port, { token: 'secret-nonce' })).toBe('messages');
  });

  it('accepts the correct token via Sec-WebSocket-Protocol subprotocol', async () => {
    const port = await startOn({ token: 'secret-nonce' });
    expect(await probe(port, { subprotocol: 'secret-nonce' })).toBe('messages');
  });

  it('rejects a MISSING token before any session data is emitted', async () => {
    const port = await startOn({ token: 'secret-nonce' });
    expect(await probe(port)).toBe('closed:1008'); // never 'messages'
  });

  it('rejects a WRONG token before any session data is emitted', async () => {
    const port = await startOn({ token: 'secret-nonce' });
    expect(await probe(port, { token: 'not-the-nonce' })).toBe('closed:1008');
  });

  it('unchanged (open) behavior when NO token is configured — default TUI path', async () => {
    const port = await startOn({}); // no token
    expect(await probe(port)).toBe('messages'); // any connection is served
  });
});
