import { describe, expect, it, vi } from 'vitest';

import { bindWithOwnerPath, ObservableEventService } from '@robota-sdk/agent-core';

import { PermissionEnforcer } from '../permission-enforcer.js';

import type { IToolExecutionContext } from '@robota-sdk/agent-core';

function setup(
  execute: () => Promise<{ success: boolean; data: string }>,
  permissionMode: 'bypassPermissions' | 'plan' = 'bypassPermissions',
) {
  const bus = new ObservableEventService();
  const events: { name: string; data: Record<string, unknown> }[] = [];
  bus.subscribe((name, data) => events.push({ name, data }));
  const enforcer = new PermissionEnforcer({
    sessionId: 'private-session',
    cwd: '/tmp',
    getPermissionMode: () => permissionMode,
    config: { permissions: { allow: [], deny: [] } },
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn().mockResolvedValue(''),
      select: vi.fn().mockResolvedValue(0),
      spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
    },
  });
  const tool = {
    getName: () => 'SameTool',
    execute,
    setEventService: vi.fn(),
  } as never;
  const [wrapped] = enforcer.wrapTools([tool]);
  const context = (id: string, signal?: AbortSignal): IToolExecutionContext => ({
    toolName: 'SameTool',
    parameters: { privateArg: 'do-not-export' },
    executionId: id,
    ...(signal ? { signal } : {}),
    eventService: bindWithOwnerPath(bus, {
      ownerType: 'tool',
      ownerId: id,
      ownerPath: [{ type: 'tool', id }],
    }),
  });
  return { wrapped, context, events };
}

describe('content-free actual tool body observations', () => {
  it('records one independently timed completion for parallel same-name calls', async () => {
    const { wrapped, context, events } = setup(async () => ({
      success: true,
      data: 'private output',
    }));
    await Promise.all([
      wrapped.execute({ privateArg: 'do-not-export' }, context('call-a')),
      wrapped.execute({ privateArg: 'do-not-export' }, context('call-b')),
    ]);
    const completions = events.filter((event) => event.name === 'tool.tool_body_completed');
    expect(completions).toHaveLength(2);
    expect(completions.map((event) => event.data['executionId']).sort()).toEqual([
      'call-a',
      'call-b',
    ]);
    for (const { data } of completions) {
      expect(new Date(data['startedAt'] as string).getTime()).toBeLessThanOrEqual(
        new Date(data['endedAt'] as string).getTime(),
      );
      expect(data['outcome']).toBe('success');
      expect(JSON.stringify(data)).not.toMatch(/private|output|SameTool/);
    }
  });

  it('records returned failure and thrown failure once each', async () => {
    const returned = setup(async () => ({ success: false, data: 'private failure' }));
    await returned.wrapped.execute({}, returned.context('returned'));
    expect(
      returned.events.filter((event) => event.name === 'tool.tool_body_completed'),
    ).toHaveLength(1);
    expect(
      returned.events.find((event) => event.name === 'tool.tool_body_completed')?.data['outcome'],
    ).toBe('failure');

    const thrown = setup(async () => {
      throw new Error('private crash');
    });
    await thrown.wrapped.execute({}, thrown.context('thrown'));
    expect(thrown.events.filter((event) => event.name === 'tool.tool_body_completed')).toHaveLength(
      1,
    );
    expect(
      thrown.events.find((event) => event.name === 'tool.tool_body_completed')?.data['outcome'],
    ).toBe('failure');
    expect(JSON.stringify(thrown.events)).not.toContain('private crash');
  });

  it('does not invent body execution for a pre-start abort', async () => {
    const execute = vi.fn(async () => ({ success: true, data: 'unused' }));
    const { wrapped, context, events } = setup(execute);
    const abort = new AbortController();
    abort.abort();
    await wrapped.execute({}, context('aborted', abort.signal));
    expect(execute).not.toHaveBeenCalled();
    expect(events.filter((event) => event.name === 'tool.tool_body_completed')).toHaveLength(0);
  });

  it('does not record a body denied before execution', async () => {
    const execute = vi.fn(async () => ({ success: true, data: 'unused' }));
    const { wrapped, context, events } = setup(execute, 'plan');
    await wrapped.execute({}, context('denied'));
    expect(execute).not.toHaveBeenCalled();
    expect(events.filter((event) => event.name === 'tool.tool_body_completed')).toHaveLength(0);
  });

  it('records interruption when a started body observes its aborted signal', async () => {
    const abort = new AbortController();
    const { wrapped, context, events } = setup(async () => {
      abort.abort();
      return { success: false, data: 'private interruption' };
    });
    await wrapped.execute({}, context('interrupted', abort.signal));
    const completions = events.filter((event) => event.name === 'tool.tool_body_completed');
    expect(completions).toHaveLength(1);
    expect(completions[0]?.data['outcome']).toBe('interrupted');
  });
});
