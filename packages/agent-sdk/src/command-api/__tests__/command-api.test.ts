import type { IContextWindowState, TPermissionMode } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';
import type {
  ICommandHostContext,
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
  ICommandResult,
  ICommandSessionRuntime,
  ISystemCommand,
} from '../index.js';
import { buildProviderProfile, formatEnvReference, validateProviderProfile } from '../index.js';
import {
  buildLanguageCommandSubcommands,
  buildMemoryCommandSubcommands,
  buildPermissionModeSubcommands,
  buildPluginCommandSubcommands,
  buildStatusLineCommandSubcommands,
  clearConversationHistory,
  createCommandMemoryStores,
  createCommandPendingMemoryStore,
  addCommandContextReference,
  clearCommandContextReferences,
  createPluginTuiRequestedEffect,
  createSessionExitRequestedEffect,
  createSessionPickerRequestedEffect,
  createSessionRenamedEffect,
  formatCommandSessionReplayValidationReport,
  formatCommandBackgroundTaskList,
  buildBackgroundCommandSubcommands,
  listCommandBackgroundTasks,
  parseCommandBackgroundLogCursor,
  DEFAULT_STATUS_LINE_COMMAND_SETTINGS,
  createPluginRegistryReloadRequestedEffect,
  formatCommandPermissionsMessage,
  formatLanguageUsageMessage,
  hasSensitiveCommandMemoryContent,
  isCommandMemoryType,
  isStatusLineCommandSettingsPatch,
  listCommandContextReferences,
  listCommandUsedMemoryReferences,
  parseSessionNameArgument,
  readCommandSessionInfo,
  validateCommandSessionReplayLog,
  removeCommandContextReference,
  readCommandPermissionsState,
  readCommandPermissionMode,
  resolvePluginCommandAdapter,
  resetAutoCompactThresholdSetting,
  setCommandAutoCompactThreshold,
  writeCommandPermissionMode,
  writeAutoCompactThresholdSetting,
} from '../index.js';
import type { IEditCheckpointRestoreResult } from '../../checkpoints/index.js';

const CONTEXT_STATE: IContextWindowState = {
  maxTokens: 100,
  usedTokens: 25,
  usedPercentage: 25,
  remainingPercentage: 75,
};

const CONTEXT_REFERENCE: IContextReferenceItem = {
  id: 'manual:AGENTS.md',
  sourcePath: '/workspace/AGENTS.md',
  relativePath: 'AGENTS.md',
  originalReference: '@AGENTS.md',
  loadType: 'manual',
  status: 'active',
  byteLength: 32,
  loadedAt: '2026-05-05T00:00:00.000Z',
  lastUsedAt: '2026-05-05T00:00:00.000Z',
};

function createCommandSessionRuntime(): ICommandSessionRuntime {
  let mode: TPermissionMode = 'default';
  return {
    clearHistory: () => undefined,
    compact: async () => undefined,
    getContextState: () => CONTEXT_STATE,
    getPermissionMode: () => mode,
    setPermissionMode: (nextMode) => {
      mode = nextMode;
    },
    getSessionId: () => 'session_1',
    getMessageCount: () => 2,
    getSessionAllowedTools: () => [],
    getAutoCompactThreshold: () => 0.8,
  };
}

function createCheckpointResult(): IEditCheckpointRestoreResult {
  const target = {
    id: 'checkpoint_1',
    sessionId: 'session_1',
    sequence: 1,
    prompt: 'edit files',
    createdAt: '2026-05-03T00:00:00.000Z',
    fileCount: 1,
  };
  return {
    target,
    restoredCheckpointCount: 1,
    restoredFileCount: 1,
    removedCheckpointCount: 0,
  };
}

function createCommandHostContext(): ICommandHostContext {
  const runtime = createCommandSessionRuntime();
  let settings: Record<string, number | false> = {};
  let threshold: number | false = 0.8;
  let contextReferences: IContextReferenceItem[] = [];
  return {
    getSession: () => runtime,
    getContextState: () => CONTEXT_STATE,
    getAutoCompactThreshold: () => threshold,
    setAutoCompactThreshold: (nextThreshold) => {
      threshold = nextThreshold;
    },
    getCommandHostAdapters: () => ({
      settings: {
        read: () => settings,
        write: (nextSettings) => {
          const value = nextSettings.autoCompactThreshold;
          settings =
            typeof value === 'number' || value === false ? { autoCompactThreshold: value } : {};
        },
      },
    }),
    compactContext: async () => undefined,
    listContextReferences: () => [...contextReferences],
    addContextReference: async (path): Promise<IContextReferenceAddResult> => {
      const reference = {
        ...CONTEXT_REFERENCE,
        relativePath: path,
        sourcePath: `/workspace/${path}`,
        originalReference: `@${path}`,
      };
      contextReferences = [...contextReferences, reference];
      return { reference, evicted: [], diagnostics: [] };
    },
    removeContextReference: (path): IContextReferenceRemoveResult => {
      const removed = contextReferences.find((reference) => reference.relativePath === path);
      contextReferences = contextReferences.filter((reference) => reference.relativePath !== path);
      return removed ? { removed } : {};
    },
    clearContextReferences: (): IContextReferenceClearResult => {
      const removed = [...contextReferences];
      contextReferences = [];
      return { removed };
    },
    getCwd: () => '/workspace',
    listCommands: () => [{ name: 'example', description: 'Example command' }],
    listEditCheckpoints: () => [],
    restoreEditCheckpoint: async () => createCheckpointResult(),
    rollbackEditCheckpoint: async () => createCheckpointResult(),
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: () => undefined,
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: async (taskId) => ({ taskId, lines: [] }),
    cancelBackgroundTask: async () => undefined,
    closeBackgroundTask: async () => undefined,
  };
}

