/**
 * #3189 — a client's command never stops or restarts a supervised session, the workspace daemon
 * included. A command that asks the host to exit or restart (`/reset`, `/language`, a provider switch)
 * keeps its saved change, and the client that ran it is told which command stops or starts the
 * session itself. A plain `--serve` still ends on it.
 */

import { tmpdir } from 'node:os';

import { createLanguageCommandModule, createResetCommandModule } from '@robota-sdk/agent-command';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { createOutboundDelivery, createSessionMessageHandler } from '@robota-sdk/agent-transport';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IServeModeOptions } from '../serve-mode.js';
import type { ICommandHostAdapters } from '@robota-sdk/agent-framework';
import type { TServerMessage } from '@robota-sdk/agent-transport';

const shutdown = vi.fn(async (_reason?: string) => undefined);

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-framework')>();
  return {
    ...actual,
    startRuntimeHost: async () => ({
      session: { current: {} },
      shutdown,
      waitForCompletion: async () => [],
      waitForFailure: () => new Promise(() => undefined),
    }),
  };
});

// The control endpoint is not what these tests exercise; a supervised start only needs one to close.
vi.mock('../../session-inventory/supervised-session-control.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session-inventory/supervised-session-control.js')>()),
  startSupervisedControl: async () => ({ close: async () => undefined }),
}));

const { runServeMode } = await import('../serve-mode.js');

const SUPERVISED_ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

/** Longer than the window serve mode waits before it tears down after a command's exit or restart. */
const PAST_TEARDOWN_WINDOW_MS = 700;

const signalListeners: Array<{ signal: NodeJS.Signals; listener: (...args: unknown[]) => void }> =
  [];
const restores: Array<() => void> = [];

afterEach(() => {
  for (const { signal, listener } of signalListeners.splice(0))
    process.removeListener(signal, listener);
  for (const restore of restores.splice(0)) restore();
  shutdown.mockClear();
});

/**
 * Stand in for the launcher on this process's readiness channel: acknowledge the runtime's ready
 * message, so a supervised serve finishes starting. The ack goes to the listener serve mode added,
 * never through the process's own message event, which the test runner listens on too.
 */
function actAsLauncher(): { readonly sent: unknown[] } {
  const original = process.send;
  restores.push(() => {
    process.send = original;
  });
  const before = new Set(process.listeners('message'));
  const sent: unknown[] = [];
  process.send = ((message: unknown, done?: (error: Error | null) => void): boolean => {
    sent.push(message);
    done?.(null);
    if (typeof message === 'object' && message !== null && 'kind' in message && message.kind === 'ready') {
      for (const listener of process.listeners('message')) {
        if (!before.has(listener))
          (listener as (message: unknown) => void)({ kind: 'ack', id: SUPERVISED_ID });
      }
    }
    return true;
  }) as typeof process.send;
  return { sent };
}

function serveOptions(
  args: Partial<IServeModeOptions['args']>,
  adapters: ICommandHostAdapters,
): IServeModeOptions {
  return {
    cwd: '/work/project',
    args: args as IServeModeOptions['args'],
    provider: {} as IServeModeOptions['provider'],
    sessionStore: undefined as unknown as IServeModeOptions['sessionStore'],
    backgroundTaskRunners: [],
    subagentRunnerFactory: (() =>
      undefined) as unknown as IServeModeOptions['subagentRunnerFactory'],
    commandModules: [],
    commandHostAdapters: adapters,
    transportRegistry: {} as IServeModeOptions['transportRegistry'],
    preset: {},
  };
}

/** Start serve mode, and keep the signal listeners it adds so the test can stop it and clean up. */
async function startServe(
  options: IServeModeOptions,
): Promise<{ run: Promise<void>; stop: () => void }> {
  const before = new Map(
    (['SIGTERM', 'SIGINT'] as const).map((signal) => [signal, new Set(process.listeners(signal))]),
  );
  const run = runServeMode(options);
  await vi.waitFor(() => expect(options.commandHostAdapters.process).toBeDefined());
  for (const [signal, previous] of before) {
    for (const listener of process.listeners(signal)) {
      if (!previous.has(listener))
        signalListeners.push({ signal, listener: listener as (...args: unknown[]) => void });
    }
  }
  const sigterm = signalListeners.find((entry) => entry.signal === 'SIGTERM');
  return { run, stop: () => sigterm?.listener('SIGTERM') };
}

function createRuntimeSession(): Record<string, unknown> {
  return {
    run: vi.fn().mockResolvedValue('answer'),
    abort: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    injectMessage: vi.fn(),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 0,
      usedPercentage: 0,
      remainingPercentage: 100,
    }),
    getSessionId: () => 'session_daemon',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

