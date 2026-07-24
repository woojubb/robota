/**
 * CMD-004 Phase 2 (TC-02) — host-action executor in the `executeCommand` pipeline.
 *
 * Drives `InteractiveSession.executeCommand` with stub `ICommandHostAdapters` and inline command
 * modules emitting the split contract (`hostActions` / `uiIntents` — Stage E deleted the legacy
 * effect union), asserting:
 * - `language-change` writes via the settings adapter and requests a restart via the process adapter;
 * - `settings-reset` deletes via the settings adapter and requests an exit;
 * - applied host actions and emitted intents are CONSUMED — the returned result carries neither;
 * - a UI intent emits exactly ONE `ui_intent` stamped with the invoking driver id passed into
 *   `executeCommand` (owner default for local `'user'` commands; unattributed for remote without id);
 * - ZERO attached surfaces still applies host actions (headless parity);
 * - an absent adapter yields an EXPLICIT failure in the command result (no-fallback), never a
 *   silent skip;
 * - no double execution (adapter call counts).
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { ICommandHostAdapters } from '../../command-api/host-adapters.js';
import type { ICommandModule, ICommandResult } from '../../commands/index.js';
import type { IUiIntentEvent } from '@robota-sdk/agent-interface-transport';

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
    getSessionId: () => 'session_host_actions',
    getMessageCount: () => 0,
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getEventService: () => ({ subscribe: () => {}, unsubscribe: () => {} }),
  };
}

/** Inline single-command module returning a fixed result (the effect emitters under test). */
function moduleReturning(name: string, result: ICommandResult): ICommandModule {
  return {
    name: `test-module-${name}`,
    systemCommands: [
      {
        name,
        description: `test command ${name}`,
        requiresPermission: false,
        lifecycle: 'inline',
        execute: () => result,
      },
    ],
  };
}

function createSession(
  adapters: ICommandHostAdapters,
  modules: ICommandModule[],
): InteractiveSession {
  return new InteractiveSession({
    session: createRuntimeSession() as never,
    commandModules: modules,
    commandHostAdapters: adapters,
  });
}

function stubSettings(initial: Record<string, unknown> = {}): {
  read: () => Record<string, never>;
  write: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    read: () => ({ ...initial }) as Record<string, never>,
    write: vi.fn(),
    delete: vi.fn().mockReturnValue(true),
  };
}

