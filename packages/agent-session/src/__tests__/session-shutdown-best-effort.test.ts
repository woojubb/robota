/**
 * Session.shutdown is best-effort (CORE-013 disposal convention): a failing shutdown step
 * (e.g. a SessionEnd hook whose executor throws) must not reject the shutdown promise —
 * `void session.shutdown()` would otherwise become a process-killing unhandled rejection.
 */

import { describe, expect, it, vi } from 'vitest';

import { Session } from '../session.js';

import type { IHookTypeExecutor } from '@robota-sdk/agent-core';

const MOCK_PROVIDER = {
  name: 'mock-provider',
  version: '1.0.0',
  chat: vi.fn().mockResolvedValue({
    role: 'assistant',
    content: 'mock',
    timestamp: new Date(),
  }),
  supportsTools: () => true,
  validateConfig: () => true,
};

const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn().mockResolvedValue(''),
  select: vi.fn().mockResolvedValue(0),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
};

describe('Session.shutdown — best-effort disposal (CORE-013)', () => {
  it('resolves even when the SessionEnd hook executor throws', async () => {
    const throwingExecutor: IHookTypeExecutor = {
      type: 'command',
      execute: vi.fn().mockRejectedValue(new Error('hook boom')),
    };
    const session = new Session({
      tools: [] as never,
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'boom' }] }] },
      hookTypeExecutors: [throwingExecutor],
    });

    // Never rejects — safe to fire-and-forget.
    await expect(session.shutdown({ reason: 'other' })).resolves.toBeUndefined();
  });

  it('returns the same cached promise on repeated shutdown calls', async () => {
    const session = new Session({
      tools: [] as never,
      provider: MOCK_PROVIDER as never,
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
    });

    const first = session.shutdown();
    const second = session.shutdown();
    expect(first).toBe(second);
    await expect(first).resolves.toBeUndefined();
  });
});
