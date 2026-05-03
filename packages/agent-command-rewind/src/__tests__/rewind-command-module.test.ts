import { describe, expect, it, vi } from 'vitest';
import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '@robota-sdk/agent-sdk';
import { InteractiveSession } from '@robota-sdk/agent-sdk';
import { RewindCommandSource, createRewindCommandModule, executeRewindCommand } from '../index.js';

function createCheckpoint(overrides: Partial<IEditCheckpointSummary> = {}): IEditCheckpointSummary {
  return {
    id: 'turn-0001',
    sessionId: 'test-session-id',
    sequence: 1,
    prompt: 'change files',
    createdAt: '2026-05-02T00:00:00.000Z',
    fileCount: 2,
    ...overrides,
  };
}

function createRestoreResult(
  overrides: Partial<IEditCheckpointRestoreResult> = {},
): IEditCheckpointRestoreResult {
  return {
    target: createCheckpoint({ fileCount: 1 }),
    restoredCheckpointCount: 2,
    restoredFileCount: 3,
    removedCheckpointCount: 2,
    ...overrides,
  };
}

function createInspection(
  overrides: Partial<IEditCheckpointInspection> = {},
): IEditCheckpointInspection {
  return {
    target: createCheckpoint({ fileCount: 1 }),
    capturedFiles: [
      {
        originalPath: '/workspace/example.ts',
        relativePath: 'example.ts',
        existed: true,
        restoreAction: 'restore-preimage',
        snapshotAvailable: true,
        snapshotSizeBytes: 12,
      },
    ],
    restoreToCheckpoint: { checkpointIds: ['turn-0002'], fileCount: 1 },
    rollbackThroughCheckpoint: { checkpointIds: ['turn-0001', 'turn-0002'], fileCount: 2 },
    ...overrides,
  };
}

function createMockRuntimeSession() {
  return {
    run: vi.fn().mockResolvedValue('mock response'),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({
      usedTokens: 5000,
      maxTokens: 200000,
      usedPercentage: 2.5,
    }),
    compact: vi.fn().mockResolvedValue(undefined),
    injectMessage: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getSystemMessage: vi.fn().mockReturnValue('mock system prompt'),
    getToolSchemas: vi.fn().mockReturnValue([]),
  };
}

function createInteractiveSession(): InteractiveSession {
  return new InteractiveSession({
    session: createMockRuntimeSession() as never,
    commandModules: [createRewindCommandModule()],
  });
}

describe('createRewindCommandModule', () => {
  it('contributes write-safe rewind metadata and executable command', () => {
    const module = createRewindCommandModule();
    const commands = module.commandSources?.flatMap((source) => source.getCommands()) ?? [];

    expect(module.name).toBe('agent-command-rewind');
    expect(commands.map((command) => command.name)).toEqual(['rewind']);
    expect(commands[0]?.source).toBe('rewind');
    expect(commands[0]?.modelInvocable).toBe(false);
    expect(commands[0]?.safety).toBe('write');
    expect(commands[0]?.subcommands?.map((command) => command.name)).toEqual([
      'list',
      'inspect',
      'restore',
      'code',
      'rollback',
    ]);
    expect(module.systemCommands?.map((command) => command.name)).toEqual(['rewind']);
    expect(module.systemCommands?.[0]?.userInvocable).toBe(true);
  });

  it('provides a stable command source', () => {
    const source = new RewindCommandSource();

    expect(source.name).toBe('rewind');
    expect(source.getCommands()).toHaveLength(1);
  });
});

describe('executeRewindCommand', () => {
  it('lists edit checkpoints', async () => {
    const session = createInteractiveSession();
    vi.spyOn(session, 'listEditCheckpoints').mockReturnValue([createCheckpoint()]);

    const result = await session.executeCommand('rewind', 'list');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('turn-0001');
    expect(result?.data?.count).toBe(1);
  });

  it('shows an empty checkpoint list', async () => {
    const session = createInteractiveSession();
    vi.spyOn(session, 'listEditCheckpoints').mockReturnValue([]);

    const result = await session.executeCommand('rewind', '');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('(no edit checkpoints)');
    expect(result?.data?.count).toBe(0);
  });

  it('inspects captured files and rollback plans', async () => {
    const session = createInteractiveSession();
    const inspectEditCheckpoint = vi
      .spyOn(session, 'inspectEditCheckpoint')
      .mockReturnValue(createInspection());

    const result = await session.executeCommand('rewind', 'inspect turn-0001');

    expect(result?.success).toBe(true);
    expect(inspectEditCheckpoint).toHaveBeenCalledWith('turn-0001');
    expect(result?.message).toContain('Captured files:');
    expect(result?.message).toContain('example.ts');
    expect(result?.message).toContain('Rollback through checkpoint');
    expect(result?.data?.inspection).toEqual(createInspection());
  });

  it('delegates restore through session.executeCommand', async () => {
    const session = createInteractiveSession();
    const restoreEditCheckpoint = vi
      .spyOn(session, 'restoreEditCheckpoint')
      .mockResolvedValue(createRestoreResult());

    const result = await session.executeCommand('rewind', 'restore turn-0001');

    expect(result?.success).toBe(true);
    expect(restoreEditCheckpoint).toHaveBeenCalledWith('turn-0001');
    expect(result?.message).toContain('Restored code to turn-0001.');
    expect(result?.data?.restoredFileCount).toBe(3);
  });

  it('treats code as a restore alias', async () => {
    const session = createInteractiveSession();
    const restoreEditCheckpoint = vi
      .spyOn(session, 'restoreEditCheckpoint')
      .mockResolvedValue(createRestoreResult());

    const result = await session.executeCommand('rewind', 'code turn-0001');

    expect(result?.success).toBe(true);
    expect(restoreEditCheckpoint).toHaveBeenCalledWith('turn-0001');
  });

  it('delegates rollback through session.executeCommand', async () => {
    const session = createInteractiveSession();
    const rollbackEditCheckpoint = vi
      .spyOn(session, 'rollbackEditCheckpoint')
      .mockResolvedValue(
        createRestoreResult({ restoredCheckpointCount: 1, removedCheckpointCount: 1 }),
      );

    const result = await session.executeCommand('rewind', 'rollback turn-0001');

    expect(result?.success).toBe(true);
    expect(rollbackEditCheckpoint).toHaveBeenCalledWith('turn-0001');
    expect(result?.message).toContain('Rolled back code through turn-0001.');
  });

  it('returns usage for invalid arguments without mutating state', async () => {
    const session = createInteractiveSession();
    const restoreEditCheckpoint = vi.spyOn(session, 'restoreEditCheckpoint');
    const rollbackEditCheckpoint = vi.spyOn(session, 'rollbackEditCheckpoint');

    const result = await executeRewindCommand(session, 'restore');
    const unknownResult = await executeRewindCommand(session, 'unknown');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage: rewind');
    expect(unknownResult.success).toBe(false);
    expect(restoreEditCheckpoint).not.toHaveBeenCalled();
    expect(rollbackEditCheckpoint).not.toHaveBeenCalled();
  });

  it('returns checkpoint API errors as command failures', async () => {
    const session = createInteractiveSession();
    vi.spyOn(session, 'restoreEditCheckpoint').mockRejectedValue(
      new Error('Unknown edit checkpoint'),
    );

    const result = await session.executeCommand('rewind', 'restore missing');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe('Unknown edit checkpoint');
  });
});
