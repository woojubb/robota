/**
 * #3189 — one client's `/mode` shows on every client: the session pushes its status when it
 * changes, and only then.
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { ICommandModule } from '../../commands/index.js';
import type { ISessionStatusSnapshot } from '@robota-sdk/agent-interface-session';

function runtimeSession(state: { mode: string; usedTokens: number }): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: state.usedTokens,
      usedPercentage: state.usedTokens,
      remainingPercentage: 100 - state.usedTokens,
    }),
    getSessionId: () => 'session_status_push',
    getModelId: () => 'test-model',
    getPermissionMode: () => state.mode,
    getModelEffort: () => 'auto',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
    injectMessage: vi.fn(),
  };
}

function commands(state: { mode: string }): ICommandModule {
  return {
    name: 'test-status-commands',
    systemCommands: [
      {
        name: 'mode',
        description: 'Set the mode',
        requiresPermission: false,
        lifecycle: 'inline',
        execute: (_context, args) => {
          state.mode = args;
          return { success: true, message: `mode ${args}` };
        },
      },
      {
        name: 'noop',
        description: 'Change nothing',
        requiresPermission: false,
        lifecycle: 'inline',
        execute: () => ({ success: true, message: 'nothing' }),
      },
    ],
  };
}

function setup(): {
  session: InteractiveSession;
  state: { mode: string; usedTokens: number };
  pushed: ISessionStatusSnapshot[];
} {
  const state = { mode: 'default', usedTokens: 0 };
  const session = new InteractiveSession({
    session: runtimeSession(state) as never,
    cwd: '/tmp',
    commandModules: [commands(state)],
  });
  const pushed: ISessionStatusSnapshot[] = [];
  session.on('status_changed', (status) => pushed.push(status));
  return { session, state, pushed };
}

describe('InteractiveSession status push (#3189)', () => {
  it('pushes the status once when a command changes it', async () => {
    const { session, pushed } = setup();

    await session.executeCommand('mode', 'plan');

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({ sessionId: 'session_status_push', permissionMode: 'plan' });

    await session.executeCommand('mode', 'plan');
    expect(pushed).toHaveLength(1);
  });

  it('pushes nothing when a command changes nothing', async () => {
    const { session, pushed } = setup();

    await session.executeCommand('noop', '');

    expect(pushed).toEqual([]);
  });

  it('does not count context usage as a status change after a turn', async () => {
    const { session, state, pushed } = setup();

    state.usedTokens = 40;
    const handle = await session.submit('Hello');
    await handle.completed;

    expect(pushed).toEqual([]);
  });

  it('pushes after a turn that changed the status', async () => {
    const { session, state, pushed } = setup();

    state.mode = 'acceptEdits';
    const handle = await session.submit('Hello');
    await handle.completed;

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.permissionMode).toBe('acceptEdits');
  });

  it('pushes the new name after a rename', async () => {
    const { session, pushed } = setup();

    await session.executeCommand('noop', '');
    session.setName('renamed');
    await session.executeCommand('noop', '');

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.sessionName).toBe('renamed');
  });
});
