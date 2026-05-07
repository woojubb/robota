import { describe, expect, it, vi } from 'vitest';
import type { ICommandHostContext, IEditCheckpointRestoreResult } from '@robota-sdk/agent-sdk';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createPermissionsCommandModule } from '../permissions-command-module.js';

type TPermissionModeName = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';
type TSetPermissionModeSpy = ReturnType<typeof vi.fn<[nextMode: TPermissionModeName], void>>;

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

function createCommandHostContext(options?: {
  mode?: TPermissionModeName;
  sessionAllowed?: readonly string[];
}): ICommandHostContext & { setPermissionMode: TSetPermissionModeSpy } {
  let mode = options?.mode ?? 'default';
  const setPermissionMode = vi.fn((nextMode: TPermissionModeName) => {
    mode = nextMode;
  });

  return {
    getSession: () => {
      throw new Error('permissions command should use the permission mode adapter');
    },
    getCommandHostAdapters: () => ({
      permissionMode: {
        getPermissionMode: () => mode,
        setPermissionMode,
        listSessionAllowedTools: () => options?.sessionAllowed ?? [],
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
    setPermissionMode,
  };
}

describe('createPermissionsCommandModule', () => {
  it('provides permissions metadata and user-only executable command from one module owner', () => {
    const module = createPermissionsCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-permissions');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'permissions',
        description: 'Show/change permission mode and permission rules',
        argumentHint: 'plan | default | acceptEdits | bypassPermissions',
        source: 'permissions',
        modelInvocable: false,
      }),
    );
    expect(entry?.subcommands?.map((subcommand) => subcommand.name)).toEqual([
      'plan',
      'default',
      'acceptEdits',
      'bypassPermissions',
    ]);
    expect(command).toEqual(
      expect.objectContaining({
        name: 'permissions',
        description: 'Show/change permission mode and permission rules',
        argumentHint: 'plan | default | acceptEdits | bypassPermissions',
        lifecycle: 'inline',
        modelInvocable: false,
      }),
    );
    expect(command?.subcommands).toEqual(entry?.subcommands);
  });

  it('reports no session-approved tools when the command allowlist is empty', async () => {
    const executor = new SystemCommandExecutor([
      ...(createPermissionsCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('permissions', createCommandHostContext(), '');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe('Permission mode: default\nNo session-approved tools.');
    expect(result?.data).toEqual({ mode: 'default', sessionAllowed: [] });
  });

  it('reports session-approved tools when present', async () => {
    const executor = new SystemCommandExecutor([
      ...(createPermissionsCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute(
      'permissions',
      createCommandHostContext({ mode: 'acceptEdits', sessionAllowed: ['Bash', 'Read'] }),
      '',
    );

    expect(result?.success).toBe(true);
    expect(result?.message).toBe(
      'Permission mode: acceptEdits\nSession-approved tools: Bash, Read',
    );
    expect(result?.data).toEqual({ mode: 'acceptEdits', sessionAllowed: ['Bash', 'Read'] });
  });

  it('updates valid permission modes through the SDK command adapter', async () => {
    const executor = new SystemCommandExecutor([
      ...(createPermissionsCommandModule().systemCommands ?? []),
    ]);
    const context = createCommandHostContext();

    const result = await executor.execute('permissions', context, 'plan');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe(
      'Permission mode set to: plan\nPermission mode: plan\nNo session-approved tools.',
    );
    expect(result?.data).toEqual({ mode: 'plan', sessionAllowed: [] });
    expect(context.setPermissionMode).toHaveBeenCalledWith('plan');
  });

  it('rejects invalid permission modes without writing state', async () => {
    const executor = new SystemCommandExecutor([
      ...(createPermissionsCommandModule().systemCommands ?? []),
    ]);
    const context = createCommandHostContext();

    const result = await executor.execute('permissions', context, 'invalid');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe(
      'Invalid mode. Valid: plan | default | acceptEdits | bypassPermissions',
    );
    expect(context.setPermissionMode).not.toHaveBeenCalled();
  });
});
