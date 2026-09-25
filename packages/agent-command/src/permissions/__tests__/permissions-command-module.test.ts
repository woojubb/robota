import { describe, expect, it, vi } from 'vitest';
import type {
  ICommandHostContext,
  IEditCheckpointRestoreResult,
  IPermissionRuleLayer,
  IPermissionsCommandState,
} from '@robota-sdk/agent-framework';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createPermissionsCommandModule } from '../permissions-command-module.js';
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

function createCommandHostContext(options?: {
  mode?: TPermissionModeName;
  sessionAllowed?: readonly string[];
  rules?: { allow: string[]; deny: string[]; ask: string[] };
  denials?: IPermissionsCommandState['recentDenials'];
  layers?: readonly IPermissionRuleLayer[];
  retryDenial?: (index: number) => IPermissionsCommandState['recentDenials'][number] | undefined;
}): ReturnType<typeof createTestCommandHost> & { setPermissionMode: TSetPermissionModeSpy } {
  let mode = options?.mode ?? 'default';
  const setPermissionMode = vi.fn((nextMode: TPermissionModeName) => {
    mode = nextMode;
  });

  return {
    ...createTestCommandHost({
      overrides: {
        getSession: () => {
          throw new Error('permissions command should use the permission mode adapter');
        },
        getCommandHostAdapters: () => ({
          permissionMode: {
            getPermissionMode: () => mode,
            setPermissionMode,
            listSessionAllowedTools: () => options?.sessionAllowed ?? [],
            getPermissionRules: () => options?.rules ?? { allow: [], deny: [], ask: [] },
            listRecentDenials: () => options?.denials ?? [],
            retryDenial: (index: number) => options?.retryDenial?.(index),
          },
          ...(options?.layers !== undefined
            ? { permissionRules: { readLayers: () => options.layers! } }
            : {}),
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
        argumentHint: 'plan | default | acceptEdits | bypassPermissions | auto',
        source: 'permissions',
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
    expect(command).toEqual(
      expect.objectContaining({
        name: 'permissions',
        description: 'Show/change permission mode and permission rules',
        argumentHint: 'plan | default | acceptEdits | bypassPermissions | auto',
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
    expect(result?.message).toBe(
      'Permission mode: default\n\nRules: none configured.\n\nNo session-approved tools.\n\nRecent denials: none.',
    );
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
    expect(result?.message).toContain('Approved this session ("allow always"): Bash, Read');
    expect(result?.data).toEqual({ mode: 'acceptEdits', sessionAllowed: ['Bash', 'Read'] });
  });

  it('lists the effective rules under the settings file each comes from, and recent denials (issue #3082)', async () => {
    const executor = new SystemCommandExecutor([
      ...(createPermissionsCommandModule().systemCommands ?? []),
    ]);
    const at = new Date(2026, 8, 25, 9, 5, 7).getTime();
    const result = await executor.execute(
      'permissions',
      createCommandHostContext({
        rules: { allow: ['Read', 'mcp__docs__*'], deny: ['Bash(rm *)'], ask: ['Bash(git push*)'] },
        layers: [
          {
            source: '~/.robota/settings.json',
            scope: 'user',
            allow: ['Read'],
            deny: ['Bash(rm *)'],
            ask: [],
          },
          {
            source: '.robota/settings.json',
            scope: 'project',
            allow: ['Read', 'Stale'],
            deny: [],
            ask: ['Bash(git push*)'],
          },
        ],
        denials: [{ toolName: 'Bash', argument: 'rm -rf ~', reason: 'policy', at }],
      }),
      '',
    );
    expect(result?.message).toContain(
      [
        'Rules (checked deny, then ask, then allow):',
        '  ~/.robota/settings.json [user]',
        '    deny: Bash(rm *)',
        '    allow: Read',
        '  .robota/settings.json [project]',
        '    ask: Bash(git push*)',
        '    allow: Read',
        '  this session (CLI flags, preset, commands)',
        '    allow: mcp__docs__*',
      ].join('\n'),
    );
    // A layer's rule the session does not enforce is not listed as if it were.
    expect(result?.message).not.toContain('Stale');
    expect(result?.message).toContain(
      'Recent denials (most recent first):\n  1. 09:05:07  Bash(rm -rf ~) — denied by a rule or the mode',
    );
  });

  it('updates valid permission modes through the SDK command adapter', async () => {
    const executor = new SystemCommandExecutor([
      ...(createPermissionsCommandModule().systemCommands ?? []),
    ]);
    const context = createCommandHostContext();

    const result = await executor.execute('permissions', context, 'plan');

    expect(result?.success).toBe(true);
    expect(result?.message).toMatch(/^Permission mode set to: plan\nPermission mode: plan\n/);
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
      'Invalid mode. Valid: plan | default | acceptEdits | bypassPermissions | auto',
    );
    expect(context.setPermissionMode).not.toHaveBeenCalled();
  });

  it('reports a mode the session refuses instead of throwing', async () => {
    const executor = new SystemCommandExecutor([
      ...(createPermissionsCommandModule().systemCommands ?? []),
    ]);
    const context = createCommandHostContext();
    context.setPermissionMode.mockImplementation(() => {
      throw new Error('Auto mode is unavailable: this session has no permission classifier.');
    });

    const result = await executor.execute('permissions', context, 'auto');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe(
      'Auto mode is unavailable: this session has no permission classifier.',
    );
  });

  it('retries a classifier denial by the number /permissions shows (issue #3082)', async () => {
    const executor = new SystemCommandExecutor([
      ...(createPermissionsCommandModule().systemCommands ?? []),
    ]);
    const denial = {
      toolName: 'Bash',
      argument: 'npm publish',
      reason: 'classifier' as const,
      detail: 'publishes a package',
      at: 0,
    };
    const retryDenial = vi.fn((index: number) => (index === 0 ? denial : undefined));
    const context = createCommandHostContext({ denials: [denial], retryDenial });

    const listed = await executor.execute('permissions', context, '');
    expect(listed?.message).toContain(
      '1. 00:00:00  Bash(npm publish) — blocked by the auto-mode classifier: publishes a package',
    );
    expect(listed?.message).toContain('/permissions retry <n>');

    const retried = await executor.execute('permissions', context, 'retry 1');
    expect(retried?.success).toBe(true);
    expect(retried?.message).toContain('Bash(npm publish) will run once');
    expect(retryDenial).toHaveBeenCalledWith(0);

    const missing = await executor.execute('permissions', context, 'retry 2');
    expect(missing?.success).toBe(false);
    expect(missing?.message).toMatch(/^Usage: \/permissions retry <n>/);
  });
});
