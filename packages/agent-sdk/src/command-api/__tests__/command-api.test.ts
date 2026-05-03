import type { IContextWindowState, TPermissionMode } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';
import type {
  ICommandHostContext,
  ICommandResult,
  ICommandSessionRuntime,
  ISystemCommand,
} from '../index.js';
import { buildProviderProfile, formatEnvReference, validateProviderProfile } from '../index.js';
import {
  buildLanguageCommandSubcommands,
  buildPermissionModeSubcommands,
  buildStatusLineCommandSubcommands,
  DEFAULT_STATUS_LINE_COMMAND_SETTINGS,
  formatCommandPermissionsMessage,
  formatLanguageUsageMessage,
  isStatusLineCommandSettingsPatch,
  readCommandPermissionsState,
  readCommandPermissionMode,
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
});
