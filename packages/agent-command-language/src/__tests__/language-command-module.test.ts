import { describe, expect, it } from 'vitest';
import type { ICommandHostContext, IEditCheckpointRestoreResult } from '@robota-sdk/agent-sdk';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createLanguageCommandModule } from '../language-command-module.js';

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

const commandHostContext: ICommandHostContext = {
  getSession: () => {
    throw new Error('language command should not read session runtime');
  },
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

describe('createLanguageCommandModule', () => {
  it('provides language metadata and executable command from one module owner', () => {
    const module = createLanguageCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-language');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'language',
        description: 'Set response language',
        argumentHint: '<code>',
        source: 'language',
        modelInvocable: false,
      }),
    );
    expect(entry?.subcommands?.map((subcommand) => subcommand.name)).toEqual([
      'ko',
      'en',
      'ja',
      'zh',
    ]);
    expect(command).toEqual(
      expect.objectContaining({
        name: 'language',
        description: 'Set response language',
        argumentHint: '<code>',
        lifecycle: 'inline',
        modelInvocable: false,
      }),
    );
    expect(command?.subcommands).toEqual(entry?.subcommands);
  });

  it('requests language changes through a typed command effect', async () => {
    const executor = new SystemCommandExecutor([
      ...(createLanguageCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('language', commandHostContext, 'ko');

    expect(result?.success).toBe(true);
    expect(result?.data?.language).toBe('ko');
    expect(result?.effects).toEqual([{ type: 'language-change-requested', language: 'ko' }]);
  });

  it('shows usage when no language code is provided', async () => {
    const executor = new SystemCommandExecutor([
      ...(createLanguageCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('language', commandHostContext, '');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe('Usage: language <code> (e.g., ko, en, ja, zh)');
  });
});
