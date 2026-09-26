/**
 * #3189 — serve mode attaches its session directory to the host's slot before the transports start,
 * builds a switched-to session with the runtime's own options, and stops offering switches once the
 * runtime is stopping.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServeSessionDirectory } from '../serve-session-directory.js';

import type { IServeModeOptions } from '../serve-mode.js';
import type { InteractiveSession } from '@robota-sdk/agent-framework';

const built: Array<Record<string, unknown>> = [];

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-framework')>();
  const fakeSession = (id: string) => ({
    isExecuting: () => false,
    getPendingPrompt: () => null,
    getPendingCount: () => 0,
    listBackgroundTasks: () => [],
    getLocalActivityStatus: () => 'idle' as const,
    getSession: () => ({ getSessionId: () => id }),
    whenInitialized: async () => undefined,
    shutdown: async () => undefined,
  });
  return {
    ...actual,
    buildRuntimeSession: (options: Record<string, unknown>) => {
      built.push(options);
      return fakeSession(String(options['resumeSessionId'] ?? 'fresh'));
    },
    startRuntimeHost: async (options: { bindTransports?: (slot: unknown) => void }) => {
      const slot = {
        current: fakeSession('initial'),
        replace: async (next: ReturnType<typeof fakeSession>) => {
          slot.current = next;
        },
      };
      options.bindTransports?.(slot);
      return {
        session: slot,
        shutdown: async () => undefined,
        waitForCompletion: async () => [],
        waitForFailure: () => new Promise(() => undefined),
      };
    },
  };
});

const { runServeMode } = await import('../serve-mode.js');

afterEach(() => {
  built.length = 0;
});

function serveOptions(
  sessionDirectory: IServeModeOptions['sessionDirectory'],
  bindTransports = vi.fn(),
): IServeModeOptions {
  return {
    cwd: '/work/project',
    args: { forkSession: true, sessionName: 'launch-name' } as IServeModeOptions['args'],
    provider: {} as IServeModeOptions['provider'],
    sessionStore: {
      save: () => undefined,
      load: () => ({ status: 'missing' }),
      list: () => [
        {
          id: 'stored',
          outcome: {
            status: 'valid',
            record: {
              id: 'stored',
              cwd: '/work/project',
              createdAt: '2026-09-01T00:00:00Z',
              updatedAt: '2026-09-01T00:00:00Z',
              messages: [],
            },
          },
        },
      ],
      delete: () => undefined,
    } as unknown as IServeModeOptions['sessionStore'],
    backgroundTaskRunners: [],
    subagentRunnerFactory: (() =>
      undefined) as unknown as IServeModeOptions['subagentRunnerFactory'],
    commandModules: [],
    commandHostAdapters: {},
    transportRegistry: {} as IServeModeOptions['transportRegistry'],
    bindTransports,
    preset: {},
    resumeSessionId: 'launch-session',
    sessionDirectory,
  };
}

describe('serve mode session directory wiring (#3189)', () => {
  it('attaches the directory before binding transports and switches with the runtime options', async () => {
    const directory = createServeSessionDirectory<InteractiveSession>();
    let listedAtBind: string | undefined;
    const bindTransports = vi.fn(() => {
      listedAtBind = directory.listSessions().currentSessionId;
    });
    const options = serveOptions(directory, bindTransports);
    const run = runServeMode(options);
    await vi.waitFor(() => expect(bindTransports).toHaveBeenCalled());

    expect(listedAtBind).toBe('initial');
    await directory.switchSession('stored');
    expect(directory.listSessions().currentSessionId).toBe('stored');
    const switched = built.at(-1)!;
    expect(switched['resumeSessionId']).toBe('stored');
    // A switch opens exactly the stored session: the launch's fork and name do not carry over.
    expect(switched['forkSession']).toBeUndefined();
    expect(switched['sessionName']).toBeUndefined();
    expect(switched['cwd']).toBe('/work/project');

    await directory.newSession();
    expect(built.at(-1)!['resumeSessionId']).toBeUndefined();

    options.commandHostAdapters.process?.requestExit('other');
    await vi.waitFor(() =>
      expect(directory.newSession()).rejects.toThrow('This runtime is stopping.'),
    );
    await run;
  });
});
