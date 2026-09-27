import { describe, expect, it, vi } from 'vitest';
import type {
  ICommandHostContext,
  IEditCheckpointRestoreResult,
} from '@robota-sdk/agent-framework';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createModeCommandModule } from '../mode-command-module.js';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

type TPermissionModeName = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';
type TSetPermissionModeSpy = ReturnType<typeof vi.fn<(nextMode: TPermissionModeName) => void>>;

function createCheckpointResult(): IEditCheckpointRestoreResult {
  return {
    target: {
      id: 'checkpoint_1',
      sessionId: 'session_1',
      sequence: 1,
      prompt: 'edit files',
      createdAt: '2026-05-03T00:00:00.000Z',
      fileCount: 1,
    },
    restoredCheckpointCount: 0,
    restoredFileCount: 0,
    removedCheckpointCount: 0,
  };
}

function createCommandHostContext(): ReturnType<typeof createTestCommandHost> & {
  setPermissionMode: TSetPermissionModeSpy;
} {
  let mode: TPermissionModeName = 'default';
  const setPermissionMode = vi.fn((nextMode: TPermissionModeName) => {
    mode = nextMode;
  });

  return {
    ...createTestCommandHost({
      overrides: {
        getSession: () => {
          throw new Error('mode command should use the permission mode adapter');
        },
        getCommandHostAdapters: () => ({
          permissionMode: {
            getPermissionMode: () => mode,
            setPermissionMode,
            listSessionAllowedTools: () => [],
            getPermissionRules: () => ({ allow: [], deny: [], ask: [] }),
            listRecentDenials: () => [],
            retryDenial: () => undefined,
          },
        }),
        getContextState: () => ({
          usedTokens: 0,
          maxTokens: 1,
          usedPercentage: 0,
          remainingPercentage: 100,
        }),
        getAutoCompactThreshold: () => 0.835,
        compactContext: async () => undefined,
        getCwd: () => '/workspace',
        listEditCheckpoints: () => [],
        restoreEditCheckpoint: async () => createCheckpointResult(),
        rollbackEditCheckpoint: async () => createCheckpointResult(),
        getUsedMemoryReferences: () => [],
        recordMemoryEvent: () => undefined,
        listBackgroundTasks: () => [],
        readBackgroundTaskLog: async () => ({ taskId: 'task_1', lines: [] }),
        cancelBackgroundTask: async () => undefined,
        closeBackgroundTask: async () => undefined,
      },
    }),
    setPermissionMode,
  };
}

describe('createModeCommandModule', () => {
  it('provides mode metadata and executable command from one module owner', () => {
    const module = createModeCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-mode');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'mode',
        description: 'Show/change permission mode',
        argumentHint: 'plan | default | acceptEdits | bypassPermissions | auto',
        source: 'mode',
        modelInvocable: false,
      }),
    );
    expect(entry?.subcommands?.map((subcommand) => subcommand.name)).toEqual([
      'plan',
      'default',
      'acceptEdits',
      'bypassPermissions',
      'auto',
    ]);
    // #3282 §2: a plain label beside every description, so a client never shows the raw id.
    expect(entry?.subcommands?.map((subcommand) => subcommand.displayName)).toEqual([
      'Plan only',
      'Ask first',
      'Accept edits',
      'Skip all checks',
      'Auto',
    ]);
    expect(entry?.subcommands?.every((subcommand) => subcommand.description.length > 0)).toBe(true);
    expect(command).toEqual(
      expect.objectContaining({
        name: 'mode',
        description: 'Show/change permission mode',
        argumentHint: 'plan | default | acceptEdits | bypassPermissions | auto',
        lifecycle: 'inline',
        modelInvocable: false,
      }),
    );
    expect(command?.subcommands).toEqual(entry?.subcommands);
  });

  it('reports the current permission mode through the SDK command adapter', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModeCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('mode', createCommandHostContext(), '');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Current mode: default');
    expect(result?.data?.mode).toBe('default');
  });

  it('updates valid permission modes through the SDK command adapter', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModeCommandModule().systemCommands ?? []),
    ]);
    const context = createCommandHostContext();

    const result = await executor.execute('mode', context, 'plan');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Permission mode set to: plan');
    expect(result?.data?.mode).toBe('plan');
    expect(context.setPermissionMode).toHaveBeenCalledWith('plan');
  });

  it('rejects invalid permission modes without writing state', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModeCommandModule().systemCommands ?? []),
    ]);
    const context = createCommandHostContext();

    const result = await executor.execute('mode', context, 'invalid');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe(
      'Invalid mode. Valid: plan | default | acceptEdits | bypassPermissions | auto',
    );
    expect(context.setPermissionMode).not.toHaveBeenCalled();
  });

  it('#3282 §2: the picker shows plain labels with their descriptions, never a raw id', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModeCommandModule().systemCommands ?? []),
    ]);
    const context = createCommandHostContext();
    const ask = vi.fn().mockResolvedValue({ type: 'answer', values: ['plan'] });
    const contextWithAsk = createTestCommandHost({
      overrides: { ...context, getUserInteraction: () => ({ ask }) },
    });

    await executor.execute('mode', contextWithAsk, '');

    expect(ask).toHaveBeenCalledTimes(1);
    const request = ask.mock.calls[0]![0];
    expect(request.options).toEqual([
      { value: 'plan', label: 'Plan only', description: 'Plan only, no execution' },
      { value: 'default', label: 'Ask first', description: 'Ask before risky actions' },
      { value: 'acceptEdits', label: 'Accept edits', description: 'Auto-approve file edits' },
      {
        value: 'bypassPermissions',
        label: 'Skip all checks',
        description: 'Skip all permission checks',
      },
      {
        value: 'auto',
        label: 'Auto',
        description: 'A model classifier approves or blocks risky actions',
      },
    ]);
  });

  it('asks the user to pick a mode when no arg is given and a renderer is attached (CMD-004)', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModeCommandModule().systemCommands ?? []),
    ]);
    const context = createCommandHostContext();
    const contextWithAsk = createTestCommandHost({
      overrides: {
        ...context,
        getUserInteraction: () => ({ ask: async () => ({ type: 'answer', values: ['plan'] }) }),
      },
    });

    const result = await executor.execute('mode', contextWithAsk, '');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Permission mode set to: plan');
    expect(context.setPermissionMode).toHaveBeenCalledWith('plan');
  });

  it('reports the current mode when the user cancels the pick (CMD-004)', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModeCommandModule().systemCommands ?? []),
    ]);
    const context = createCommandHostContext();
    const contextWithAsk = createTestCommandHost({
      overrides: {
        ...context,
        getUserInteraction: () => ({ ask: async () => ({ type: 'cancelled' }) }),
      },
    });

    const result = await executor.execute('mode', contextWithAsk, '');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Current mode: default');
    expect(context.setPermissionMode).not.toHaveBeenCalled();
  });
});
