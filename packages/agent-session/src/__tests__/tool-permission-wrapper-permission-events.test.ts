/**
 * The wrapper emits exactly one content-free `TOOL_PERMISSION_EVENTS.DECIDED` per call, at the point
 * the decision is actually reached — hook-blocked, denied, or allowed — carrying the same
 * `executionId` a permitted body's `TOOL_BODY_EVENTS.COMPLETED` carries, so a host can join them by
 * call ID. An observer must never turn a completed decision into a broken tool_result.
 */

import { describe, it, expect, vi } from 'vitest';

import { TOOL_PERMISSION_EVENTS } from '@robota-sdk/agent-core';
import { wrapToolWithPermission } from '../tool-permission-wrapper.js';

import type { IToolWrapperDeps } from '../tool-permission-wrapper.js';
import type {
  IEventService,
  IToolExecutionContext,
  IToolResult,
  IToolWithEventService,
  TEventListener,
} from '@robota-sdk/agent-core';

function makeTool(execute: IToolWithEventService['execute']): IToolWithEventService {
  return {
    schema: { name: 'demo', description: 'demo', parameters: { type: 'object', properties: {}, required: [] } },
    getName: () => 'demo',
    getDescription: () => 'demo',
    validate: () => true,
    validateParameters: () => ({ isValid: true, errors: [] }),
    execute,
    setEventService: () => undefined,
  };
}

function makeDeps(overrides: Partial<IToolWrapperDeps> = {}): IToolWrapperDeps {
  return {
    sessionId: 'sess-1',
    cwd: '/tmp',
    config: { permissions: { allow: [], deny: [] } },
    terminal: {
      write: vi.fn(), writeLine: vi.fn(), writeMarkdown: vi.fn(), writeError: vi.fn(),
      prompt: vi.fn().mockResolvedValue(''), select: vi.fn().mockResolvedValue(0),
      spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
    },
    getPermissionMode: () => 'default',
    log: () => undefined,
    checkPermission: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function makeRecordingEventService(): { eventService: IEventService; seen: Array<{ type: string; data: unknown }> } {
  const seen: Array<{ type: string; data: unknown }> = [];
  const listeners = new Set<TEventListener>();
  const eventService = {
    emit: (type: string, data: unknown) => {
      seen.push({ type, data });
      for (const listener of listeners) listener(type, data as never);
    },
    subscribe: (listener: TEventListener) => { listeners.add(listener); },
    unsubscribe: (listener: TEventListener) => { listeners.delete(listener); },
  } as unknown as IEventService;
  return { eventService, seen };
}

describe('tool-permission-wrapper — permission decision events', () => {
  it('emits exactly one allowed decision, carrying the call ID, before the tool body runs', async () => {
    const { eventService, seen } = makeRecordingEventService();
    const tool = makeTool(async () => ({ success: true, data: 'ok' }));
    const wrapped = wrapToolWithPermission(tool, makeDeps());
    const context: IToolExecutionContext = { toolName: 'demo', parameters: {}, executionId: 'call-1', eventService };
    await wrapped.execute({}, context);

    const decisions = seen.filter((e) => e.type === TOOL_PERMISSION_EVENTS.DECIDED);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.data).toMatchObject({ executionId: 'call-1', decision: 'allowed' });
  });

  it('emits exactly one denied decision and never runs the tool body', async () => {
    const { eventService, seen } = makeRecordingEventService();
    const bodyExecuted = vi.fn(async () => ({ success: true, data: 'ok' }) as IToolResult);
    const tool = makeTool(bodyExecuted);
    const wrapped = wrapToolWithPermission(tool, makeDeps({ checkPermission: vi.fn().mockResolvedValue(false) }));
    const context: IToolExecutionContext = { toolName: 'demo', parameters: {}, executionId: 'call-2', eventService };
    await wrapped.execute({}, context);

    const decisions = seen.filter((e) => e.type === TOOL_PERMISSION_EVENTS.DECIDED);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.data).toMatchObject({ executionId: 'call-2', decision: 'denied' });
    expect(bodyExecuted).not.toHaveBeenCalled();
  });

  it('emits exactly one hook-blocked decision and never runs the tool body', async () => {
    const { eventService, seen } = makeRecordingEventService();
    const bodyExecuted = vi.fn(async () => ({ success: true, data: 'ok' }) as IToolResult);
    const tool = makeTool(bodyExecuted);
    const wrapped = wrapToolWithPermission(tool, makeDeps({
      config: {
        permissions: { allow: [], deny: [] },
        hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'noop' }] }] },
      },
      hookTypeExecutors: [{
        type: 'command',
        execute: async () => ({ outcome: 'deny', source: 'command', reason: 'blocked-by-test' }),
      }],
    }));
    const context: IToolExecutionContext = { toolName: 'demo', parameters: {}, executionId: 'call-3', eventService };
    await wrapped.execute({}, context);

    const decisions = seen.filter((e) => e.type === TOOL_PERMISSION_EVENTS.DECIDED);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.data).toMatchObject({ executionId: 'call-3', decision: 'hook-blocked' });
    expect(bodyExecuted).not.toHaveBeenCalled();
  });

  it('never lets a throwing observer change the returned tool_result', async () => {
    const throwingEventService = {
      emit: () => { throw new Error('observer exploded'); },
      subscribe: () => undefined,
      unsubscribe: () => undefined,
    } as unknown as IEventService;
    const tool = makeTool(async () => ({ success: true, data: 'ok' }));
    const wrapped = wrapToolWithPermission(tool, makeDeps());
    const context: IToolExecutionContext = {
      toolName: 'demo', parameters: {}, executionId: 'call-4', eventService: throwingEventService,
    };
    await expect(wrapped.execute({}, context)).resolves.toMatchObject({ success: true, data: 'ok' });
  });
});
