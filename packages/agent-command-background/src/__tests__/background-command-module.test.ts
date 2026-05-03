import { describe, expect, it, vi } from 'vitest';
import type {
  IBackgroundTaskState,
  ICommandHostContext,
  ICommandSessionRuntime,
} from '@robota-sdk/agent-sdk';
import {
  BackgroundCommandSource,
  createBackgroundCommandEntry,
  createBackgroundCommandModule,
  executeBackgroundCommand,
} from '../index.js';

function createSessionRuntime(): ICommandSessionRuntime {
  return {
    clearHistory: () => undefined,
    compact: async () => undefined,
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 10,
      usedPercentage: 10,
      remainingPercentage: 90,
    }),
    getPermissionMode: () => 'default',
    setPermissionMode: () => undefined,
    getSessionId: () => 'session_1',
    getMessageCount: () => 0,
    getSessionAllowedTools: () => [],
  };
}

function createTask(overrides?: Partial<IBackgroundTaskState>): IBackgroundTaskState {
  return {
    id: 'agent_1',
    kind: 'agent',
    label: 'Explore',
    status: 'running',
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 1,
    cwd: '/workspace',
    updatedAt: '2026-04-30T00:00:00.000Z',
    lastActivityAt: '2026-04-30T00:00:01.000Z',
    unread: false,
    promptPreview: 'Find files',
    ...overrides,
  };
}

function createCommandHostContext(overrides?: Partial<ICommandHostContext>): ICommandHostContext {
  return {
    getSession: () => createSessionRuntime(),
    getContextState: () => ({
      maxTokens: 100,
      usedTokens: 10,
      usedPercentage: 10,
      remainingPercentage: 90,
    }),
    getAutoCompactThreshold: () => 0.8,
    compactContext: async () => undefined,
    getCwd: () => '/workspace',
    listEditCheckpoints: () => [],
    restoreEditCheckpoint: async () => ({
      target: {
        id: 'checkpoint_1',
        sessionId: 'session_1',
        sequence: 1,
        prompt: 'edit',
        createdAt: '2026-05-03T00:00:00.000Z',
        fileCount: 0,
      },
      restoredCheckpointCount: 1,
      restoredFileCount: 0,
      removedCheckpointCount: 0,
    }),
    rollbackEditCheckpoint: async () => ({
      target: {
        id: 'checkpoint_1',
        sessionId: 'session_1',
        sequence: 1,
        prompt: 'edit',
        createdAt: '2026-05-03T00:00:00.000Z',
        fileCount: 0,
      },
      restoredCheckpointCount: 1,
      restoredFileCount: 0,
      removedCheckpointCount: 0,
    }),
    getUsedMemoryReferences: () => [],
    recordMemoryEvent: () => undefined,
    listBackgroundTasks: () => [],
    readBackgroundTaskLog: async (taskId) => ({ taskId, lines: [] }),
    cancelBackgroundTask: async () => undefined,
    closeBackgroundTask: async () => undefined,
    ...overrides,
  };
}

describe('background command module', () => {
  it('provides command metadata and executable registration from one module', () => {
    const entry = createBackgroundCommandEntry();
    const module = createBackgroundCommandModule();

    expect(entry).toMatchObject({
      name: 'background',
      description: 'List and control background tasks',
      source: 'background',
      modelInvocable: false,
    });
    expect(entry.subcommands?.map((command) => command.name)).toEqual([
      'list',
      'read',
      'cancel',
      'close',
    ]);
    expect(new BackgroundCommandSource().getCommands()).toEqual([entry]);
    expect(module.systemCommands?.map((command) => command.name)).toEqual(['background']);
    expect(module.commandSources?.flatMap((source) => source.getCommands())).toEqual([entry]);
  });

  it('lists background tasks', async () => {
    const context = createCommandHostContext({
      listBackgroundTasks: vi.fn().mockReturnValue([createTask()]),
    });

    const result = await executeBackgroundCommand(context, 'list');

    expect(result.success).toBe(true);
    expect(result.message).toContain(
      'agent_1 [running lastActivityAt=2026-04-30T00:00:01.000Z] agent:Explore',
    );
    expect(result.message).toContain('Find files');
    expect(result.data?.count).toBe(1);
  });

  it('defaults to list when no action is provided', async () => {
    const context = createCommandHostContext({
      listBackgroundTasks: vi.fn().mockReturnValue([]),
    });

    const result = await executeBackgroundCommand(context, '');

    expect(result).toEqual({
      message: 'No background tasks.',
      success: true,
      data: { count: 0 },
    });
  });

  it('reads a background task log page with cursor parsing', async () => {
    const readBackgroundTaskLog = vi.fn().mockResolvedValue({
      taskId: 'process_1',
      nextCursor: { offset: 200 },
      lines: ['[stdout] hello'],
    });
    const context = createCommandHostContext({ readBackgroundTaskLog });

    const result = await executeBackgroundCommand(context, 'read process_1 0');

    expect(readBackgroundTaskLog).toHaveBeenCalledWith('process_1', { offset: 0 });
    expect(result.success).toBe(true);
    expect(result.message).toContain('[stdout] hello');
    expect(result.message).toContain('Next offset: 200');
    expect(result.data).toEqual({ taskId: 'process_1', nextOffset: 200 });
  });

  it('supports read aliases and omits invalid cursors', async () => {
    const readBackgroundTaskLog = vi.fn().mockResolvedValue({
      taskId: 'process_1',
      lines: [],
    });
    const context = createCommandHostContext({ readBackgroundTaskLog });

    const result = await executeBackgroundCommand(context, 'open process_1 nope');

    expect(readBackgroundTaskLog).toHaveBeenCalledWith('process_1', undefined);
    expect(result.message).toBe('No log lines: process_1');
  });

  it('cancels a background task with optional reason', async () => {
    const cancelBackgroundTask = vi.fn().mockResolvedValue(undefined);
    const context = createCommandHostContext({ cancelBackgroundTask });

    const result = await executeBackgroundCommand(context, 'cancel agent_1 no longer needed');

    expect(cancelBackgroundTask).toHaveBeenCalledWith('agent_1', 'no longer needed');
    expect(result).toEqual({
      message: 'Background task cancelled: agent_1',
      success: true,
      data: { taskId: 'agent_1' },
    });
  });

  it('supports cancel aliases without a reason', async () => {
    const cancelBackgroundTask = vi.fn().mockResolvedValue(undefined);
    const context = createCommandHostContext({ cancelBackgroundTask });

    await executeBackgroundCommand(context, 'stop agent_1');

    expect(cancelBackgroundTask).toHaveBeenCalledWith('agent_1', undefined);
  });

  it('closes a background task', async () => {
    const closeBackgroundTask = vi.fn().mockResolvedValue(undefined);
    const context = createCommandHostContext({ closeBackgroundTask });

    const result = await executeBackgroundCommand(context, 'dismiss agent_1');

    expect(closeBackgroundTask).toHaveBeenCalledWith('agent_1');
    expect(result).toEqual({
      message: 'Background task closed: agent_1',
      success: true,
      data: { taskId: 'agent_1' },
    });
  });

  it('returns usage when a task action omits task id', async () => {
    const result = await executeBackgroundCommand(createCommandHostContext(), 'cancel');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage: background list');
  });

  it('rejects unknown actions', async () => {
    const result = await executeBackgroundCommand(createCommandHostContext(), 'pause agent_1');

    expect(result).toEqual({
      message: 'Unknown background action: pause',
      success: false,
    });
  });
});
