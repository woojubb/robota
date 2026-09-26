/**
 * One tool instance serves every session in a process: pack and MCP tools are built once. Each
 * session gives its tools its own event service, and a tool's own events (the `FunctionTool` span)
 * must reach the session that ran it, not whichever session set its service last.
 */

import { describe, expect, it, vi } from 'vitest';

import { FunctionTool, ObservableEventService, SPAN_EVENTS } from '@robota-sdk/agent-core';

import { PermissionEnforcer } from '../permission-enforcer.js';
import { Session } from '../session.js';

import type { IAIProvider, IToolWithEventService, ITerminalOutput } from '@robota-sdk/agent-core';

function terminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn(async () => ''),
    select: vi.fn(async () => 0),
    spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
  };
}

function sharedTool(name: string): FunctionTool {
  return new FunctionTool(
    { name, description: 'shared tool', parameters: { type: 'object', properties: {} } },
    async () => 'ok',
  );
}

/** The span ops a bus received, in order. */
function spansOn(bus: { subscribe: ObservableEventService['subscribe'] }): string[] {
  const ops: string[] = [];
  bus.subscribe((type, data) => {
    if (type === SPAN_EVENTS.COMPLETED) ops.push(String((data as { op?: unknown }).op));
  });
  return ops;
}

describe('a tool instance shared by several sessions', () => {
  it('delivers each wrapped call to the event service of the wrapper that made it', async () => {
    const tool = sharedTool('Shared');
    const wrap = (sessionId: string): IToolWithEventService => {
      const enforcer = new PermissionEnforcer({
        sessionId,
        cwd: '/tmp',
        getPermissionMode: () => 'default',
        config: { permissions: { allow: ['Shared'], deny: [] } },
        terminal: terminal(),
      });
      return enforcer.wrapTools([tool])[0]!;
    };
    const [a, b, silent] = [wrap('a'), wrap('b'), wrap('silent')];
    const [busA, busB] = [new ObservableEventService(), new ObservableEventService()];
    const [opsA, opsB] = [spansOn(busA), spansOn(busB)];
    a.setEventService(busA);
    b.setEventService(busB);
    const call = (wrapped: IToolWithEventService, id: string) =>
      wrapped.execute({}, { toolName: 'Shared', parameters: {}, executionId: id });

    await call(a, 'a1');
    await call(b, 'b1');
    await call(a, 'a2');
    // A wrapper whose session never set a service reaches no other session's.
    await call(silent, 's1');

    expect(opsA).toEqual(['Shared', 'Shared']);
    expect(opsB).toEqual(['Shared']);
  });

  it('keeps each session’s tool spans on that session’s event service', async () => {
    const tool = sharedTool('Shared');
    const makeSession = (): Session =>
      new Session({
        cwd: '/tmp',
        tools: [tool],
        provider: {
          name: 'test',
          version: '1',
          chat: vi.fn<IAIProvider['chat']>(),
          generateResponse: vi.fn<IAIProvider['generateResponse']>(),
          supportsTools: () => true,
          validateConfig: () => true,
        },
        systemMessage: 'test',
        terminal: terminal(),
        permissionHandler: async () => true,
        permissions: { allow: ['Shared', 'LateA', 'LateB'], deny: [] },
      });
    const [a, b] = [makeSession(), makeSession()];
    const [opsA, opsB] = [spansOn(a.getEventService()), spansOn(b.getEventService())];
    try {
      // A tool added mid-session re-registers every tool, which gives each its session's service;
      // B does so last.
      await a.addTools([sharedTool('LateA')]);
      await b.addTools([sharedTool('LateB')]);

      await a.invokeRuntimeTool('Shared', {});
      await b.invokeRuntimeTool('Shared', {});
      await a.invokeRuntimeTool('Shared', {});

      expect(opsA).toEqual(['Shared', 'Shared']);
      expect(opsB).toEqual(['Shared']);
    } finally {
      await a.shutdown();
      await b.shutdown();
    }
  });
});
