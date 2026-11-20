import { describe, expect, it, vi } from 'vitest';
import { Session } from '../session.js';
import { SessionBusyError } from '../turn-claim.js';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool } from '@robota-sdk/agent-core';
import type { IManagedRunProvider } from '@robota-sdk/agent-core';
import type { ISessionOptions } from '../session-types.js';

describe('managed provider session boundary', () => {
  it('keeps the admitted provider while a turn is in flight', async () => {
    const managed: IManagedRunProvider = {
      kind: 'managed-run',
      name: 'managed-test',
      version: 'test',
      run: vi.fn(),
      validateConfig: () => true,
    };
    const step = createScriptedProvider([{ text: 'completed' }]);
    const hook = vi.fn(async () => ({
      outcome: 'allow' as const,
      source: 'command' as const,
      stdout: '',
    }));
    let failWrapping = true;
    const options: ISessionOptions = {
      cwd: '/tmp',
      provider: step.provider,
      model: 'test-model',
      tools: [],
      systemMessage: 'system',
      hookTypeExecutors: [{ type: 'command', execute: hook }],
      hooks: { UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'test' }] }] },
      wrapAddedTools: (tools) => {
        if (failWrapping) {
          failWrapping = false;
          throw new Error('temporary tool wrapping failure');
        }
        return tools;
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
    };
    expect(options.provider.supportsTools()).toBe(true);
    const session = new Session(options);
    try {
      const turn = session.run('hello');
      expect(() => session.swapProvider(managed, 'test-model')).toThrow(SessionBusyError);
      await expect(turn).resolves.toBe('completed');
      expect(hook).toHaveBeenCalledOnce();
      expect(managed.run).not.toHaveBeenCalled();
      expect(session.getProvider()).toBe(step.provider);
      session.swapProvider(managed, 'test-model');
      await expect(session.run('later')).rejects.toMatchObject({ code: 'MANAGED_RUN_UNAVAILABLE' });
      expect(hook).toHaveBeenCalledOnce();
      session.swapProvider(step.provider, 'test-model');
      const tool = new FunctionTool(
        { name: 'added', description: 'test tool', parameters: { type: 'object', properties: {} } },
        async () => 'done',
      );
      await expect(session.addTools([tool])).rejects.toThrow('temporary tool wrapping failure');
      await expect(session.addTools([tool])).resolves.toEqual([]);
      expect((await session.listRuntimeTools()).map((entry) => entry.name)).toContain('added');
    } finally {
      await session.shutdown();
    }
  });

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
