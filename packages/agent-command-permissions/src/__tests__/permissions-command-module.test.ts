import { describe, expect, it } from 'vitest';
import type { ICommandHostContext, IEditCheckpointRestoreResult } from '@robota-sdk/agent-sdk';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createPermissionsCommandModule } from '../permissions-command-module.js';

type TPermissionModeName = 'plan' | 'default' | 'acceptEdits' | 'bypassPermissions';

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
}): ICommandHostContext {
  return {
    getSession: () => {
      throw new Error('permissions command should use the permission mode adapter');
    },
    getCommandHostAdapters: () => ({
      permissionMode: {
        getPermissionMode: () => options?.mode ?? 'default',
        setPermissionMode: () => undefined,
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
        description: 'Show permission rules',
        source: 'permissions',
        modelInvocable: false,
      }),
    );
    expect(command).toEqual(
      expect.objectContaining({
        name: 'permissions',
        description: 'Show permission rules',
        lifecycle: 'inline',
        modelInvocable: false,
      }),
    );
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
});
