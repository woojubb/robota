import { describe, expect, it, vi } from 'vitest';
import { Session } from '../session.js';
import type { IManagedRunProvider } from '@robota-sdk/agent-core';

describe('managed provider session boundary', () => {
  it('refuses a turn and a helper compaction without invoking the provider or changing history', async () => {
    const run = vi.fn<IManagedRunProvider['run']>();
    const provider: IManagedRunProvider = {
      kind: 'managed-run',
      name: 'managed-test',
      version: 'test',
      run,
      validateConfig: () => true,
    };
    const hook = vi.fn(async () => ({
      outcome: 'allow' as const,
      source: 'command' as const,
      stdout: '',
    }));
    const session = new Session({
      cwd: '/tmp',
      provider,
      model: 'test-model',
      tools: [],
      systemMessage: 'system',
      hookTypeExecutors: [{ type: 'command', execute: hook }],
      hooks: {
        UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'test' }] }],
        PreCompact: [{ matcher: '', hooks: [{ type: 'command', command: 'test' }] }],
      },
      terminal: {
        write: vi.fn(),
        writeLine: vi.fn(),
        writeMarkdown: vi.fn(),
        writeError: vi.fn(),
        prompt: vi.fn(async () => ''),
        select: vi.fn(async () => 0),
        spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
      },
    });
    session.injectRawMessage({
      id: 'existing',
      role: 'user',
      content: 'existing context',
      state: 'complete',
      timestamp: new Date(0),
    });
    const before = session.getHistory();
    try {
      expect(session.getExecutionProvider()).toBe(provider);
      expect(() => session.getProvider()).toThrow(/Managed execution is not available/);
      await expect(session.run('hello')).rejects.toMatchObject({ code: 'MANAGED_RUN_UNAVAILABLE' });
      await expect(session.compact()).rejects.toMatchObject({ code: 'MANAGED_RUN_UNAVAILABLE' });
      expect(session.getHistory()).toEqual(before);
      expect(run).not.toHaveBeenCalled();
      expect(hook).not.toHaveBeenCalled();
    } finally {
      await session.shutdown();
    }
  });
});
