/**
 * An edit checkpoint store never snapshots its own state as a project file. The checkpoint root comes
 * from the host's layout in whatever spelling the host used (`.a\cp` from a Windows host), while the
 * path under test comes from `node:path`, so the guard compares segments, not text.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeCanonicalTempDir } from '../../testing/canonical-temp-dir.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';
import { EditCheckpointAuthorityIO } from '../edit-checkpoint-authority-io.js';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';
import { createDirectoryEditCheckpointState } from '../edit-checkpoint-state-storage.js';
import { isInsideCheckpointRoot } from '../edit-checkpoint-store-helpers.js';

import type { IEditCheckpointStateStorage } from '../edit-checkpoint-state-storage.js';

/** Whether `dir`'s volume reads names that differ only in case as one name (APFS and NTFS by default). */
function volumeIgnoresCase(dir: string): boolean {
  const marker = join(dir, 'Case-Probe');
  writeFileSync(marker, '');
  try {
    return existsSync(join(dir, 'case-probe'));
  } finally {
    rmSync(marker, { force: true });
  }
}

const probeDir = makeCanonicalTempDir('checkpoint-root-case-');
const caseInsensitive = volumeIgnoresCase(probeDir);
rmSync(probeDir, { recursive: true, force: true });

let base: string;
beforeEach(() => {
  base = makeCanonicalTempDir('checkpoint-root-guard-');
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('isInsideCheckpointRoot', () => {
  /** The directories the tables below name, so a spelling is tested against what the volume holds. */
  let project: string;
  beforeEach(() => {
    project = join(base, 'project');
    for (const dir of ['.a/cp/s1', '.a/cp/s2', '.a/cp-two', '.a/c', 'x/.a/cp']) {
      mkdirSync(join(project, ...dir.split('/')), { recursive: true });
    }
  });

  it.each([
    ['.a/cp', '.a/cp'],
    ['.a/cp/s1/turn-0001/manifest.json', '.a/cp'],
    ['.a/cp', '.a\\cp'],
    ['.a/cp/s1/turn-0001/manifest.json', '.a\\cp'],
    ['.a\\cp\\s1\\manifest.json', '.a/cp'],
    ['.a\\cp\\s1\\manifest.json', '.a\\cp'],
    ['.a/cp/s1', '.a\\cp/s1'],
  ])('holds %j to be the checkpoint root %j or inside it', (relativePath, root) => {
    expect(isInsideCheckpointRoot(project, relativePath, root)).toBe(true);
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
    expect(isInsideCheckpointRoot(project, relativePath, root)).toBe(false);
  });

  it.runIf(caseInsensitive).each([
    ['.A/CP', '.a/cp'],
    ['.A/Cp/s1/turn-0001/manifest.json', '.a/cp'],
    ['.a/cp/S1/x', '.A/CP'],
    ['.A\\CP\\s1', '.a\\cp'],
  ])(
    'holds %j to be the checkpoint root %j or inside it, the volume ignoring case',
    (relativePath, root) => {
      expect(isInsideCheckpointRoot(project, relativePath, root)).toBe(true);
    },
  );

  it.each([
    ['.A/CP-TWO/notes.txt', '.a/cp'],
    ['.A/C/x', '.a/cp'],
    ['.A/CP/S1/x', '.a/cp/s2'],
    ['.A/CP', '.a/cp/s1'],
  ])(
    'does not hold %j to be the checkpoint root %j or inside it, on any volume',
    (relativePath, root) => {
      expect(isInsideCheckpointRoot(project, relativePath, root)).toBe(false);
    },
  );

  it.runIf(!caseInsensitive)(
    'does not take a directory whose name differs only in case for the root, when the volume tells them apart',
    () => {
      mkdirSync(join(project, '.a', 'CP', 's1'), { recursive: true });
      expect(isInsideCheckpointRoot(project, '.a/CP/s1/x', '.a/cp')).toBe(false);
      expect(isInsideCheckpointRoot(project, '.a/cp/s1/x', '.a/cp')).toBe(true);
    },
  );

  it.runIf(process.platform !== 'win32')('does not follow a link to the root', () => {
    symlinkSync(join(project, '.a', 'cp'), join(project, 'alias'), 'dir');
    expect(isInsideCheckpointRoot(project, 'alias/s1/x', '.a/cp')).toBe(false);
  });

  it('holds nothing spelled another way inside a root that is not there yet', () => {
    const empty = join(base, 'empty');
    mkdirSync(empty);
    expect(isInsideCheckpointRoot(empty, '.A/CP/x', '.a/cp')).toBe(false);
    expect(isInsideCheckpointRoot(empty, '.a/cp/x', '.a/cp')).toBe(true);
  });
});

/** Directory state that says it sits under `root` in the project, spelled as given. */
function stateSittingUnder(root: string): IEditCheckpointStateStorage {
  const held = createDirectoryEditCheckpointState(join(base, 'held'));
  return Object.create(held, { rootRelativePath: { value: root } }) as IEditCheckpointStateStorage;
}

/** The authority and approved mutation a trusted fixture project gives a checkpoint store. */
async function trustedProject(project: string) {
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  const mutation = createWorkspaceProjectMutation(access.authority, {
    status: 'approved',
    purpose: 'checkpoint root guard test',
  });
  return { authority: access.authority, mutation };
}

async function openStore(
  project: string,
  stateStorage: IEditCheckpointStateStorage,
): Promise<EditCheckpointStore> {
  const { authority, mutation } = await trustedProject(project);
  return new EditCheckpointStore({ authority, mutation, stateStorage, sealing: 'plain' });
}

async function captureUnder(root: string, file: string): Promise<number | undefined> {
  const project = join(base, 'project');
  mkdirSync(join(project, '.a', 'cp', 's1', 'turn-0001'), { recursive: true });
  mkdirSync(join(project, '.a', 'cp-two'), { recursive: true });
  writeFileSync(join(project, '.a', 'cp', 's1', 'turn-0001', 'manifest.json'), '{}');
  writeFileSync(join(project, '.a', 'cp-two', 'notes.txt'), 'not state');
  writeFileSync(join(project, '..dots.txt'), 'a valid project file');
  const store = await openStore(project, stateSittingUnder(root));
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

  it.runIf(caseInsensitive).each([
    ['.a/cp', '.A/CP/s1/turn-0001/manifest.json'],
    ['.A/Cp', '.a/cp/s1/turn-0001/manifest.json'],
    ['.a/cp', '.a/Cp/S1/turn-0001/manifest.json'],
  ])(
    'does not snapshot its own state as a project file when root %j is reached as %j',
    async (root, file) => {
      expect(await captureUnder(root, file)).toBe(0);
    },
  );

  it('still captures a project file beside the root when it is reached by another case', async () => {
    expect(await captureUnder('.a/cp', '.A/CP-TWO/notes.txt')).toBe(1);
  });
});

/** A name that merely starts with two dots is a file inside the project, not a way out of it. */
describe('EditCheckpointAuthorityIO.toProjectRelativePath', () => {
  async function authorityIO(project: string): Promise<EditCheckpointAuthorityIO> {
    mkdirSync(project, { recursive: true });
    const { authority, mutation } = await trustedProject(project);
    return new EditCheckpointAuthorityIO(
      authority,
      mutation,
      createDirectoryEditCheckpointState(join(base, 'held')),
    );
  }

  it.each([
    ['..dots.txt', ['..dots.txt']],
    ['...', ['...']],
    ['.. x', ['.. x']],
    ['..hidden/notes.txt', ['..hidden', 'notes.txt']],
    ['a/..b/c', ['a', '..b', 'c']],
  ])('accepts %j, a name inside the project', async (name, segments) => {
    const project = join(base, 'project');
    const io = await authorityIO(project);
    expect(io.toProjectRelativePath(join(project, ...name.split('/')))).toBe(join(...segments));
  });

  it.each([
    ['the project root itself', (project: string) => project],
    ['a sibling of the project', (project: string) => join(dirname(project), 'x')],
    ['a sibling that shares the project name as a prefix', (project: string) => `${project}-x/f`],
    [
      'a path that climbs out of the project',
      (project: string) => join(project, 'a', '..', '..', 'x'),
    ],
    ['the filesystem root', (project: string) => parse(project).root],
  ])('refuses %s', async (_label, pathOf) => {
    const project = join(base, 'project');
    const io = await authorityIO(project);
    expect(() => io.toProjectRelativePath(pathOf(project))).toThrow(
      /outside the authorized project/u,
    );
  });

  it.runIf(process.platform === 'win32')('refuses a path on another drive or share', async () => {
    const project = join(base, 'project');
    const io = await authorityIO(project);
    const drive = parse(project).root[0]?.toUpperCase() === 'Z' ? 'Y' : 'Z';
    for (const path of [`${drive}:\\x\\y.txt`, '\\\\server\\share\\y.txt']) {
      expect(() => io.toProjectRelativePath(path), path).toThrow(/outside the authorized project/u);
    }
  });
});

/** Writing a project file back needs the host's root-anchored mutation, which only Linux provides. */
describe.runIf(process.platform === 'linux')(
  'restoring a project file whose name starts with two dots',
  () => {
    const FILES = ['..dots.txt', join('..hidden', 'notes.txt')];

    function projectWith(file: string, content: string | undefined): string {
      const project = join(base, 'project');
      mkdirSync(dirname(join(project, file)), { recursive: true });
      if (content !== undefined) writeFileSync(join(project, file), content);
      return project;
    }

    /** Checkpoint `file` in a turn of its own, then change it the way the turn's edit did. */
    async function editInTurn(
      store: EditCheckpointStore,
      project: string,
      file: string,
      after: string,
    ): Promise<void> {
      await store.beginTurn({ sessionId: 'session_1', prompt: 'edit' });
      await store.captureFile(join(project, file));
      writeFileSync(join(project, file), after);
      await store.finalizeTurn();
    }

    it.each(FILES)('rolls %j back through the checkpoint that captured it', async (file) => {
      const project = projectWith(file, 'before');
      const store = await openStore(
        project,
        createDirectoryEditCheckpointState(join(base, 'held')),
      );
      await editInTurn(store, project, file, 'after');

      const result = await store.rollbackThroughCheckpoint('session_1', 'turn-0001');

      expect(result.restoredFileCount).toBe(1);
      expect(readFileSync(join(project, file), 'utf8')).toBe('before');
    });

    it.each(FILES)('restores %j to the checkpoint taken before it was edited', async (file) => {
      const project = projectWith(file, 'before');
      const store = await openStore(
        project,
        createDirectoryEditCheckpointState(join(base, 'held')),
      );
      await store.beginTurn({ sessionId: 'session_1', prompt: 'first' });
      await store.finalizeTurn();
      await editInTurn(store, project, file, 'after');

      const result = await store.restoreToCheckpoint('session_1', 'turn-0001');

      expect(result.restoredFileCount).toBe(1);
      expect(readFileSync(join(project, file), 'utf8')).toBe('before');
    });

    it.each(FILES)('removes %j when the checkpointed turn created it', async (file) => {
      const project = projectWith(file, undefined);
      const store = await openStore(
        project,
        createDirectoryEditCheckpointState(join(base, 'held')),
      );
      await editInTurn(store, project, file, 'created');

      await store.rollbackThroughCheckpoint('session_1', 'turn-0001');

      expect(existsSync(join(project, file))).toBe(false);
    });
  },
);