/** A session on the adapters serve mode completed, with one client attached over the session protocol. */
function attachClient(
  adapters: ICommandHostAdapters,
): (name: string, args: string) => Promise<TServerMessage> {
  const session = new InteractiveSession({
    session: createRuntimeSession() as never,
    commandModules: [createLanguageCommandModule(), createResetCommandModule()],
    commandHostAdapters: adapters,
  });
  const sent: TServerMessage[] = [];
  const { onMessage } = createSessionMessageHandler({
    session,
    deliver: createOutboundDelivery((message) => sent.push(message), vi.fn()),
    driverId: 'desktop-app',
  });
  return async (name, args) => {
    const seen = sent.length;
    onMessage(JSON.stringify({ type: 'command', name, args }));
    await vi.waitFor(() => {
      if (!sent.slice(seen).some((message) => message.type === 'command_result'))
        throw new Error('no result yet');
    });
    return sent.slice(seen).find((message) => message.type === 'command_result')!;
  };
}

function settingsAdapter(): NonNullable<ICommandHostAdapters['settings']> & {
  write: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return { read: () => ({}), write: vi.fn(), delete: vi.fn(() => true) };
}

describe('a command in a served runtime (#3189)', () => {
  it('never stops or restarts a daemon, and tells the client how to restart it', async () => {
    const settings = settingsAdapter();
    const options = serveOptions({ daemon: true }, { settings });
    const { run, stop } = await startServe(options);
    const command = attachClient(options.commandHostAdapters);

    const language = await command('language', 'ko');
    const reset = await command('reset', '');

    // Each change is saved before the host is asked to act on it, so the daemon's next start applies it.
    expect(settings.write).toHaveBeenCalledWith({ language: 'ko' });
    expect(settings.delete).toHaveBeenCalledOnce();
    for (const result of [language, reset]) {
      expect(result).toMatchObject({ type: 'command_result', success: false });
      expect(result.type === 'command_result' && result.message).toMatch(
        /robota daemon stop[\s\S]*robota daemon start/,
      );
    }
    expect(language.type === 'command_result' && language.message).toContain('The change is saved');
    expect(reset.type === 'command_result' && reset.message).toContain(
      'Detach this client to leave',
    );

    await new Promise((resolve) => setTimeout(resolve, PAST_TEARDOWN_WINDOW_MS));
    expect(shutdown).not.toHaveBeenCalled();

    stop();
    await run;
    expect(shutdown).toHaveBeenCalledWith('received SIGTERM');
  });

  it('never stops or restarts a supervised session, and names the command that stops it', async () => {
    const launcher = actAsLauncher();
    const settings = settingsAdapter();
    const options = {
      ...serveOptions({ supervisedSessionId: SUPERVISED_ID }, { settings }),
      cwd: tmpdir(),
    };
    const { run, stop } = await startServe(options);
    await vi.waitFor(() =>
      expect(launcher.sent).toContainEqual({ kind: 'acknowledged', id: SUPERVISED_ID }),
    );
    const command = attachClient(options.commandHostAdapters);

    const language = await command('language', 'ko');
    const reset = await command('reset', '');

    expect(settings.write).toHaveBeenCalledWith({ language: 'ko' });
    expect(settings.delete).toHaveBeenCalledOnce();
    for (const result of [language, reset]) {
      expect(result).toMatchObject({ type: 'command_result', success: false });
      const message = result.type === 'command_result' ? result.message : '';
      expect(message).toContain(`robota session stop ${SUPERVISED_ID}`);
      expect(message).toContain('robota session start');
      expect(message).not.toContain('robota daemon');
    }
    expect(language.type === 'command_result' && language.message).toContain('The change is saved');
    expect(reset.type === 'command_result' && reset.message).toContain(
      'Detach this client to leave',
    );

    await new Promise((resolve) => setTimeout(resolve, PAST_TEARDOWN_WINDOW_MS));
    expect(shutdown).not.toHaveBeenCalled();

    stop();
    await run;
    expect(shutdown).toHaveBeenCalledWith('received SIGTERM');
  });

  it('still ends a plain served runtime when a command restarts it', async () => {
    const settings = settingsAdapter();
    const options = serveOptions({}, { settings });
    const { run } = await startServe(options);
    const command = attachClient(options.commandHostAdapters);

    const language = await command('language', 'ko');

    expect(language).toMatchObject({ type: 'command_result', success: true });
    expect(language.type === 'command_result' && language.message).toContain('Restarting...');
    await run;
    expect(shutdown).toHaveBeenCalledWith('command restart: Language change restart');
  });

  it('still ends a plain served runtime when a command exits it', async () => {
    const settings = settingsAdapter();
    const options = serveOptions({}, { settings });
    const { run } = await startServe(options);
    const command = attachClient(options.commandHostAdapters);

    const reset = await command('reset', '');

    expect(reset).toMatchObject({ type: 'command_result', success: true });
    await run;
    expect(shutdown).toHaveBeenCalledWith('command exit (other)');
  });
});
