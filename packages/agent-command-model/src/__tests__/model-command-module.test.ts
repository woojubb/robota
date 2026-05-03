import { describe, expect, it } from 'vitest';
import type { ICommandHostContext, IEditCheckpointRestoreResult } from '@robota-sdk/agent-sdk';
import { SystemCommandExecutor } from '@robota-sdk/agent-sdk';
import { createModelCommandModule } from '../model-command-module.js';

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
    throw new Error('model command should not read session runtime');
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

describe('createModelCommandModule', () => {
  it('provides model metadata and executable command from one module owner', () => {
    const module = createModelCommandModule();
    const command = module.systemCommands?.[0];
    const entry = module.commandSources?.[0]?.getCommands()[0];

    expect(module.name).toBe('agent-command-model');
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'model',
        description: 'Change AI model',
        argumentHint: '<model-id>',
        source: 'model',
      }),
    );
    expect(entry?.subcommands?.map((subcommand) => subcommand.name)).toContain('claude-sonnet-4-6');
    expect(command).toEqual(
      expect.objectContaining({
        name: 'model',
        description: 'Change AI model',
        argumentHint: '<model-id>',
        lifecycle: 'inline',
      }),
    );
    expect(command?.subcommands).toEqual(entry?.subcommands);
  });

  it('deduplicates date-suffixed model variants in descriptor subcommands', () => {
    const entry = createModelCommandModule().commandSources?.[0]?.getCommands()[0];
    const names = entry?.subcommands?.map((subcommand) => subcommand.name) ?? [];

    expect(names).toContain('claude-opus-4-6');
    expect(names).toContain('claude-sonnet-4-6');
    expect(names).toContain('claude-haiku-4-5');
    expect(names).not.toContain('claude-haiku-4-5-20251001');
    expect(names).not.toContain('claude-sonnet-4-5-20250929');
    expect(names).not.toContain('claude-opus-4-5-20251101');
  });

  it('formats subcommand descriptions with human-readable names and context windows', () => {
    const entry = createModelCommandModule().commandSources?.[0]?.getCommands()[0];
    const subcommands = entry?.subcommands ?? [];

    expect(
      subcommands.find((subcommand) => subcommand.name === 'claude-opus-4-6')?.description,
    ).toBe('Claude Opus 4.6 (1M)');
    expect(
      subcommands.find((subcommand) => subcommand.name === 'claude-haiku-4-5')?.description,
    ).toBe('Claude Haiku 4.5 (200K)');
  });

  it('requests model changes through a typed command effect', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModelCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('model', commandHostContext, 'claude-sonnet-4-6');

    expect(result?.success).toBe(true);
    expect(result?.data?.modelId).toBe('claude-sonnet-4-6');
    expect(result?.effects).toEqual([
      { type: 'model-change-requested', modelId: 'claude-sonnet-4-6' },
    ]);
  });

  it('shows usage when no model id is provided', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModelCommandModule().systemCommands ?? []),
    ]);

    const result = await executor.execute('model', commandHostContext, '');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe('Usage: model <model-id>');
  });
});
