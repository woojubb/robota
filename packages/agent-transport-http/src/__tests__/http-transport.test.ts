import { describe, it, expect, vi } from 'vitest';
import { createHttpTransport } from '../http-transport.js';
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

describe('createHttpTransport', () => {
  it('returns an adapter with name "http"', () => {
    const transport = createHttpTransport();
    expect(transport.name).toBe('http');
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createHttpTransport();
    await expect(transport.start()).rejects.toThrow('No session attached');
  });

  it('throws if getApp() is called before start()', () => {
    const transport = createHttpTransport();
    expect(() => transport.getApp()).toThrow('Transport not started');
  });

  it('creates a Hono app after attach + start', async () => {
    const transport = createHttpTransport();
    transport.attach(createMockSession());
    await transport.start();
    const app = transport.getApp();
    expect(app).toBeDefined();
    expect(typeof app.fetch).toBe('function');
  });

  it('nullifies app after stop()', async () => {
    const transport = createHttpTransport();
    transport.attach(createMockSession());
    await transport.start();
    await transport.stop();
    expect(() => transport.getApp()).toThrow('Transport not started');
  });
});