describe('CMD-004 TC-02 — host-action executor over ICommandHostAdapters', () => {
  it('language-change writes via the settings adapter, requests restart, and strips the effect', async () => {
    const settings = stubSettings({ theme: 'dark' });
    const requestRestart = vi.fn();
    const session = createSession({ settings, process: { requestExit: vi.fn(), requestRestart } }, [
      moduleReturning('language', {
        success: true,
        message: 'Language set to "ko".',
        hostActions: [{ type: 'language-change', language: 'ko' }],
      }),
    ]);

    // HEADLESS PARITY: no listener is attached to this session at all — host actions still apply.
    const result = await session.executeCommand('language', 'ko');

    expect(settings.write).toHaveBeenCalledTimes(1);
    expect(settings.write).toHaveBeenCalledWith({ theme: 'dark', language: 'ko' });
    expect(requestRestart).toHaveBeenCalledTimes(1);
    expect(requestRestart).toHaveBeenCalledWith('other', 'Language change restart');
    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Language set to "ko".\nRestarting...');
    expect(result?.hostActions).toBeUndefined(); // applied host action consumed — no duplicate application
  });

  it('settings-reset deletes via the settings adapter and requests exit', async () => {
    const settings = stubSettings();
    const requestExit = vi.fn();
    const session = createSession({ settings, process: { requestExit, requestRestart: vi.fn() } }, [
      moduleReturning('reset', {
        success: true,
        message: 'Reset requested.',
        hostActions: [{ type: 'settings-reset' }],
      }),
    ]);

    const result = await session.executeCommand('reset', '');

    expect(settings.delete).toHaveBeenCalledTimes(1);
    expect(requestExit).toHaveBeenCalledTimes(1);
    expect(requestExit).toHaveBeenCalledWith('other');
    expect(result?.success).toBe(true);
    expect(result?.message).toContain('User settings deleted');
    expect(result?.hostActions).toBeUndefined(); // consumed
  });

  it('session-exit uses the process adapter with the default end reason', async () => {
    const requestExit = vi.fn();
    const session = createSession({ process: { requestExit, requestRestart: vi.fn() } }, [
      moduleReturning('exit', {
        success: true,
        message: 'Exit requested.',
        hostActions: [{ type: 'session-exit' }],
      }),
    ]);

    const result = await session.executeCommand('exit', '');

    expect(requestExit).toHaveBeenCalledTimes(1);
    expect(requestExit).toHaveBeenCalledWith('prompt_input_exit');
    expect(result?.hostActions).toBeUndefined(); // consumed
  });

  it('an ABSENT adapter yields an explicit failure in the command result — never a silent skip', async () => {
    const session = createSession({}, [
      moduleReturning('exit', {
        success: true,
        message: 'Exit requested.',
        hostActions: [{ type: 'session-exit' }],
      }),
    ]);

    const result = await session.executeCommand('exit', '');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe(
      "Cannot apply 'session-exit': a process adapter is not available in this environment.",
    );
  });

  it('an absent settings delete() capability fails the reset explicitly', async () => {
    const session = createSession(
      {
        settings: { read: () => ({}), write: vi.fn() }, // no delete()
        process: { requestExit: vi.fn(), requestRestart: vi.fn() },
      },
      [
        moduleReturning('reset', {
          success: true,
          message: 'Reset requested.',
          hostActions: [{ type: 'settings-reset' }],
        }),
      ],
    );

    const result = await session.executeCommand('reset', '');

    expect(result?.success).toBe(false);
    expect(result?.message).toContain("Cannot apply 'settings-reset'");
  });

  it('statusline-settings-patch is applied host-side through the settings adapter', async () => {
    const settings = stubSettings({ statusline: { enabled: true, gitBranch: true } });
    const session = createSession({ settings }, [
      moduleReturning('statusline', {
        success: true,
        message: 'Status line disabled.',
        hostActions: [{ type: 'statusline-settings-patch', patch: { enabled: false } }],
      }),
    ]);

    const result = await session.executeCommand('statusline', 'off');

    expect(settings.write).toHaveBeenCalledTimes(1);
    expect(settings.write).toHaveBeenCalledWith(
      expect.objectContaining({ statusline: { enabled: false, gitBranch: true } }),
    );
    expect(result?.hostActions).toBeUndefined(); // consumed
  });

  it('remote-control enable executes through the adapter and folds the returned message', async () => {
    const enable = vi.fn().mockResolvedValue('Scan this QR: https://pair.example');
    const session = createSession(
      { remoteControl: { getStatus: () => ({ state: 'off' }), enable, stop: vi.fn() } },
      [
        moduleReturning('remote-control', {
          success: true,
          message: 'Enabling remote control...',
          hostActions: [{ type: 'remote-control-enable' }],
        }),
      ],
    );

    const result = await session.executeCommand('remote-control', '');

    expect(enable).toHaveBeenCalledTimes(1);
    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Enabling remote control...\nScan this QR: https://pair.example');
    expect(result?.hostActions).toBeUndefined(); // consumed
  });

  it('remote-control enable without the adapter capability fails explicitly', async () => {
    const session = createSession(
      { remoteControl: { getStatus: () => ({ state: 'off' }) } }, // status-only adapter
      [
        moduleReturning('remote-control', {
          success: true,
          message: 'Enabling remote control...',
          hostActions: [{ type: 'remote-control-enable' }],
        }),
      ],
    );

    const result = await session.executeCommand('remote-control', '');

    expect(result?.success).toBe(false);
    expect(result?.message).toContain("Cannot apply 'remote-control-enable'");
  });

  it('an adapter error surfaces as an explicit failure result (no-fallback), not a silent skip', async () => {
    const session = createSession(
      {
        settings: {
          read: () => ({}),
          write: () => {
            throw new Error('disk full');
          },
        },
        process: { requestExit: vi.fn(), requestRestart: vi.fn() },
      },
      [
        moduleReturning('language', {
          success: true,
          message: 'Language set to "ko".',
          hostActions: [{ type: 'language-change', language: 'ko' }],
        }),
      ],
    );

    const result = await session.executeCommand('language', 'ko');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe("Failed to apply 'language-change': disk full");
  });

  it('a UI intent emits exactly one ui_intent and is consumed from the result', async () => {
    const session = createSession({}, [
      moduleReturning('settings', {
        success: true,
        message: 'Opening settings...',
        uiIntents: [{ type: 'show-settings' }],
      }),
    ]);
    const intents: IUiIntentEvent[] = [];
    session.on('ui_intent', (event) => intents.push(event));

    const result = await session.executeCommand('settings', '');

    // Exactly one emission; a local 'user' command defaults to the owner driver.
    expect(intents).toEqual([{ intent: { type: 'show-settings' }, requesterDriverId: 'owner' }]);
    // The intent is delivered as an event — the returned result no longer carries it.
    expect(result?.uiIntents).toBeUndefined();
  });

  it('stamps ui_intent with the command-origin driver id passed into executeCommand', async () => {
    const session = createSession({}, [
      moduleReturning('settings', {
        success: true,
        message: 'Opening settings...',
        uiIntents: [{ type: 'show-settings' }],
      }),
    ]);
    const intents: IUiIntentEvent[] = [];
    session.on('ui_intent', (event) => intents.push(event));

    await session.executeCommand('settings', '', 'remote', 'device-42');

    expect(intents).toEqual([
      { intent: { type: 'show-settings' }, requesterDriverId: 'device-42' },
    ]);
  });

  it('a remote command WITHOUT an injected driver id emits an unattributed intent (never client-trusted)', async () => {
    const session = createSession({}, [
      moduleReturning('settings', {
        success: true,
        message: 'Opening settings...',
        uiIntents: [{ type: 'show-settings' }],
      }),
    ]);
    const intents: IUiIntentEvent[] = [];
    session.on('ui_intent', (event) => intents.push(event));

    await session.executeCommand('settings', '', 'remote');

    expect(intents).toEqual([{ intent: { type: 'show-settings' } }]);
  });

  it('a model-invoked command with no origin falls back to the active turn driver — idle turn ⇒ unattributed', async () => {
    // `activeDriverId` is a TURN attribute; outside a running turn it is null, so a model-sourced
    // command executed while idle emits an unattributed intent (the fallback engages only when a
    // turn is active — the CMD-005 model-command path). This pins the fallback branch's idle half.
    const session = createSession({}, [
      moduleReturning('settings', {
        success: true,
        message: 'Opening settings...',
        uiIntents: [{ type: 'show-settings' }],
      }),
    ]);
    const intents: IUiIntentEvent[] = [];
    session.on('ui_intent', (event) => intents.push(event));

    await session.executeCommand('settings', '', 'model');

    expect(intents).toEqual([{ intent: { type: 'show-settings' } }]);
  });

  it('result data hints pass through untouched (requester-local carriers, e.g. pluginRegistryReloaded)', async () => {
    const session = createSession({}, [
      moduleReturning('plugin', {
        success: true,
        message: 'Reloaded 1 plugin resource.',
        data: { pluginRegistryReloaded: true },
      }),
    ]);

    const result = await session.executeCommand('plugin', 'reload');

    expect(result?.data).toEqual({ pluginRegistryReloaded: true });
  });

  it('a failed command result passes through without applying anything', async () => {
    const requestExit = vi.fn();
    const session = createSession({ process: { requestExit, requestRestart: vi.fn() } }, [
      moduleReturning('exit', {
        success: false,
        message: 'nope',
        hostActions: [{ type: 'session-exit' }],
      }),
    ]);

    const result = await session.executeCommand('exit', '');

    expect(requestExit).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      message: 'nope',
      hostActions: [{ type: 'session-exit' }],
    });
  });

  it('executes hostActions emitted directly on the split contract (Stage-E emitters)', async () => {
    const requestExit = vi.fn();
    const session = createSession({ process: { requestExit, requestRestart: vi.fn() } }, [
      moduleReturning('bye', {
        success: true,
        message: 'Bye.',
        hostActions: [{ type: 'session-exit', reason: 'prompt_input_exit' }],
      }),
    ]);

    const result = await session.executeCommand('bye', '');

    expect(requestExit).toHaveBeenCalledTimes(1);
    expect(result?.success).toBe(true);
    expect(result?.hostActions).toBeUndefined(); // consumed
  });
});
