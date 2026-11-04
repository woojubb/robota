/**
 * A session asks its edit checkpoints of `IEditCheckpointStore`, not of the class that keeps them in
 * a project's files, so a host with no files keeps them wherever it keeps state and the session works
 * the same. This drives the session's history tracker over a store held in memory.
 */
import { describe, expect, it, vi } from 'vitest';

import { EditCheckpointsUnavailableError } from '../../checkpoints/edit-checkpoints-unavailable-error.js';
import { DEFAULT_BRANCH_ID } from '../../checkpoints/edit-checkpoint-types.js';
import { createRestrictedWorkspaceProjectAccess } from '../../workspace-trust/index.js';
import { SessionHistoryTracker } from '../interactive-session-history-tracker.js';

import type {
  IEditCheckpointRestoreResult,
  IEditCheckpointStore,
  IEditCheckpointSummary,
} from '../../checkpoints/edit-checkpoint-types.js';
import type { IActiveBranchPointer, IBranchEvent } from '@robota-sdk/agent-interface-session';

const SESSION = 'session_in_memory';

/** A store that keeps only summaries, in memory; the restore and inspection paths are not under test. */
function memoryCheckpointStore(): IEditCheckpointStore & { readonly turns: string[] } {
  const checkpoints: IEditCheckpointSummary[] = [];
  const turns: string[] = [];
  let head: IActiveBranchPointer | undefined;
  const restored: IEditCheckpointRestoreResult = {
    target: {
      id: 'turn-0001',
      sessionId: SESSION,
      sequence: 1,
      prompt: 'first',
      createdAt: '2026-11-05T00:00:00.000Z',
      fileCount: 0,
    },
    restoredCheckpointCount: 0,
    restoredFileCount: 0,
    removedCheckpointCount: 0,
  };
  const unsupported = (): never => {
    throw new Error('not kept by this store');
  };
  return {
    turns,
    beginTurn: async (input) => {
      turns.push(input.prompt);
      const summary: IEditCheckpointSummary = {
        id: `turn-${String(checkpoints.length + 1).padStart(4, '0')}`,
        sessionId: input.sessionId,
        sequence: checkpoints.length + 1,
        prompt: input.prompt,
        createdAt: '2026-11-05T00:00:00.000Z',
        fileCount: 0,
      };
      checkpoints.push(summary);
      head = { branchId: DEFAULT_BRANCH_ID, checkpointId: summary.id };
      return summary;
    },
    captureFile: () => undefined,
    finalizeTurn: async () => checkpoints.at(-1),
    list: () => [...checkpoints],
    countUnreadable: () => ({ damaged: 0, newer: 0 }),
    listing: () => ({ checkpoints: [...checkpoints], unreadable: { damaged: 0, newer: 0 } }),
    inspect: unsupported,
    restoreToCheckpoint: async () => restored,
    rollbackThroughCheckpoint: async () => restored,
    listCheckpointBranches: () => (head === undefined ? [] : [head.checkpointId as string]),
    checkpointAncestors: () => [],
    switchToCheckpoint: (_session, checkpointId) => {
      head = { branchId: DEFAULT_BRANCH_ID, checkpointId };
    },
    getActiveBranchPointer: () => head,
    restoreActiveBranch: (_session, pointer) => {
      head = pointer;
    },
  };
}

function trackerOver(store: IEditCheckpointStore | undefined, events: IBranchEvent[] = []) {
  return new SessionHistoryTracker(
    {
      cwd: '/browser/workspace',
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted'),
    },
    () => SESSION,
    () => false,
    () => undefined,
    vi.fn(),
    vi.fn(),
    store ?? null,
    (event) => events.push(event),
  );
}

describe('a session over an edit checkpoint store a host kept itself', () => {
  it('records a turn, lists it, and carries the active branch across a resume', async () => {
    const store = memoryCheckpointStore();
    const events: IBranchEvent[] = [];
    const tracker = trackerOver(store, events);

    await tracker.beginEditCheckpointTurn('edit things');
    await tracker.finalizeEditCheckpointTurn();

    expect(store.turns).toEqual(['edit things']);
    expect(tracker.listEditCheckpoints().map((checkpoint) => checkpoint.prompt)).toEqual([
      'edit things',
    ]);
    expect(tracker.editCheckpointListing().unreadable).toEqual({ damaged: 0, newer: 0 });
    expect(tracker.getActiveBranchPointer()).toEqual({
      branchId: DEFAULT_BRANCH_ID,
      checkpointId: 'turn-0001',
    });

    const resumed = trackerOver(memoryCheckpointStore());
    resumed.restoreActiveBranch({ branchId: 'branch-1', checkpointId: 'turn-0001' });
    expect(resumed.getActiveBranchPointer()).toEqual({
      branchId: 'branch-1',
      checkpointId: 'turn-0001',
    });
  });

  it('restores through the store and says so in the history', async () => {
    const tracker = trackerOver(memoryCheckpointStore());
    await tracker.beginEditCheckpointTurn('first');

    await expect(tracker.restoreEditCheckpoint('turn-0001')).resolves.toMatchObject({
      restoredCheckpointCount: 0,
    });
    expect(tracker.getHistory().at(-1)).toMatchObject({
      data: { content: 'Restored edit checkpoint: turn-0001' },
    });
  });

  it('without a store has none to list and says so', () => {
    expect(() => trackerOver(undefined).listEditCheckpoints()).toThrow(
      EditCheckpointsUnavailableError,
    );
  });
});
