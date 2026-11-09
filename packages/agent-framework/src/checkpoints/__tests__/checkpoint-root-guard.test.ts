/**
 * An edit checkpoint store never snapshots its own state as a project file. The checkpoint root comes
 * from the host's layout in whatever spelling the host used (`.a\cp` from a Windows host), while the
 * path under test comes from `node:path`, so the guard compares segments, not text.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeCanonicalTempDir } from '../../testing/canonical-temp-dir.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';
import { createDirectoryEditCheckpointState } from '../edit-checkpoint-state-storage.js';
import { isInsideCheckpointRoot } from '../edit-checkpoint-store-helpers.js';

import type { IEditCheckpointStateStorage } from '../edit-checkpoint-state-storage.js';

describe('isInsideCheckpointRoot', () => {
  it.each([
    ['.a/cp', '.a/cp'],
    ['.a/cp/s1/turn-0001/manifest.json', '.a/cp'],
    ['.a/cp', '.a\\cp'],
    ['.a/cp/s1/turn-0001/manifest.json', '.a\\cp'],
    ['.a\\cp\\s1\\manifest.json', '.a/cp'],
    ['.a\\cp\\s1\\manifest.json', '.a\\cp'],
    ['.a/cp/s1', '.a\\cp/s1'],
  ])('holds %j to be the checkpoint root %j or inside it', (relativePath, root) => {
    expect(isInsideCheckpointRoot(relativePath, root)).toBe(true);
  });

  it.each([
    ['notes.txt', '.a\\cp'],
    ['.a', '.a\\cp'],
    ['.a/cp-two/x', '.a\\cp'],
    ['.a\\cp-two\\x', '.a/cp'],
    ['.a/c', '.a/cp'],
    ['x/.a/cp/y', '.a/cp'],
    ['.a/cp/s1', '.a/cp/s2'],
  ])('does not hold %j to be the checkpoint root %j or inside it', (relativePath, root) => {
    expect(isInsideCheckpointRoot(relativePath, root)).toBe(false);
  });
});

let base: string;
beforeEach(() => {
  base = makeCanonicalTempDir('checkpoint-root-guard-');
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Directory state that says it sits under `root` in the project, spelled as given. */
function stateSittingUnder(root: string): IEditCheckpointStateStorage {
  const held = createDirectoryEditCheckpointState(join(base, 'held'));
  return Object.create(held, { rootRelativePath: { value: root } }) as IEditCheckpointStateStorage;
}

async function captureUnder(root: string, file: string): Promise<number | undefined> {
  const project = join(base, 'project');
  mkdirSync(join(project, '.a', 'cp', 's1', 'turn-0001'), { recursive: true });
  mkdirSync(join(project, '.a', 'cp-two'), { recursive: true });
  writeFileSync(join(project, '.a', 'cp', 's1', 'turn-0001', 'manifest.json'), '{}');
  writeFileSync(join(project, '.a', 'cp-two', 'notes.txt'), 'not state');
  writeFileSync(join(project, '..dots.txt'), 'a valid project file');
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  const store = new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'checkpoint root guard test',
    }),
    stateStorage: stateSittingUnder(root),
    sealing: 'plain',
  });
  await store.beginTurn({ sessionId: 'session_1', prompt: 'edit' });
  await store.captureFile(join(project, file));
  return (await store.finalizeTurn())?.fileCount;
}

describe('an EditCheckpointStore whose state sits under the project', () => {
  it('captures a project file whose name starts with two dots', async () => {
    expect(await captureUnder('.a/cp', '..dots.txt')).toBe(1);
  });

  it.each(['.a/cp', '.a\\cp'])(
    'does not snapshot its own state as a project file, whether the root is spelled %j',
    async (root) => {
      expect(await captureUnder(root, '.a/cp/s1/turn-0001/manifest.json')).toBe(0);
    },
  );

  it.each(['.a/cp', '.a\\cp'])(
    'still captures a project file beside the root, whether the root is spelled %j',
    async (root) => {
      expect(await captureUnder(root, '.a/cp-two/notes.txt')).toBe(1);
    },
  );
});
