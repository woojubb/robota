/**
 * #3679 — a session over sealed edit checkpoints: a turn its store cannot checkpoint still runs, and
 * says so where the person reads the conversation; `/rewind list` lists and counts from one read.
 */
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionHistoryTracker } from '../interactive-session-history-tracker.js';
import { createSealedEditCheckpointState } from '../../checkpoints/edit-checkpoint-sealed-state.js';
import { createDirectoryEditCheckpointState } from '../../checkpoints/edit-checkpoint-state-storage.js';
import { EditCheckpointStore } from '../../checkpoints/edit-checkpoint-store.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';

import type { IEditCheckpointStateStorage } from '../../checkpoints/edit-checkpoint-state-storage.js';
import type { IBranchEvent } from '@robota-sdk/agent-interface-session';

const SESSION = 'session_1';

let base: string;
let project: string;
let root: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'tracker-checkpoints-')));
  project = join(base, 'project');
  root = join(base, 'state');
  mkdirSync(project);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

async function trackerOver(state: IEditCheckpointStateStorage) {
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  const store = new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'tracker checkpoint test',
    }),
    stateStorage: state,
  });
  const events: IBranchEvent[] = [];
  const tracker = new SessionHistoryTracker(
    { cwd: project, projectAccess: access },
    () => SESSION,
    () => false,
    () => undefined,
    vi.fn(),
    vi.fn(),
    store,
    (event) => events.push(event),
  );
  return { tracker, events };
}

describe('a turn its checkpoint store cannot number', () => {
  it('runs without a checkpoint, and says why in the history', async () => {
    const state = createSealedEditCheckpointState(createDirectoryEditCheckpointState(root), {
      sealer: createTestArtifactSealer(),
    });
    mkdirSync(join(root, SESSION, 'turn-999999999'), { recursive: true });
    writeFileSync(join(root, SESSION, 'turn-999999999', 'manifest.json'), 'planted');
    const { tracker, events } = await trackerOver(state);

    await expect(tracker.beginEditCheckpointTurn('edit things')).resolves.toBeUndefined();
    await tracker.finalizeEditCheckpointTurn();

    expect(tracker.getHistory().at(-1)).toMatchObject({
      type: 'system',
      data: {
        content:
          "This session's edit checkpoints have reached the highest checkpoint number, so no new checkpoint can be made.",
      },
    });
    expect(events).toEqual([]);
    expect(readdirSync(join(root, SESSION))).toEqual(['turn-999999999']);
  });
});

describe("the session's checkpoint listing", () => {
  it('lists and counts from one read, opening each manifest once', async () => {
    const sealer = createTestArtifactSealer();
    const { tracker } = await trackerOver(
      createSealedEditCheckpointState(createDirectoryEditCheckpointState(root), { sealer }),
    );
    for (const prompt of ['one', 'two']) {
      await tracker.beginEditCheckpointTurn(prompt);
      await tracker.finalizeEditCheckpointTurn();
    }
    const opens = vi.spyOn(sealer, 'openBytes');

    const listing = tracker.editCheckpointListing();

    expect(listing.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([
      'turn-0001',
      'turn-0002',
    ]);
    expect(listing.unreadable).toEqual({ damaged: 0, newer: 0 });
    expect(opens).toHaveBeenCalledTimes(2);
  });
});
