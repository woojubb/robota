import { describe, it, expect, vi } from 'vitest';
import { createWsTransport } from '../ws-transport.js';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';

function createMockSession(): InteractiveSession {
  return {
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getContextState: vi
      .fn()
      .mockReturnValue({ usedPercentage: 0, usedTokens: 0, maxTokens: 200000 }),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    executeCommand: vi.fn().mockResolvedValue({ message: 'ok', success: true }),
    listCommands: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as InteractiveSession;
}

describe('createWsTransport', () => {
  it('returns an adapter with name "ws"', () => {
    const transport = createWsTransport({ send: vi.fn() });
    expect(transport.name).toBe('ws');
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createWsTransport({ send: vi.fn() });
    await expect(transport.start()).rejects.toThrow('No session attached');
  });

  it('onMessage is null before start()', () => {
    const transport = createWsTransport({ send: vi.fn() });
    expect(transport.onMessage).toBeNull();
  });

  it('provides onMessage after attach + start', async () => {
    const transport = createWsTransport({ send: vi.fn() });
    transport.attach(createMockSession());
    await transport.start();
    expect(typeof transport.onMessage).toBe('function');
  });

  it('clears onMessage after stop()', async () => {
    const transport = createWsTransport({ send: vi.fn() });
    transport.attach(createMockSession());
    await transport.start();
    await transport.stop();
    expect(transport.onMessage).toBeNull();
  });
});