describe('command-api contracts', () => {
  it('executes commands against the narrow command host context', async () => {
    const command: ISystemCommand = {
      name: 'example',
      description: 'Example command',
      execute: (context): ICommandResult => ({
        success: true,
        message: context.getSession().getSessionId(),
        data: {
          usedTokens: context.getContextState().usedTokens,
          cwd: context.getCwd(),
        },
      }),
    };

    const result = await command.execute(createCommandHostContext(), '');

    expect(result).toEqual({
      success: true,
      message: 'session_1',
      data: {
        usedTokens: 25,
        cwd: '/workspace',
      },
    });
  });

  it('exposes provider common APIs without command implementation imports', () => {
    const profile = buildProviderProfile({
      profile: 'openai-main',
      type: 'openai',
      model: 'gpt-5.1',
      apiKeyEnv: 'OPENAI_API_KEY',
    });

    expect(profile.apiKey).toBe(formatEnvReference('OPENAI_API_KEY'));
    expect(() => validateProviderProfile('openai-main', profile)).not.toThrow();
  });

  it('exposes auto compact common APIs without command implementation imports', () => {
    const context = createCommandHostContext();

    expect(writeAutoCompactThresholdSetting(context, 0.7)).toBe(true);
    setCommandAutoCompactThreshold(context, 0.7, 'settings');
    expect(context.getAutoCompactThreshold()).toBe(0.7);

    expect(resetAutoCompactThresholdSetting(context)).toBe(true);
  });

  it('exposes context reference inventory APIs without command implementation imports', async () => {
    const context = createCommandHostContext();

    const addResult = await addCommandContextReference(context, 'AGENTS.md');

    expect(addResult.reference?.relativePath).toBe('AGENTS.md');
    expect(listCommandContextReferences(context)).toHaveLength(1);
    expect(removeCommandContextReference(context, 'AGENTS.md').removed?.relativePath).toBe(
      'AGENTS.md',
    );
    expect(listCommandContextReferences(context)).toEqual([]);

    await addCommandContextReference(context, 'AGENTS.md');
    expect(clearCommandContextReferences(context).removed).toHaveLength(1);
  });

  it('exposes permission mode common APIs without command implementation imports', () => {
    const context = createCommandHostContext();

    expect(buildPermissionModeSubcommands().map((command) => command.name)).toEqual([
      'plan',
      'default',
      'acceptEdits',
      'bypassPermissions',
    ]);
    expect(readCommandPermissionMode(context)).toBe('default');

    writeCommandPermissionMode(context, 'plan');
    expect(readCommandPermissionMode(context)).toBe('plan');
    expect(formatCommandPermissionsMessage(readCommandPermissionsState(context))).toBe(
      'Permission mode: plan\nNo session-approved tools.',
    );
  });

  it('exposes language command common APIs without command implementation imports', () => {
    expect(buildLanguageCommandSubcommands().map((command) => command.name)).toEqual([
      'ko',
      'en',
      'ja',
      'zh',
    ]);
    expect(formatLanguageUsageMessage()).toBe('Usage: language <code> (e.g., ko, en, ja, zh)');
  });

  it('exposes memory command common APIs without command implementation imports', () => {
    const context = createCommandHostContext();
    const stores = createCommandMemoryStores(context);

    expect(buildMemoryCommandSubcommands().map((command) => command.name)).toEqual([
      'list',
      'show',
      'add',
      'pending',
      'approve',
      'reject',
      'used',
    ]);
    expect(isCommandMemoryType('project')).toBe(true);
    expect(isCommandMemoryType('secret')).toBe(false);
    expect(hasSensitiveCommandMemoryContent('api key is sk-test-secret')).toBe(true);
    expect(stores.project.list().indexPath).toContain('.robota/memory/MEMORY.md');
    expect(createCommandPendingMemoryStore('/workspace').list()).toEqual([]);
    expect(listCommandUsedMemoryReferences(context)).toEqual([]);
  });

  it('exposes background command common APIs without command implementation imports', () => {
    const task = {
      id: 'agent_1',
      kind: 'agent' as const,
      label: 'Explore',
      status: 'running' as const,
      mode: 'background' as const,
      parentSessionId: 'session_parent',
      depth: 1,
      cwd: '/workspace',
      updatedAt: '2026-05-03T00:00:00.000Z',
      lastActivityAt: '2026-05-03T00:00:01.000Z',
      unread: false,
      promptPreview: 'Find files',
    };
    const context = {
      ...createCommandHostContext(),
      listBackgroundTasks: () => [task],
    };

    expect(buildBackgroundCommandSubcommands().map((command) => command.name)).toEqual([
      'list',
      'read',
      'cancel',
      'close',
    ]);
    expect(parseCommandBackgroundLogCursor('25')).toEqual({ offset: 25 });
    expect(parseCommandBackgroundLogCursor('x')).toBeUndefined();
    expect(listCommandBackgroundTasks(context)).toEqual([task]);
    expect(formatCommandBackgroundTaskList([task])).toContain('agent_1 [running');
  });

  it('exposes statusline command common APIs without command implementation imports', () => {
    expect(buildStatusLineCommandSubcommands().map((command) => command.name)).toEqual([
      'on',
      'off',
      'reset',
      'git',
    ]);
    expect(DEFAULT_STATUS_LINE_COMMAND_SETTINGS).toEqual({
      enabled: true,
      gitBranch: true,
    });
    expect(isStatusLineCommandSettingsPatch({ enabled: false, gitBranch: true })).toBe(true);
    expect(isStatusLineCommandSettingsPatch({ enabled: 'yes' })).toBe(false);
  });

  it('exposes session command common APIs without command implementation imports', () => {
    let cleared = false;
    const context = {
      ...createCommandHostContext(),
      clearConversationHistory: () => {
        cleared = true;
      },
    };

    clearConversationHistory(context);

    expect(cleared).toBe(true);
    expect(parseSessionNameArgument('  my-session  ')).toBe('my-session');
    expect(parseSessionNameArgument('  ')).toBeUndefined();
    expect(createSessionRenamedEffect('my-session')).toEqual({
      type: 'session-renamed',
      name: 'my-session',
    });
    expect(createSessionPickerRequestedEffect()).toEqual({
      type: 'session-picker-requested',
    });
    expect(createSessionExitRequestedEffect()).toEqual({
      type: 'session-exit-requested',
    });
    expect(readCommandSessionInfo(context)).toEqual({
      sessionId: 'session_1',
      messageCount: 2,
    });

    const replayContext = {
      ...context,
      validateCurrentSessionReplayLog: () => ({
        logFile: '/workspace/.robota/logs/session_1.jsonl',
        entryCount: 1,
        validation: {
          ok: false,
          issues: [
            {
              code: 'PROVIDER_NATIVE_RAW_PAYLOAD_MISSING' as const,
              message: 'Provider request exec-1:1 has no provider-native payload.',
              executionId: 'exec-1',
              round: 1,
            },
          ],
        },
      }),
    };
    const report = validateCommandSessionReplayLog(replayContext);
    expect(report.validation.ok).toBe(false);
    expect(formatCommandSessionReplayValidationReport(report)).toContain(
      'PROVIDER_NATIVE_RAW_PAYLOAD_MISSING',
    );
  });

  it('exposes plugin command common APIs without command implementation imports', () => {
    const pluginAdapter = {
      listInstalled: async () => [],
      listAvailablePlugins: async () => [],
      install: async () => undefined,
      uninstall: async () => undefined,
      enable: async () => undefined,
      disable: async () => undefined,
      marketplaceAdd: async (source: string) => source,
      marketplaceRemove: async () => undefined,
      marketplaceUpdate: async () => undefined,
      marketplaceList: async () => [],
      reloadPlugins: async () => ({ loadedPluginCount: 0 }),
    };
    const context = {
      ...createCommandHostContext(),
      getCommandHostAdapters: () => ({
        plugin: pluginAdapter,
      }),
    };

    expect(buildPluginCommandSubcommands().map((command) => command.name)).toEqual([
      'manage',
      'install',
      'uninstall',
      'enable',
      'disable',
      'marketplace',
    ]);
    expect(createPluginTuiRequestedEffect()).toEqual({ type: 'plugin-tui-requested' });
    expect(createPluginRegistryReloadRequestedEffect()).toEqual({
      type: 'plugin-registry-reload-requested',
    });
    expect(resolvePluginCommandAdapter(context)).toBe(pluginAdapter);
  });
});
