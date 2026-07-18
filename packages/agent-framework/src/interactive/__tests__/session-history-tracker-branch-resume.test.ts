import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, afterEach } from 'vitest';

import { SessionHistoryTracker } from '../interactive-session-history-tracker.js';
import { EditCheckpointStore } from '../../checkpoints/edit-checkpoint-store.js';

/**
 * SELFHOST-007 TC-05a (regression) — on the STANDARD construction path the checkpoint store is injected
 * (setEditCheckpointStore) DURING async init, BEFORE the underlying session is assigned, so applying a
 * resume pointer there would throw (getSessionId not ready). The pointer must be STASHED and applied
 * lazily on the first checkpoint operation (when the session is ready) — otherwise `--resume` silently
 * drops the branch and the next turn resumes on the wrong tip.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeTracker(cwd: string, store: EditCheckpointStore | null): SessionHistoryTracker {
  return new SessionHistoryTracker(
    cwd,
    () => 'sess-resume',
    () => false,
    vi.fn(),
    vi.fn(),
    vi.fn(),
    store,
  );
}

async function seed(cwd: string): Promise<string> {
  const store = new EditCheckpointStore({ cwd });
  const a = await store.beginTurn({ sessionId: 'sess-resume', prompt: 'a' });
  await store.finalizeTurn();
  await store.beginTurn({ sessionId: 'sess-resume', prompt: 'b' });
  await store.finalizeTurn();
  await store.restoreToCheckpoint('sess-resume', a.id); // active head → a (fork)
  return a.id;
}

describe('SELFHOST-007 TC-05a — active-branch restore survives store-injection ordering', () => {
  it('applies a stashed resume pointer on the first checkpoint access after setEditCheckpointStore', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-branch-resume-'));
    dirs.push(cwd);
    const aId = await seed(cwd);

    // STANDARD path: tracker constructed with NO store; resume restore runs first (stashes).
    const tracker = makeTracker(cwd, null);
    const resumedStore = new EditCheckpointStore({ cwd });
    tracker.restoreActiveBranch({ branchId: 'branch-1', checkpointId: aId });
    tracker.setEditCheckpointStore(resumedStore); // must NOT throw (session not ready)

    // First checkpoint access (a nav read) applies the stash — active head becomes the restored 'a'.
    tracker.listCheckpointBranches();
    expect(tracker.getActiveBranchPointer()?.checkpointId).toBe(aId);
  });

  it('applies the stash on a lazily-created store too', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-branch-resume-'));
    dirs.push(cwd);
    const aId = await seed(cwd);

    const tracker = makeTracker(cwd, null);
    tracker.restoreActiveBranch({ branchId: 'branch-1', checkpointId: aId }); // stashed, no store

    tracker.listCheckpointBranches(); // lazily creates store → applies stash
    expect(tracker.getActiveBranchPointer()?.checkpointId).toBe(aId);
  });
});
