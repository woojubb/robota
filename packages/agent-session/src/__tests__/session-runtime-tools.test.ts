import { describe, expect, it, vi } from 'vitest';
import { FunctionTool } from '@robota-sdk/agent-core';
import { Session } from '../session.js';
import { SessionBusyError } from '../turn-claim.js';
import type { IAIProvider, IToolExecutionContext, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { ISessionOptions } from '../session-types.js';

function fixture(
  execute: (context?: IToolExecutionContext) => Promise<string> = async () => 'ok',
  overrides: Partial<ISessionOptions> = {},
) {
  const chat = vi.fn<IAIProvider['chat']>();
  const handler = vi.fn(async () => true);
  const tool = new FunctionTool(
    { name: 'Write', description: 'test tool', parameters: { type: 'object', properties: {} } },
    async (_args, context) => execute(context),
  );
  const session = new Session({
    cwd: '/tmp',
    tools: [tool],
    provider: {
      name: 'test',
      version: '1',
      chat,
      generateResponse: vi.fn<IAIProvider['generateResponse']>(),
      supportsTools: () => true,
      validateConfig: () => true,
    },
    systemMessage: 'test',
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn(async () => ''),
      select: vi.fn(async () => 0),
      spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
    },
    permissionHandler: handler,
    ...overrides,
  });
  return { session, chat, handler };
}

describe('direct session runtime tools', () => {
  it('does not start the tool if cancellation arrives while its pre-hook is running', async () => {
    let release!: () => void;
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const executor: IHookTypeExecutor = {
      type: 'command',
      execute: async () => {
        started();
        await held;
        return { outcome: 'allow', source: 'command', stdout: '' };
      },
    };
    const execute = vi.fn(async () => 'should not execute');
    const { session } = fixture(execute, {
      permissions: { allow: ['Write'], deny: [] },
      hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'test' }] }] },
      hookTypeExecutors: [executor],
    });
    const controller = new AbortController();
    const result = session.invokeRuntimeTool('Write', {}, { signal: controller.signal });
    await active;
    controller.abort();
    release();
    try {
      expect(await result).toMatchObject({ success: false });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      await session.shutdown();
    }
  });

  it('uses the normal pre/post hook and tool event path and preserves hook denials', async () => {
    const events: string[] = [];
    let deny = false;
    const executor: IHookTypeExecutor = {
      type: 'command',
      execute: async (_definition, input) => {
        events.push(input.hook_event_name);
        return deny
          ? { outcome: 'deny', source: 'command', reason: 'blocked by hook' }
          : { outcome: 'allow', source: 'command', stdout: '' };
      },
    };
    const group = [{ matcher: '', hooks: [{ type: 'command', command: 'test' }] }];
    const execute = vi.fn(async () => 'done');
    const { session } = fixture(execute, {
      permissions: { allow: ['Write'], deny: [] },
      hooks: { PreToolUse: group, PostToolUse: group },
      hookTypeExecutors: [executor],
    });
    const toolEvents: string[] = [];
    session.getEventService().subscribe((type) => toolEvents.push(type));
    try {
      expect(await session.invokeRuntimeTool('Write', {})).toMatchObject({ success: true });
      expect(events).toContain('PreToolUse');
      expect(events).toContain('PostToolUse');
      expect(toolEvents.some((type) => type.endsWith('call_complete'))).toBe(true);
      deny = true;
      expect(await session.invokeRuntimeTool('Write', {})).toMatchObject({ success: false });
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      await session.shutdown();
    }
  });

  it('rejects already-cancelled calls and turns without executing and releases the claim', async () => {
    const execute = vi.fn(async () => 'done');
    const { session, chat } = fixture(execute, { permissions: { allow: ['Write'], deny: [] } });
    const caller = new AbortController();
    caller.abort();
    try {
      await expect(
        session.invokeRuntimeTool('Write', {}, { signal: caller.signal }),
      ).rejects.toThrow();
      await expect(
        session.run('cancelled', undefined, { signal: caller.signal }),
      ).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
      expect(chat).not.toHaveBeenCalled();
      expect(session.isRunning()).toBe(false);
      expect(await session.invokeRuntimeTool('Write', {})).toMatchObject({ success: true });
    } finally {
      await session.shutdown();
    }
  });

  it('holds the shared claim through cancellation and shutdown until the tool settles', async () => {
    let finish!: () => void;
    let started!: () => void;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let signal: AbortSignal | undefined;
    const { session } = fixture(
      async (context) => {
        signal = context?.signal;
        started();
        await held;
        return 'done';
      },
      { permissions: { allow: ['Write'], deny: [] } },
    );
    const caller = new AbortController();
    const first = session.invokeRuntimeTool('Write', {}, { signal: caller.signal });
    expect(session.isRunning()).toBe(true);
    await active;
    await expect(session.invokeRuntimeTool('Write', {})).rejects.toBeInstanceOf(SessionBusyError);
    await expect(session.run('overlap')).rejects.toBeInstanceOf(SessionBusyError);
    caller.abort();
    expect(signal?.aborted).toBe(true);
    expect(session.isRunning()).toBe(true);
    let stopped = false;
    const stopping = session.shutdown().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    await expect(session.invokeRuntimeTool('Write', {})).rejects.toThrow('shutting down');
    finish();
    await first;
    await stopping;
    expect(session.isRunning()).toBe(false);
    await expect(session.listRuntimeTools()).rejects.toThrow('shutting down');
  });

  it('refuses interactive approval but invokes explicit allows through truncation and audit without a model call', async () => {
    const execute = vi.fn(async () => 'x'.repeat(40000));
    const denied = fixture(execute);
    const onToolExecution = vi.fn();
    const allowed = fixture(execute, {
      permissions: { allow: ['Write'], deny: [] },
      onToolExecution,
    });
    try {
      expect((await allowed.session.listRuntimeTools()).map((tool) => tool.name)).toEqual([
        'Write',
      ]);
      expect(await denied.session.invokeRuntimeTool('Write', {})).toMatchObject({ success: false });
      expect(denied.handler).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      const result = await allowed.session.invokeRuntimeTool('Write', {});
      expect(result.success).toBe(true);
      expect(typeof result.result).toBe('string');
      expect(String(result.result).length).toBeLessThan(40000);
      expect(onToolExecution).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'end', success: true }),
      );
      expect(allowed.chat).not.toHaveBeenCalled();
    } finally {
      await Promise.all([denied.session.shutdown(), allowed.session.shutdown()]);
    }
  });
});
