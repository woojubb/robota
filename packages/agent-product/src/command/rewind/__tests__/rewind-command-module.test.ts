import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '@robota-sdk/agent-framework';
import {
  EditCheckpointUnreadableError,
  EditCheckpointsLockedError,
  InteractiveSession,
} from '@robota-sdk/agent-framework';
import { RewindCommandSource, createRewindCommandModule, executeRewindCommand } from '../index.js';
import { createKeyCustodyCommandModule } from '../../key-custody/index.js';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';

const testHost = createTestFrameworkHost();

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

function createInteractiveSession(
  commandProductVocabulary?: { cliName: string; displayName: string },
  host: typeof testHost = testHost,
): InteractiveSession {
  return new InteractiveSession({
    host,
    cwd: process.cwd(),
    session: createMockRuntimeSession() as never,
    commandModules: [createRewindCommandModule()],
    commandProductVocabulary,
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
      'fork',
      'switch',
      'branches',
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
    vi.spyOn(session, 'editCheckpointListing').mockReturnValue({
      checkpoints: [createCheckpoint()],
      unreadable: { damaged: 0, newer: 0 },
    });

    const result = await session.executeCommand('rewind', 'list');

    expect(result?.success).toBe(true);
    expect(result?.message).toBe(
      'Edit checkpoints:\n- turn-0001 files=2 2026-05-02T00:00:00.000Z change files',
    );
    expect(result?.data).toEqual({ count: 1, checkpoints: [createCheckpoint()] });
  });

  it('lists and counts from one read of the session', async () => {
    const session = createInteractiveSession();
    const listing = vi.spyOn(session, 'editCheckpointListing').mockReturnValue({
      checkpoints: [createCheckpoint()],
      unreadable: { damaged: 1, newer: 0 },
    });
    const listed = vi.spyOn(session, 'listEditCheckpoints');
    const counted = vi.spyOn(session, 'unreadableEditCheckpoints');

    const result = await session.executeCommand('rewind', 'list');

    expect(result?.data?.unreadable).toEqual({ damaged: 1, newer: 0 });
    expect(listing).toHaveBeenCalledTimes(1);
    expect(listed).not.toHaveBeenCalled();
    expect(counted).not.toHaveBeenCalled();
  });

  it('lists and counts through a host that reads them apart, or cannot count at all', async () => {
    const host = {
      listEditCheckpoints: () => [createCheckpoint()],
      unreadableEditCheckpoints: () => ({ damaged: 0, newer: 2 }),
    };

    const counted = await executeRewindCommand(host as never, 'list');
    const uncounted = await executeRewindCommand(
      { listEditCheckpoints: host.listEditCheckpoints } as never,
      'list',
    );

    expect(counted.data?.unreadable).toEqual({ damaged: 0, newer: 2 });
    expect(uncounted.message).toBe(
      'Edit checkpoints:\n- turn-0001 files=2 2026-05-02T00:00:00.000Z change files',
    );
  });

  it('says how many checkpoints do not open and why, beneath the ones that do', async () => {
    const session = createInteractiveSession();
    const unreadable = vi.spyOn(session, 'editCheckpointListing');

    unreadable.mockReturnValue({
      checkpoints: [createCheckpoint()],
      unreadable: { damaged: 1, newer: 1 },
    });
    const both = await session.executeCommand('rewind', 'list');
    unreadable.mockReturnValue({
      checkpoints: [createCheckpoint()],
      unreadable: { damaged: 0, newer: 1 },
    });
    const one = await session.executeCommand('rewind', 'list');

    expect(both?.success).toBe(true);
    expect(both?.message?.split('\n').at(-1)).toBe(
      '2 checkpoints do not open and are not listed: 1 damaged, 1 written by a newer build.',
    );
    expect(both?.data?.unreadable).toEqual({ damaged: 1, newer: 1 });
    expect(one?.message?.split('\n').at(-1)).toBe(
      '1 checkpoint does not open and is not listed: 1 written by a newer build.',
    );
  });

  it.each([
    ['locked', 'The edit checkpoints are sealed and the keys are locked; unlock to rewind.'],
    ['no-keys', 'The edit checkpoints are sealed; this process has no keys to open them.'],
  ] as const)(
    'refuses a sealed session whose keys are %s with fixed words',
    async (reason, words) => {
      const session = createInteractiveSession({
        cliName: 'test-agent',
        displayName: 'Test Agent',
      });
      vi.spyOn(session, 'editCheckpointListing').mockImplementation(() => {
        throw new EditCheckpointsLockedError(reason);
      });
      vi.spyOn(session, 'restoreEditCheckpoint').mockRejectedValue(
        new EditCheckpointsLockedError(reason),
      );

      for (const args of ['list', 'restore turn-0001']) {
        const result = await session.executeCommand('rewind', args);
        expect(result).toMatchObject({ success: false, message: words });
      }
    },
  );

  it('names /unlock for locked checkpoints where the session registered it', async () => {
    const session = new InteractiveSession({
      host: testHost,
      cwd: process.cwd(),
      session: createMockRuntimeSession() as never,
      commandModules: [
        createRewindCommandModule(),
        createKeyCustodyCommandModule({
          isUnlocked: () => false,
          unlock: async () => ({ outcome: 'unlocked', notices: [] }),
          lock: () => undefined,
        }),
      ],
    });
    vi.spyOn(session, 'editCheckpointListing').mockImplementation(() => {
      throw new EditCheckpointsLockedError('locked');
    });
    vi.spyOn(session, 'restoreEditCheckpoint').mockRejectedValue(
      new EditCheckpointsLockedError('locked'),
    );

    for (const args of ['list', 'restore turn-0001']) {
      const result = await session.executeCommand('rewind', args);
      expect(result).toMatchObject({
        success: false,
        message:
          'The edit checkpoints are sealed and the keys are locked; run `/unlock` to rewind.',
      });
    }
  });

  it('says a restore was refused because a checkpoint in its range does not open', async () => {
    const session = createInteractiveSession();
    vi.spyOn(session, 'restoreEditCheckpoint').mockRejectedValue(
      new EditCheckpointUnreadableError('turn-0002', 'damaged', { refused: true }),
    );

    const result = await session.executeCommand('rewind', 'restore turn-0001');

    expect(result).toMatchObject({
      success: false,
      message:
        'Edit checkpoint turn-0002 is damaged and does not open. Nothing was restored; restoring to a checkpoint after it still works.',
    });
  });

  it('names the migration to run again for a pre-image a stopped migration left plain', async () => {
    const unfinished = new EditCheckpointUnreadableError('turn-0002', 'damaged', {
      part: 'pre-image',
      refused: true,
      unfinishedMigration: true,
    });
    const named = createInteractiveSession({ cliName: 'test-agent', displayName: 'Test Agent' });
    vi.spyOn(named, 'restoreEditCheckpoint').mockRejectedValue(unfinished);
    const unnamed = createInteractiveSession();
    vi.spyOn(unnamed, 'restoreEditCheckpoint').mockRejectedValue(unfinished);

    expect(await named.executeCommand('rewind', 'restore turn-0001')).toMatchObject({
      success: false,
      message:
        'A pre-image of edit checkpoint turn-0002 is still plain under its sealed manifest: a migration stopped part-way; run test-agent secure migrate again to finish it. Nothing was restored; restoring to a checkpoint after it still works.',
    });
    expect(await unnamed.executeCommand('rewind', 'restore turn-0001')).toMatchObject({
      success: false,
      message:
        'A pre-image of edit checkpoint turn-0002 is still plain under its sealed manifest: a migration stopped part-way, and running `secure migrate` again finishes it. Nothing was restored; restoring to a checkpoint after it still works.',
    });
  });

  it('marks a recorded size and a plan a checkpoint that does not open would refuse', async () => {
    const session = createInteractiveSession();
    const blocked = { checkpointId: 'turn-0003', reason: 'newer' } as const;
    const inspection = createInspection({
      restoreToCheckpoint: { checkpointIds: ['turn-0002'], fileCount: 1, blockedBy: blocked },
      rollbackThroughCheckpoint: {
        checkpointIds: ['turn-0001', 'turn-0002'],
        fileCount: 2,
        blockedBy: blocked,
      },
    });
    inspection.capturedFiles[0]!.snapshotSizeSource = 'recorded';
    vi.spyOn(session, 'inspectEditCheckpoint').mockReturnValue(inspection);

    const result = await session.executeCommand('rewind', 'inspect turn-0001');

    expect(result?.message?.split('\n').slice(3)).toEqual([
      '- example.ts action=restore-preimage snapshot=true size=12B (recorded)',
      'Restore later checkpoints: files=1 checkpoints=turn-0002 (refused: turn-0003 was written by a newer build)',
      'Rollback through checkpoint: files=2 checkpoints=turn-0001, turn-0002 (refused: turn-0003 was written by a newer build)',
    ]);
  });

  it('shows an empty checkpoint list', async () => {
    const session = createInteractiveSession();
    vi.spyOn(session, 'editCheckpointListing').mockReturnValue({
      checkpoints: [],
      unreadable: { damaged: 0, newer: 0 },
    });

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

  // Branching subcommands route through the host context.
  it('delegates fork through session.executeCommand (non-destructive)', async () => {
    const session = createInteractiveSession();
    const forkCheckpointBranch = vi
      .spyOn(session, 'forkCheckpointBranch')
      .mockResolvedValue(createRestoreResult());

    const result = await session.executeCommand('rewind', 'fork turn-0001');

    expect(result?.success).toBe(true);
    expect(forkCheckpointBranch).toHaveBeenCalledWith('turn-0001');
    expect(result?.message).toContain('Forked a new branch from turn-0001');
  });

  it('delegates switch through session.executeCommand', async () => {
    const session = createInteractiveSession();
    const switchCheckpointBranch = vi.spyOn(session, 'switchCheckpointBranch').mockReturnValue();

    const result = await session.executeCommand('rewind', 'switch turn-0002');

    expect(result?.success).toBe(true);
    expect(switchCheckpointBranch).toHaveBeenCalledWith('turn-0002');
    expect(result?.message).toContain('Switched to checkpoint branch turn-0002.');
  });

  it('lists branch tips via the branches subcommand', async () => {
    const session = createInteractiveSession();
    vi.spyOn(session, 'listCheckpointBranches').mockReturnValue(['turn-0003', 'turn-0005']);

    const result = await session.executeCommand('rewind', 'branches');

    expect(result?.success).toBe(true);
    expect(result?.message).toContain('turn-0003');
    expect(result?.message).toContain('turn-0005');
    expect(result?.data?.branches).toEqual(['turn-0003', 'turn-0005']);
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

  describe('in a session built without a checkpoint store', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('tells a restricted workspace to trust it, for every subcommand', async () => {
      // A host that can write project files: what stands in the way is the workspace's trust.
      const session = createInteractiveSession(
        { cliName: 'test-agent', displayName: 'Test Agent' },
        { ...testHost, supportsProjectMutation: true },
      );

      for (const args of ['', 'list', 'inspect turn-0001', 'restore turn-0001', 'branches']) {
        const result = await session.executeCommand('rewind', args);
        expect(result?.success).toBe(false);
        expect(result?.message).toBe(
          'Edit checkpoints need a trusted workspace: run test-agent trust --yes, then restart test-agent.',
        );
      }
    });

    it('says why on a host that cannot prove a project write is safe, without naming trust', async () => {
      const session = createInteractiveSession(undefined, {
        ...testHost,
        supportsProjectMutation: false,
      });

      const result = await session.executeCommand('rewind', 'list');

      expect(result?.success).toBe(false);
      // Plain words naming the feature ("Rewind"), not the internal write-containment reason.
      expect(result?.message).toBe("Rewind isn't available on this computer yet.");
      expect(result?.message).not.toContain('trust');
    });
  });
});
