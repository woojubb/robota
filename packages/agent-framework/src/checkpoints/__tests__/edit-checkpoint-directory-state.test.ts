/**
 * Edit checkpoints whose manifests and pre-images live outside the project, in a directory the host
 * owns for the run: what a `--no-session-persistence` run uses so `/rewind` keeps working while nothing
 * is written under the project or left on disk afterwards.
 *
 * Every case sets a permissive umask, so a mode assertion cannot pass on an inherited restrictive one.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, posix } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { makeCanonicalTempDir } from '../../testing/canonical-temp-dir.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import {
  WorkspaceAuthorityRequiredError,
  createWorkspaceProjectMutation,
} from '../../workspace-trust/index.js';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';
import {
  createDirectoryEditCheckpointState,
  type IEditCheckpointStateStorage,
} from '../edit-checkpoint-state-storage.js';

const CANARY = 'PRIVATE-CONVERSATION-CANARY-7f3a';
const mode = (path: string): number => statSync(path).mode & 0o7777;

let base: string;
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(0o022);
  base = makeCanonicalTempDir('checkpoint-directory-state-');
});

afterEach(() => {
  process.umask(previousUmask);
  rmSync(base, { recursive: true, force: true });
});

/** The files under `dir`, as paths relative to it. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = posix.join(prefix, entry.name);
      if (entry.isDirectory()) walk(join(current, entry.name), relative);
      else found.push(relative);
    }
  };
  walk(dir, '');
  return found.sort();
}

async function storeKeepingStateIn(
  project: string,
  state: IEditCheckpointStateStorage,
): Promise<EditCheckpointStore> {
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'checkpoint directory state test',
    }),
    stateStorage: state,
    sealing: 'plain',
  });
}

describe('createDirectoryEditCheckpointState', () => {
  it('keeps everything it writes owner-only: directories 0700, files 0600', () => {
    const root = join(base, 'state');
    const state = createDirectoryEditCheckpointState(root);

    state.writeText('session_1/turn-0001/manifest.json', '{}', 'persist checkpoint manifest');
    state.writeBytes('session_1/turn-0001/files/000001.content', Buffer.from('bytes'), 'pre-image');

    if (process.platform === 'win32') return;
    for (const directory of [
      root,
      join(root, 'session_1'),
      join(root, 'session_1/turn-0001/files'),
    ]) {
      expect(mode(directory), directory).toBe(0o700);
    }
    expect(mode(join(root, 'session_1/turn-0001/manifest.json'))).toBe(0o600);
    expect(mode(join(root, 'session_1/turn-0001/files/000001.content'))).toBe(0o600);
  });

  it('reads back what it wrote, answers undefined for a missing entry, lists a missing directory as empty', () => {
    const state = createDirectoryEditCheckpointState(join(base, 'state'));
    state.writeText('a/one.txt', 'one', 'test');
    state.writeBytes('a/sub/two.bin', Buffer.from([1, 2, 3]), 'test');

    expect(state.readText('a/one.txt', 'test')).toBe('one');
    expect(Array.from(state.readBytes('a/sub/two.bin', 'test') ?? [])).toEqual([1, 2, 3]);
    expect(state.readText('a/missing.txt', 'test')).toBeUndefined();
    expect(state.listDirectory('a', 'test')).toEqual(
      expect.arrayContaining([
        { name: 'one.txt', kind: 'file' },
        { name: 'sub', kind: 'directory' },
      ]),
    );
    expect(state.listDirectory('never-made', 'test')).toEqual([]);
  });

  it('refuses a path that leaves the directory, however it is spelled', () => {
    const state = createDirectoryEditCheckpointState(join(base, 'state'));

    for (const path of ['../escape.txt', 'a/../../escape.txt', '/etc/passwd', 'a//b', '']) {
      expect(() => state.writeText(path, 'x', 'test'), path).toThrow();
      expect(() => state.readText(path, 'test'), path).toThrow();
    }
    expect(existsSync(join(base, 'escape.txt'))).toBe(false);
  });

  it('replaces a file whole, owner-only, leaving nothing beside it', () => {
    const root = join(base, 'state');
    const state = createDirectoryEditCheckpointState(root);
    state.writeText(
      's/turn-0001/manifest.json',
      'what was there, longer than what replaces it',
      't',
    );

    state.replaceBytes!('s/turn-0001/manifest.json', Buffer.from('new'), 't');
    state.replaceBytes!('s/turn-0002/manifest.json', Buffer.from('first'), 't');

    expect(readFileSync(join(root, 's/turn-0001/manifest.json'), 'utf8')).toBe('new');
    expect(readFileSync(join(root, 's/turn-0002/manifest.json'), 'utf8')).toBe('first');
    expect(filesUnder(root)).toEqual(['s/turn-0001/manifest.json', 's/turn-0002/manifest.json']);
    if (process.platform === 'win32') return;
    expect(mode(join(root, 's/turn-0001/manifest.json'))).toBe(0o600);
    expect(mode(join(root, 's/turn-0002'))).toBe(0o700);
  });

  it('refuses to read a directory as a file, as the project reader refuses one', () => {
    const state = createDirectoryEditCheckpointState(join(base, 'state'));
    state.writeText('a/sub/one.txt', 'one', 'test');

    expect(() => state.readBytes('a/sub', 'test')).toThrow(WorkspaceAuthorityRequiredError);
  });

  it.skipIf(process.platform === 'win32')(
    'does not follow a link planted in the directory to read or write outside it',
    () => {
      const root = join(base, 'state');
      const state = createDirectoryEditCheckpointState(root);
      const outside = join(base, 'outside.txt');
      writeFileSync(outside, 'outside content');
      symlinkSync(outside, join(root, 'link.txt'));

      expect(() => state.readText('link.txt', 'test')).toThrow();
      expect(() => state.writeText('link.txt', 'overwritten', 'test')).toThrow();
      // A replace puts a file in the link's place; it never writes through it.
      state.replaceBytes!('link.txt', Buffer.from('replaced'), 'test');
      expect(readFileSync(outside, 'utf8')).toBe('outside content');
      expect(state.readText('link.txt', 'test')).toBe('replaced');
    },
  );
});

describe('an EditCheckpointStore given state held outside the project', () => {
  async function recordOneEdit(project: string, state: IEditCheckpointStateStorage) {
    const file = join(project, 'notes.txt');
    writeFileSync(file, `before ${CANARY}`, 'utf8');
    const store = await storeKeepingStateIn(project, state);
    const checkpoint = await store.beginTurn({ sessionId: 'session_1', prompt: `edit ${CANARY}` });
    await store.captureFile(file);
    writeFileSync(file, 'after', 'utf8');
    await store.finalizeTurn();
    return { store, file, checkpoint };
  }

  it('writes no checkpoint state under the project, and keeps the pre-image and prompt in its own directory', async () => {
    const project = join(base, 'project');
    mkdirSync(project);
    const root = join(base, 'ephemeral');

    const { store, checkpoint } = await recordOneEdit(
      project,
      createDirectoryEditCheckpointState(root),
    );

    expect(readdirSync(project)).toEqual(['notes.txt']);
    expect(filesUnder(root)).toEqual([
      'session_1/turn-0001/files/000001.content',
      'session_1/turn-0001/manifest.json',
    ]);
    expect(readFileSync(join(root, 'session_1/turn-0001/files/000001.content'), 'utf8')).toBe(
      `before ${CANARY}`,
    );
    expect(readFileSync(join(root, 'session_1/turn-0001/manifest.json'), 'utf8')).toContain(CANARY);
    expect(store.list('session_1')).toEqual([
      expect.objectContaining({ id: checkpoint.id, fileCount: 1 }),
    ]);
    expect(store.inspect('session_1', checkpoint.id).capturedFiles).toEqual([
      expect.objectContaining({ relativePath: 'notes.txt', snapshotAvailable: true }),
    ]);
  });

  it('still captures a project file whose directory is named like an unset checkpoint root', async () => {
    const project = join(base, 'project');
    mkdirSync(join(project, 'undefined'), { recursive: true });
    const file = join(project, 'undefined', 'notes.txt');
    writeFileSync(file, 'inside a directory called undefined', 'utf8');
    const state = createDirectoryEditCheckpointState(join(base, 'ephemeral'));
    const store = await storeKeepingStateIn(project, state);

    await store.beginTurn({ sessionId: 'session_1', prompt: 'edit' });
    await store.captureFile(file);
    const summary = await store.finalizeTurn();

    expect(summary?.fileCount).toBe(1);
  });

  // Restoring writes the project's files back, and project mutation is Linux-only.
  it.runIf(process.platform === 'linux')(
    'still restores the project file from the pre-image it kept elsewhere',
    async () => {
      const project = join(base, 'project');
      mkdirSync(project);
      const { store, file, checkpoint } = await recordOneEdit(
        project,
        createDirectoryEditCheckpointState(join(base, 'ephemeral')),
      );
      await store.beginTurn({ sessionId: 'session_1', prompt: 'second edit' });
      await store.captureFile(file);
      writeFileSync(file, 'later', 'utf8');
      await store.finalizeTurn();

      await store.restoreToCheckpoint('session_1', checkpoint.id);

      expect(readFileSync(file, 'utf8')).toBe('after');
      expect(readdirSync(project)).toEqual(['notes.txt']);
    },
  );
});
