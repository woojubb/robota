import { describe, it, expect, vi } from 'vitest';
import { createHeadlessTransport } from '../headless-transport.js';
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
    getSession: vi.fn().mockReturnValue({ getSessionId: () => 'test-session-id' }),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as InteractiveSession;
}

describe('createHeadlessTransport', () => {
  it('returns an adapter with name "headless"', () => {
    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'hello' });
    expect(transport.name).toBe('headless');
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'hello' });
    await expect(transport.start()).rejects.toThrow('No session attached');
  });

  it('returns exit code 0 by default', () => {
    const transport = createHeadlessTransport({ outputFormat: 'text', prompt: 'hello' });
    expect(transport.getExitCode()).toBe(0);
  });
});
