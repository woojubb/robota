import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, afterEach } from 'vitest';

import { SessionHistoryTracker } from '../interactive-session-history-tracker.js';
import { EditCheckpointStore } from '../../checkpoints/edit-checkpoint-store.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import {
  WorkspaceAuthorityRequiredError,
  createWorkspaceProjectMutation,
} from '../../workspace-trust/index.js';

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
  const store = await createStore(cwd);
  const a = await store.beginTurn({ sessionId: 'sess-resume', prompt: 'a' });
  await store.finalizeTurn();
  await store.beginTurn({ sessionId: 'sess-resume', prompt: 'b' });
  await store.finalizeTurn();
  await store.restoreToCheckpoint('sess-resume', a.id); // active head → a (fork)
  return a.id;
}

async function createStore(cwd: string): Promise<EditCheckpointStore> {
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'checkpoint branch resume test',
    }),
  });
}

describe('SELFHOST-007 TC-05a — active-branch restore survives store-injection ordering', () => {
  it('applies a stashed resume pointer on the first checkpoint access after setEditCheckpointStore', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-branch-resume-'));
    dirs.push(cwd);
    const aId = await seed(cwd);

    // STANDARD path: tracker constructed with NO store; resume restore runs first (stashes).
    const tracker = makeTracker(cwd, null);
    const resumedStore = await createStore(cwd);
    tracker.restoreActiveBranch({ branchId: 'branch-1', checkpointId: aId });
    tracker.setEditCheckpointStore(resumedStore); // must NOT throw (session not ready)

    // First checkpoint access (a nav read) applies the stash — active head becomes the restored 'a'.
    tracker.listCheckpointBranches();
    expect(tracker.getActiveBranchPointer()?.checkpointId).toBe(aId);
  });

  it('refuses checkpoint access instead of lazily creating ambient project authority', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'robota-branch-resume-'));
    dirs.push(cwd);
    const aId = await seed(cwd);

    const tracker = makeTracker(cwd, null);
    tracker.restoreActiveBranch({ branchId: 'branch-1', checkpointId: aId }); // stashed, no store

    expect(() => tracker.listCheckpointBranches()).toThrowError(WorkspaceAuthorityRequiredError);
    expect(tracker.getActiveBranchPointer()).toBeUndefined();
  });
});
