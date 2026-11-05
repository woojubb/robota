/**
 * Edit checkpoints whose state seals (#3679, secure conversation). Programs running as the same OS
 * user are the threat: they can read, move, plant and damage anything in the checkpoint directory,
 * so a sealed checkpoint file opens only at the place it was written, numbering never depends on
 * opening a manifest, a manifest is believed only where it agrees with its place, and a restore is
 * refused whole rather than done in part. Plain state is exactly what it was.
 */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArtifactCorruptError } from '@robota-sdk/agent-core';
import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import {
  WorkspaceAuthorityRequiredError,
  createWorkspaceProjectMutation,
} from '../../workspace-trust/index.js';
import { ProjectReadLimitExceededError } from '../../workspace-trust/project-reader-path.js';
import {
  EditCheckpointNumberingExhaustedError,
  EditCheckpointUnreadableError,
  EditCheckpointsLockedError,
} from '../edit-checkpoint-errors.js';
import { SEALED_PREIMAGE_MAX_BYTES } from '../edit-checkpoint-authority-io.js';
import { createSealedEditCheckpointState as sealState } from '../edit-checkpoint-sealed-state.js';
import { createDirectoryEditCheckpointState } from '../edit-checkpoint-state-storage.js';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';

import type { IEditCheckpointStateStorage } from '../edit-checkpoint-state-storage.js';
import type { IArtifactSealer, TArtifactSealing } from '@robota-sdk/agent-core';

const CANARY = 'PRIVATE-CHECKPOINT-CANARY-51c9';
const SESSION = 'session_1';
const LOCKED_TEXT = 'The edit checkpoints are sealed and the keys are locked; unlock to rewind.';
const NO_KEYS_TEXT = 'The edit checkpoints are sealed; this process has no keys to open them.';

let base: string;
let project: string;
let root: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-sealed-')));
  project = join(base, 'project');
  root = join(base, 'state');
  mkdirSync(project);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** What a sealed state was made from: the store takes the raw state and the decision, and seals itself. */
const origins = new WeakMap<
  IEditCheckpointStateStorage,
  { raw: IEditCheckpointStateStorage; sealing: TArtifactSealing; sealedOnly: boolean }
>();

/** `sealState`, remembering what the state was made from so `storeOver` can build a store over it. */
function createSealedEditCheckpointState(
  raw: IEditCheckpointStateStorage,
  sealing: TArtifactSealing,
  options: { readonly sealedOnly?: boolean } = {},
): IEditCheckpointStateStorage {
  const state = sealState(raw, sealing, options);
  origins.set(state, { raw, sealing, sealedOnly: options.sealedOnly === true });
  return state;
}

function sealedState(sealer: IArtifactSealer): IEditCheckpointStateStorage {
  return createSealedEditCheckpointState(createDirectoryEditCheckpointState(root), { sealer });
}

async function storeOver(
  state: IEditCheckpointStateStorage,
  options: { keysLocked?: () => boolean; now?: () => Date } = {},
): Promise<EditCheckpointStore> {
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  // A state made by `createSealedEditCheckpointState` is given as what it was made from; any other
  // state is kept plain.
  const origin = origins.get(state);
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'sealed checkpoint test',
    }),
    stateStorage: origin?.raw ?? state,
    sealing: origin?.sealing ?? 'plain',
    ...(origin?.sealedOnly === true ? { sealedOnly: true } : {}),
    ...options,
  });
}

/** One turn editing each of `files` (project-relative) to `after`, capturing each first. */
async function editTurn(
  store: EditCheckpointStore,
  prompt: string,
  files: Record<string, string>,
): Promise<string> {
  const summary = await store.beginTurn({ sessionId: SESSION, prompt });
  for (const [name, after] of Object.entries(files)) {
    const path = join(project, name);
    await store.captureFile(path);
    writeFileSync(path, after, 'utf8');
  }
  await store.finalizeTurn();
  return summary.id;
}

const at = (...segments: string[]): string => join(root, SESSION, ...segments);
const manifestOf = (state: IEditCheckpointStateStorage, id: string) =>
  JSON.parse(state.readText(`${SESSION}/${id}/manifest.json`, 'test') ?? 'null') as {
    id: string;
    parentId?: string;
    files: { byteLength?: number }[];
  };

interface IRecordingOptions {
  /** Writes to a path this says yes to throw, as a full disk would. */
  failWrite?: (path: string) => boolean;
  /** What a read of a path throws instead of reading it; `undefined` reads it. */
  failRead?: (path: string) => unknown;
  /** What a listing of a path throws instead of listing it; `undefined` lists it. */
  failList?: (path: string) => unknown;
}

/** `inner`, with each write recorded as `write <path>` or `replace <path>`, failing as told. */
function recordingState(inner: IEditCheckpointStateStorage, options: IRecordingOptions = {}) {
  const writes: string[] = [];
  const write = (verb: string, path: string, run: () => void): void => {
    writes.push(`${verb} ${path}`);
    if (options.failWrite?.(path) === true) throw new Error('disk full');
    run();
  };
  const read = <T>(path: string, run: () => T): T => {
    const refusal = options.failRead?.(path);
    if (refusal !== undefined) throw refusal;
    return run();
  };
  const state: IEditCheckpointStateStorage = {
    claimDirectory: (path, purpose) => {
      if (inner.claimDirectory === undefined) throw new Error('fixture requires atomic directory claims');
      return inner.claimDirectory(path, purpose);
    },
    readText: (path, purpose) => read(path, () => inner.readText(path, purpose)),
    readBytes: (path, purpose) => read(path, () => inner.readBytes(path, purpose)),
    writeText: (path, content, purpose) =>
      write('write', path, () => inner.writeText(path, content, purpose)),
    writeBytes: (path, content, purpose) =>
      write('write', path, () => inner.writeBytes(path, content, purpose)),
    replaceBytes: (path, content, purpose) =>
      write('replace', path, () => inner.replaceBytes!(path, content, purpose)),
    listDirectory: (path, purpose) => {
      const refusal = options.failList?.(path);
      if (refusal !== undefined) throw refusal;
      return inner.listDirectory(path, purpose);
    },
  };
  return { state, writes };
}

/** A plain manifest for checkpoint `sequence`, put in place as a program of the same user could. */
function plantPlainManifest(sequence: number): void {
  const id = `turn-${String(sequence).padStart(4, '0')}`;
  mkdirSync(at(id), { recursive: true });
  writeFileSync(
    at(id, 'manifest.json'),
    JSON.stringify({
      version: 2,
      id,
      sessionId: SESSION,
      sequence,
      prompt: 'planted',
      createdAt: '2026-11-03T00:00:00.000Z',
      fileCount: 0,
      files: [],
      branchId: 'main',
    }),
  );
}

/** A system error as `fs` throws one. */
function systemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: refused`), { code, errno: -13, syscall: 'open' });
}

describe('sealed checkpoint files are bound to their place', () => {
  it('keeps no plaintext on disk, opens each file where it was written, and nowhere else', async () => {
    writeFileSync(join(project, 'a.txt'), `a ${CANARY}`);
    writeFileSync(join(project, 'b.txt'), `b ${CANARY}`);
    const sealer = createTestArtifactSealer();
    const state = sealedState(sealer);
    const store = await storeOver(state);
    await editTurn(store, `first ${CANARY}`, { 'a.txt': 'a2', 'b.txt': 'b2' });
    await editTurn(store, 'second', { 'a.txt': 'a3' });

    for (const file of [
      'turn-0001/manifest.json',
      'turn-0001/files/000001.content',
      'turn-0001/files/000002.content',
    ]) {
      const stored = readFileSync(at(file));
      expect(stored.subarray(0, 4).toString('latin1'), file).toBe('RSL1');
      expect(stored.includes(Buffer.from(CANARY)), file).toBe(false);
    }
    expect(
      Buffer.from(state.readBytes(`${SESSION}/turn-0001/files/000002.content`, 't')!).toString(),
    ).toBe(`b ${CANARY}`);

    // A pre-image moved to another turn, or to another index of its own turn, does not open there.
    copyFileSync(at('turn-0001/files/000001.content'), at('turn-0002/files/000001.content'));
    copyFileSync(at('turn-0001/files/000001.content'), at('turn-0001/files/000002.content'));
    // A manifest moved to another session does not open there either.
    mkdirSync(join(root, 'session_2', 'turn-0001'), { recursive: true });
    copyFileSync(at('turn-0001/manifest.json'), join(root, 'session_2/turn-0001/manifest.json'));
    for (const path of [
      `${SESSION}/turn-0002/files/000001.content`,
      `${SESSION}/turn-0001/files/000002.content`,
      'session_2/turn-0001/manifest.json',
    ]) {
      expect(() => state.readBytes(path, 'test'), path).toThrow(ArtifactCorruptError);
    }
  });

  it('records each pre-image size in a sealed manifest', async () => {
    writeFileSync(join(project, 'a.txt'), '12345');
    const state = sealedState(createTestArtifactSealer());
    const store = await storeOver(state);
    await editTurn(store, 'edit', { 'a.txt': 'x' });

    expect(manifestOf(state, 'turn-0001').files).toEqual([
      expect.objectContaining({ byteLength: 5 }),
    ]);
  });

  it('refuses state that says it seals itself: the store seals, so it takes state that does not', async () => {
    const pretending = Object.assign(createDirectoryEditCheckpointState(root), { seals: true });

    await expect(storeOver(pretending)).rejects.toThrow(RangeError);
  });
});

describe('numbering never opens a manifest', () => {
  it('continues numbering with the keys locked, and overwrites no earlier pre-image', async () => {
    writeFileSync(join(project, 'notes.txt'), 'v1');
    const sealer = createTestArtifactSealer();
    const state = sealedState(sealer);
    await editTurn(await storeOver(state), 'one', { 'notes.txt': 'v2' });
    await editTurn(await storeOver(state), 'two', { 'notes.txt': 'v3' });
    const firstPreimage = readFileSync(at('turn-0001/files/000001.content'));
    sealer.lock();

    const resumed = await storeOver(state);
    const third = await editTurn(resumed, 'three', { 'notes.txt': 'v4' });

    expect(third).toBe('turn-0003');
    expect(readFileSync(at('turn-0001/files/000001.content')).equals(firstPreimage)).toBe(true);
    sealer.unlock();
    expect(resumed.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual([
      'turn-0001',
      'turn-0002',
      'turn-0003',
    ]);
    expect(manifestOf(state, 'turn-0003').parentId).toBe('turn-0002');
  });

  it('numbers past a checkpoint whose manifest does not open, and ignores names that are not turns', async () => {
    const state = sealedState(createTestArtifactSealer());
    for (const name of ['turn-0007', 'turn-00009', 'turn-12', 'turn-x', 'notes']) {
      mkdirSync(at(name), { recursive: true });
      writeFileSync(at(name, 'manifest.json'), 'not a manifest');
    }
    mkdirSync(at('turn-0008'), { recursive: true }); // an unfinished turn: no manifest

    const summary = await (await storeOver(state)).beginTurn({ sessionId: SESSION, prompt: 'p' });

    expect(summary.id).toBe('turn-0009');
  });

  it('refuses to checkpoint at the highest number instead of wrapping around', async () => {
    const state = sealedState(createTestArtifactSealer());
    mkdirSync(at('turn-999999999'), { recursive: true });
    writeFileSync(at('turn-999999999', 'manifest.json'), 'planted');
    const store = await storeOver(state);

    await expect(store.beginTurn({ sessionId: SESSION, prompt: 'p' })).rejects.toThrow(
      EditCheckpointNumberingExhaustedError,
    );
    await expect(store.finalizeTurn()).resolves.toBeUndefined();
    expect(readdirSync(join(root, SESSION))).toEqual(['turn-999999999']);
  });
});

describe('a resumed branch pointer with the manifests locked', () => {
  async function twoTurnsThenLock() {
    const sealer = createTestArtifactSealer();
    const state = sealedState(sealer);
    const writer = await storeOver(state);
    await editTurn(writer, 'one', {});
    await editTurn(writer, 'two', {});
    sealer.lock();
    return { sealer, state };
  }

  it('is applied when the checkpoint it names holds a manifest', async () => {
    const { sealer, state } = await twoTurnsThenLock();
    const resumed = await storeOver(state);
    const pointer = { branchId: 'branch-7', checkpointId: 'turn-0001' };

    resumed.restoreActiveBranch(SESSION, pointer);
    expect(resumed.getActiveBranchPointer(SESSION)).toEqual(pointer);
    const next = await editTurn(resumed, 'three', {});

    sealer.unlock();
    expect(manifestOf(state, next).parentId).toBe('turn-0001');
  });

  it('is not applied when that checkpoint has no manifest; the latest directory is the head', async () => {
    const { sealer, state } = await twoTurnsThenLock();
    mkdirSync(at('turn-0005'), { recursive: true });
    const resumed = await storeOver(state);

    for (const checkpointId of ['turn-0042', 'turn-0005', '../turn-0001']) {
      resumed.restoreActiveBranch(SESSION, { branchId: 'branch-7', checkpointId });
      expect(resumed.getActiveBranchPointer(SESSION), checkpointId).toBeUndefined();
    }
    const next = await editTurn(resumed, 'three', {});

    sealer.unlock();
    expect(manifestOf(state, next).parentId).toBe('turn-0002');
  });
});

describe('rolling back through the root', () => {
  async function rollBackThroughRoot(state: IEditCheckpointStateStorage) {
    const store = await storeOver(state);
    const first = await editTurn(store, 'a', {});
    await editTurn(store, 'b', {});
    await store.rollbackThroughCheckpoint(SESSION, first);
    return { store, next: await editTurn(store, 'c', {}) };
  }

  it('starts a fresh root line next turn in plain state', async () => {
    const state = createDirectoryEditCheckpointState(root);
    const { store, next } = await rollBackThroughRoot(state);

    expect(manifestOf(state, next).parentId).toBeUndefined();
    expect(store.checkpointAncestors(SESSION, next)).toEqual([next]);
  });

  it('starts a fresh root line next turn in sealed state', async () => {
    const state = sealedState(createTestArtifactSealer());
    const { store, next } = await rollBackThroughRoot(state);

    expect(manifestOf(state, next).parentId).toBeUndefined();
    expect(store.checkpointAncestors(SESSION, next)).toEqual([next]);
  });
});

describe('a manifest is believed only where it agrees with its place', () => {
  it.each([
    ['another checkpoint id', { id: 'turn-0001' }],
    ['another sequence', { sequence: 5 }],
    ['another session', { sessionId: 'session_2' }],
  ])('treats a manifest naming %s as damaged', async (_case, forged) => {
    const state = sealedState(createTestArtifactSealer());
    const writer = await storeOver(state);
    await editTurn(writer, 'one', {});
    await editTurn(writer, 'two', {});
    // Sealed in place, so it opens: only what it says disagrees with where it is.
    const original = manifestOf(state, 'turn-0002');
    state.writeText(
      `${SESSION}/turn-0002/manifest.json`,
      JSON.stringify({ ...original, ...forged }),
      'test',
    );

    const resumed = await storeOver(state);
    resumed.restoreActiveBranch(SESSION, { branchId: 'main', checkpointId: 'turn-0001' });

    expect(resumed.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual(['turn-0001']);
    expect(resumed.countUnreadable(SESSION)).toEqual({ damaged: 1, newer: 0 });
    expect(() => resumed.getActiveBranchPointer(SESSION)).not.toThrow();
    expect(resumed.listCheckpointBranches(SESSION)).toEqual(['turn-0001']);
    expect(() => resumed.inspect(SESSION, 'turn-0002')).toThrow(EditCheckpointUnreadableError);
  });
});

describe('what /rewind reads', () => {
  async function threeTurns(state: IEditCheckpointStateStorage) {
    writeFileSync(join(project, 'a.txt'), 'a1');
    const store = await storeOver(state);
    for (const [prompt, after] of [
      ['one', 'a2'],
      ['two', 'a3'],
      ['three', 'a4'],
    ] as const) {
      await editTurn(store, prompt, { 'a.txt': after });
    }
    return store;
  }

  it('lists only what opens, counts the rest, and names a checkpoint that would refuse a restore', async () => {
    const state = sealedState(createTestArtifactSealer());
    const store = await threeTurns(state);
    const damaged = readFileSync(at('turn-0002/manifest.json'));
    damaged[damaged.length - 1] ^= 0xff;
    writeFileSync(at('turn-0002/manifest.json'), damaged);
    writeFileSync(at('turn-0003/manifest.json'), 'RSL2 sealed by a newer build');

    expect(store.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual(['turn-0001']);
    expect(store.countUnreadable(SESSION)).toEqual({ damaged: 1, newer: 1 });
    expect(() => store.inspect(SESSION, 'turn-0003')).toThrow(
      'Edit checkpoint turn-0003 was written by a newer build and does not open here.',
    );
    const inspection = store.inspect(SESSION, 'turn-0001');
    expect(inspection.restoreToCheckpoint).toEqual({
      checkpointIds: [],
      fileCount: 0,
      blockedBy: { checkpointId: 'turn-0003', reason: 'newer' },
    });
    expect(inspection.rollbackThroughCheckpoint.blockedBy).toEqual({
      checkpointId: 'turn-0003',
      reason: 'newer',
    });
  });

  it('refuses every read with the locked text while the keys are locked', async () => {
    const sealer = createTestArtifactSealer();
    const store = await threeTurns(sealedState(sealer));
    sealer.lock();

    for (const read of [
      () => store.list(SESSION),
      () => store.countUnreadable(SESSION),
      () => store.inspect(SESSION, 'turn-0001'),
      () => store.listCheckpointBranches(SESSION),
      () => store.switchToCheckpoint(SESSION, 'turn-0001'),
    ]) {
      expect(read).toThrow(new EditCheckpointsLockedError('locked'));
      expect(read).toThrow(LOCKED_TEXT);
    }
    await expect(store.restoreToCheckpoint(SESSION, 'turn-0001')).rejects.toThrow(LOCKED_TEXT);
    await expect(store.rollbackThroughCheckpoint(SESSION, 'turn-0001')).rejects.toThrow(
      LOCKED_TEXT,
    );
  });

  it('refuses with the no-keys text where this process holds no keys at all', async () => {
    const sealer = createTestArtifactSealer();
    await threeTurns(sealedState(sealer));
    const writeOnly = await storeOver(sealedState(openTestWriteGrant(sealer.writeGrant())));

    expect(() => writeOnly.list(SESSION)).toThrow(NO_KEYS_TEXT);
    expect(() => writeOnly.list(SESSION)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_LOCKED', reason: 'no-keys' }),
    );
  });

  it("refuses a person's reads while the gate says the keys are locked, even where the state could open them", async () => {
    let locked = true;
    const state = sealedState(createTestArtifactSealer());
    const store = await storeOver(state, { keysLocked: () => locked });
    writeFileSync(join(project, 'a.txt'), 'a1');

    // Writes are never gated: the turn is checkpointed while locked.
    const id = await editTurn(store, 'edit', { 'a.txt': 'a2' });
    expect(() => store.list(SESSION)).toThrow(LOCKED_TEXT);
    expect(() => store.inspect(SESSION, id)).toThrow(LOCKED_TEXT);

    locked = false;
    expect(store.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual([id]);
  });

  it('inspects without opening a pre-image, and reports a missing one as unavailable', async () => {
    writeFileSync(join(project, 'a.txt'), 'twelve bytes');
    writeFileSync(join(project, 'b.txt'), 'b');
    const sealer = createTestArtifactSealer();
    const store = await storeOver(sealedState(sealer));
    const id = await editTurn(store, 'edit', { 'a.txt': 'x', 'b.txt': 'y' });
    unlinkSync(at(id, 'files', '000002.content'));
    const opens = vi.spyOn(sealer, 'openBytes');

    const inspection = store.inspect(SESSION, id);

    expect(opens.mock.calls.map(([, context]) => context.kind)).not.toContain(
      'checkpoint-preimage',
    );
    expect(inspection.capturedFiles).toEqual([
      expect.objectContaining({
        relativePath: 'a.txt',
        snapshotAvailable: true,
        snapshotSizeBytes: 12,
        snapshotSizeSource: 'recorded',
      }),
      {
        originalPath: join(project, 'b.txt'),
        relativePath: 'b.txt',
        existed: true,
        restoreAction: 'restore-preimage',
        snapshotAvailable: false,
      },
    ]);
  });
});

describe('capture in sealing mode', () => {
  it('captures a file of exactly the sealed pre-image limit, whose sealed file stays within the read limit', async () => {
    const content = Buffer.alloc(SEALED_PREIMAGE_MAX_BYTES, 0x61);
    writeFileSync(join(project, 'big.bin'), content);
    const state = sealedState(createTestArtifactSealer());
    const id = await editTurn(await storeOver(state), 'big', { 'big.bin': 'small' });

    expect(readFileSync(at(id, 'files', '000001.content')).byteLength).toBeLessThanOrEqual(
      4 * 1024 * 1024,
    );
    expect(
      Buffer.from(state.readBytes(`${SESSION}/${id}/files/000001.content`, 't')!).equals(content),
    ).toBe(true);
  });

  it('refuses one byte more exactly as an over-limit file is refused, where plain state captures it', async () => {
    writeFileSync(join(project, 'big.bin'), Buffer.alloc(SEALED_PREIMAGE_MAX_BYTES + 1, 0x61));
    const sealed = await storeOver(sealedState(createTestArtifactSealer()));
    await sealed.beginTurn({ sessionId: SESSION, prompt: 'big' });

    await expect(sealed.captureFile(join(project, 'big.bin'))).rejects.toThrow(
      ProjectReadLimitExceededError,
    );

    const plain = await storeOver(createDirectoryEditCheckpointState(join(base, 'plain')));
    await plain.beginTurn({ sessionId: SESSION, prompt: 'big' });
    await plain.captureFile(join(project, 'big.bin'));
    expect((await plain.finalizeTurn())?.fileCount).toBe(1);
  });
});

describe('plain state', () => {
  it('writes a plain manifest and plain pre-images in the checkpoint layout', async () => {
    writeFileSync(join(project, 'notes.txt'), `before ${CANARY}`);
    const plain = createDirectoryEditCheckpointState(root);
    expect(createSealedEditCheckpointState(plain, 'plain')).toBe(plain);
    const store = await storeOver(plain, { now: () => new Date('2026-11-03T00:00:00.000Z') });
    await editTurn(store, 'edit', { 'notes.txt': 'after' });

    expect(readdirSync(at('turn-0001')).sort()).toEqual(['files', 'manifest.json']);
    expect(readFileSync(at('turn-0001/files/000001.content'), 'utf8')).toBe(`before ${CANARY}`);
    expect(readFileSync(at('turn-0001/manifest.json'), 'utf8')).toBe(
      [
        '{',
        '  "version": 2,',
        '  "id": "turn-0001",',
        '  "sessionId": "session_1",',
        '  "sequence": 1,',
        '  "prompt": "edit",',
        '  "createdAt": "2026-11-03T00:00:00.000Z",',
        '  "fileCount": 1,',
        '  "files": [',
        '    {',
        `      "originalPath": ${JSON.stringify(join(project, 'notes.txt'))},`,
        '      "existed": true,',
        '      "snapshotFile": "files/000001.content"',
        '    }',
        '  ],',
        '  "branchId": "main"',
        '}',
      ].join('\n'),
    );
  });

  it('counts nothing as unreadable, and leaves a manifest that does not parse out of the listing', async () => {
    const store = await storeOver(createDirectoryEditCheckpointState(root));
    await editTurn(store, 'one', {});
    mkdirSync(at('turn-0002'), { recursive: true });
    writeFileSync(at('turn-0002', 'manifest.json'), 'not json');

    expect(store.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual(['turn-0001']);
    expect(store.countUnreadable(SESSION)).toEqual({ damaged: 0, newer: 0 });
  });
});

describe('a sealed manifest is replaced whole', () => {
  it('goes in place through replaceBytes, after its pre-images are written, where plain state writes it with writeBytes', async () => {
    writeFileSync(join(project, 'a.txt'), 'a1');
    const sealed = recordingState(createDirectoryEditCheckpointState(root));
    const store = await storeOver(
      createSealedEditCheckpointState(sealed.state, { sealer: createTestArtifactSealer() }),
    );
    await editTurn(store, 'edit', { 'a.txt': 'a2' });
    const plain = recordingState(createDirectoryEditCheckpointState(join(base, 'plain')));
    await editTurn(await storeOver(plain.state), 'edit', { 'a.txt': 'a3' });

    expect(sealed.writes).toEqual([
      `write ${SESSION}/turn-0001/files/000001.content`,
      `replace ${SESSION}/turn-0001/manifest.json`,
    ]);
    expect(store.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual(['turn-0001']);
    expect(plain.writes).toEqual([
      `write ${SESSION}/turn-0001/files/000001.content`,
      `write ${SESSION}/turn-0001/manifest.json`,
    ]);
  });
});

describe('a manifest write that fails', () => {
  it.each(['plain', 'sealed'] as const)(
    'leaves the head where it was, so the next turn is never its own parent (%s state)',
    async (kind) => {
      let failing = false;
      const { state: inner } = recordingState(createDirectoryEditCheckpointState(root), {
        failWrite: (path) => failing && path.endsWith('manifest.json'),
      });
      const state =
        kind === 'plain'
          ? inner
          : createSealedEditCheckpointState(inner, { sealer: createTestArtifactSealer() });
      const store = await storeOver(state);
      const first = await editTurn(store, 'one', {});
      failing = true;
      await store.beginTurn({ sessionId: SESSION, prompt: 'two' });
      await expect(store.finalizeTurn()).rejects.toThrow('disk full');
      failing = false;

      expect(store.getActiveBranchPointer(SESSION)?.checkpointId).toBe(first);
      const next = await editTurn(store, 'three', {});
      expect(next).toBe('turn-0003');
      expect(manifestOf(state, next).parentId).toBe(first);
      expect(store.checkpointAncestors(SESSION, next)).toEqual([next, first]);
    },
  );
});

describe('a plain manifest in sealed state', () => {
  it('is believed only below every sealed one: one numbered after a sealed manifest is damaged', async () => {
    await editTurn(await storeOver(createDirectoryEditCheckpointState(root)), 'plain', {});
    const state = sealedState(createTestArtifactSealer());
    await editTurn(await storeOver(state), 'sealed', {});
    plantPlainManifest(3);

    const store = await storeOver(state);

    expect(store.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual([
      'turn-0001',
      'turn-0002',
    ]);
    expect(store.countUnreadable(SESSION)).toEqual({ damaged: 1, newer: 0 });
  });

  it('is damaged wherever it is in state that never held a plain checkpoint', async () => {
    plantPlainManifest(1);
    const state = createSealedEditCheckpointState(
      createDirectoryEditCheckpointState(root),
      { sealer: createTestArtifactSealer() },
      { sealedOnly: true },
    );

    const store = await storeOver(state);

    expect(store.list(SESSION)).toEqual([]);
    expect(store.countUnreadable(SESSION)).toEqual({ damaged: 1, newer: 0 });
  });

  it("reads a plain checkpoint's pre-image as stored, even one that begins like a sealed file", async () => {
    const content = 'RSL1 is how this file happens to begin';
    writeFileSync(join(project, 'a.txt'), content);
    const first = await editTurn(await storeOver(createDirectoryEditCheckpointState(root)), 'p', {
      'a.txt': 'a2',
    });

    const inspection = (await storeOver(sealedState(createTestArtifactSealer()))).inspect(
      SESSION,
      first,
    );

    expect(inspection.capturedFiles).toEqual([
      expect.objectContaining({ snapshotAvailable: true, snapshotSizeBytes: content.length }),
    ]);
  });
});

describe('a resumed branch pointer, checked by its directory alone', () => {
  async function twoTurns() {
    const sealer = createTestArtifactSealer();
    const writer = await storeOver(sealedState(sealer));
    await editTurn(writer, 'one', {});
    await editTurn(writer, 'two', {});
    return sealer;
  }

  it('is applied without opening the manifest it names, however that manifest reads', async () => {
    const sealer = await twoTurns();
    const resumed = await storeOver(sealedState(sealer));
    const opens = vi.spyOn(sealer, 'openBytes');
    const pointer = { branchId: 'branch-7', checkpointId: 'turn-0001' };

    resumed.restoreActiveBranch(SESSION, pointer);
    expect(resumed.getActiveBranchPointer(SESSION)).toEqual(pointer);
    expect(opens).not.toHaveBeenCalled();

    writeFileSync(at('turn-0002', 'manifest.json'), 'RSL2 sealed by a newer build');
    const newer = { branchId: 'branch-8', checkpointId: 'turn-0002' };
    resumed.restoreActiveBranch(SESSION, newer);
    expect(resumed.getActiveBranchPointer(SESSION)).toEqual(newer);
  });

  it('is not applied when its directory cannot be listed', async () => {
    const sealer = await twoTurns();
    const { state: inner } = recordingState(createDirectoryEditCheckpointState(root), {
      failList: (path) => (path === `${SESSION}/turn-0001` ? systemError('EACCES') : undefined),
    });
    const resumed = await storeOver(createSealedEditCheckpointState(inner, { sealer }));

    resumed.restoreActiveBranch(SESSION, { branchId: 'branch-7', checkpointId: 'turn-0001' });

    expect(resumed.getActiveBranchPointer(SESSION)).toBeUndefined();
  });
});

describe('one manifest that cannot be read', () => {
  it.each([
    ['the system refuses it', () => systemError('EACCES')],
    [
      'the reader refuses it',
      () => new WorkspaceAuthorityRequiredError('Project reads do not follow links.'),
    ],
    ['it is past the read limit', () => new ProjectReadLimitExceededError(4, 5n)],
  ])('is counted as damaged when %s, and the others still list', async (_case, refusal) => {
    const sealer = createTestArtifactSealer();
    const writer = await storeOver(sealedState(sealer));
    for (const prompt of ['one', 'two', 'three']) await editTurn(writer, prompt, {});
    const { state: inner } = recordingState(createDirectoryEditCheckpointState(root), {
      failRead: (path) => (path === `${SESSION}/turn-0002/manifest.json` ? refusal() : undefined),
    });

    const store = await storeOver(createSealedEditCheckpointState(inner, { sealer }));

    expect(store.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual([
      'turn-0001',
      'turn-0003',
    ]);
    expect(store.countUnreadable(SESSION)).toEqual({ damaged: 1, newer: 0 });
  });

  it('fails the read for a defect, which no file can cause', async () => {
    const sealer = createTestArtifactSealer();
    await editTurn(await storeOver(sealedState(sealer)), 'one', {});
    const { state: inner } = recordingState(createDirectoryEditCheckpointState(root), {
      failRead: () => new TypeError('a defect'),
    });

    const store = await storeOver(createSealedEditCheckpointState(inner, { sealer }));

    expect(() => store.list(SESSION)).toThrow(TypeError);
  });

  it.each([
    ['a system error that says nothing of the file', systemError('EMFILE')],
    ['a thrown value that is not an object', null],
  ])('fails the read for %s, rethrowing it', async (_case, thrown) => {
    const sealer = createTestArtifactSealer();
    await editTurn(await storeOver(sealedState(sealer)), 'one', {});
    const { state: inner } = recordingState(createDirectoryEditCheckpointState(root), {
      failRead: () => thrown,
    });

    const store = await storeOver(createSealedEditCheckpointState(inner, { sealer }));

    await expect(async () => store.list(SESSION)).rejects.toBe(thrown);
  });
});

describe('a turn directory that cannot be listed', () => {
  it('is a damaged checkpoint that keeps its number and refuses a restore across it', async () => {
    const sealer = createTestArtifactSealer();
    const writer = await storeOver(sealedState(sealer));
    for (const prompt of ['one', 'two']) await editTurn(writer, prompt, {});
    const { state: inner } = recordingState(createDirectoryEditCheckpointState(root), {
      failList: (path) => (path === `${SESSION}/turn-0002` ? systemError('EACCES') : undefined),
    });
    const store = await storeOver(createSealedEditCheckpointState(inner, { sealer }));

    expect(store.listing(SESSION)).toEqual({
      checkpoints: [expect.objectContaining({ id: 'turn-0001' })],
      unreadable: { damaged: 1, newer: 0 },
    });
    await expect(store.restoreToCheckpoint(SESSION, 'turn-0001')).rejects.toThrow(
      'Edit checkpoint turn-0002 is damaged and does not open. Nothing was restored; restoring to a checkpoint after it still works.',
    );
    await expect(store.rollbackThroughCheckpoint(SESSION, 'turn-0002')).rejects.toThrow(
      EditCheckpointUnreadableError,
    );
    expect((await store.beginTurn({ sessionId: SESSION, prompt: 'three' })).id).toBe('turn-0003');
  });

  it('fails the read when listing it fails for a reason that says nothing of the directory', async () => {
    const sealer = createTestArtifactSealer();
    await editTurn(await storeOver(sealedState(sealer)), 'one', {});
    const transient = systemError('EMFILE');
    const { state: inner } = recordingState(createDirectoryEditCheckpointState(root), {
      failList: (path) => (path === `${SESSION}/turn-0001` ? transient : undefined),
    });

    const store = await storeOver(createSealedEditCheckpointState(inner, { sealer }));

    expect(() => store.list(SESSION)).toThrow(transient);
  });
});

describe('a listing', () => {
  it('lists and counts from one read, opening each manifest once', async () => {
    const sealer = createTestArtifactSealer();
    const store = await storeOver(sealedState(sealer));
    for (const prompt of ['one', 'two', 'three']) await editTurn(store, prompt, {});
    const damaged = readFileSync(at('turn-0002/manifest.json'));
    damaged[damaged.length - 1] ^= 0xff;
    writeFileSync(at('turn-0002/manifest.json'), damaged);
    const opens = vi.spyOn(sealer, 'openBytes');

    const listing = store.listing(SESSION);

    expect(listing.checkpoints.map((checkpoint) => checkpoint.id)).toEqual([
      'turn-0001',
      'turn-0003',
    ]);
    expect(listing.unreadable).toEqual({ damaged: 1, newer: 0 });
    expect(opens).toHaveBeenCalledTimes(3);
  });
});

// ARCH-047: restoring writes the project's files back, and project mutation is Linux-only.
describe.runIf(process.platform === 'linux')('restoring sealed checkpoints', () => {
  it('restores the pre-images it sealed, a plain checkpoint written before among them', async () => {
    writeFileSync(join(project, 'a.txt'), 'a1');
    const plainState = createDirectoryEditCheckpointState(root);
    const first = await editTurn(await storeOver(plainState), 'plain', { 'a.txt': 'a2' });
    const store = await storeOver(sealedState(createTestArtifactSealer()));
    await editTurn(store, 'sealed', { 'a.txt': 'a3' });

    await store.rollbackThroughCheckpoint(SESSION, first);

    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('a1');
  });

  it('refuses a range holding a checkpoint that does not open, naming it, and restores after it', async () => {
    writeFileSync(join(project, 'a.txt'), 'a1');
    const store = await storeOver(sealedState(createTestArtifactSealer()));
    const ids: string[] = [];
    for (const after of ['a2', 'a3', 'a4', 'a5'])
      ids.push(await editTurn(store, after, { 'a.txt': after }));
    writeFileSync(at(ids[1]!, 'manifest.json'), 'damaged');

    await expect(store.restoreToCheckpoint(SESSION, ids[0]!)).rejects.toThrow(
      'Edit checkpoint turn-0002 is damaged and does not open. Nothing was restored; restoring to a checkpoint after it still works.',
    );
    await expect(store.rollbackThroughCheckpoint(SESSION, ids[0]!)).rejects.toThrow(
      EditCheckpointUnreadableError,
    );
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('a5');

    await store.restoreToCheckpoint(SESSION, ids[2]!);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('a4');
  });

  const DAMAGED = 'is damaged and does not open';
  it.each([
    [
      'damaged',
      (path: string) => writeFileSync(path, Buffer.concat([Buffer.from('RSL1'), Buffer.alloc(40)])),
      DAMAGED,
    ],
    [
      'left plain under a sealed manifest, beside a staged sealed copy that opens',
      (path: string) => {
        writeFileSync(`${path}.sealing`, readFileSync(path));
        writeFileSync(path, 'b1');
      },
      'is still plain under its sealed manifest: a migration stopped part-way, and running `secure migrate` again finishes it',
    ],
    // Nothing vouches for plain bytes under a sealed manifest without a staged copy that opens.
    ['left plain under a sealed manifest', (path: string) => writeFileSync(path, 'b1'), DAMAGED],
    ['missing', (path: string) => unlinkSync(path), DAMAGED],
  ])(
    'opens every pre-image before the first write: one %s refuses the restore with nothing written',
    async (_case, spoil, state) => {
      writeFileSync(join(project, 'a.txt'), 'a1');
      writeFileSync(join(project, 'b.txt'), 'b1');
      const store = await storeOver(sealedState(createTestArtifactSealer()));
      const baseline = await editTurn(store, 'baseline', {});
      const edit = await editTurn(store, 'edit', { 'a.txt': 'a2', 'b.txt': 'b2' });
      spoil(at(edit, 'files', '000002.content'));

      // a.txt comes first in the plan and its pre-image opens; it must not be written either.
      const restored = await store.restoreToCheckpoint(SESSION, baseline).catch((error) => error);
      const rolledBack = await store
        .rollbackThroughCheckpoint(SESSION, edit)
        .catch((error) => error);

      expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('a2');
      expect(readFileSync(join(project, 'b.txt'), 'utf8')).toBe('b2');
      expect(restored).toBeInstanceOf(EditCheckpointUnreadableError);
      expect((restored as Error).message).toBe(
        `A pre-image of edit checkpoint ${edit} ${state}. Nothing was restored; restoring to a checkpoint after it still works.`,
      );
      expect(rolledBack).toBeInstanceOf(EditCheckpointUnreadableError);
    },
  );

  it('keeps open only the pre-image that decides each file, wiping every other one once verified', async () => {
    writeFileSync(join(project, 'a.txt'), 'a1');
    const sealer = createTestArtifactSealer();
    const store = await storeOver(sealedState(sealer));
    const baseline = await editTurn(store, 'baseline', {});
    for (const after of ['a2', 'a3', 'a4']) await editTurn(store, after, { 'a.txt': after });
    const opened: Uint8Array[] = [];
    const stillHeld: number[] = [];
    const open = sealer.openBytes.bind(sealer);
    vi.spyOn(sealer, 'openBytes').mockImplementation((stored, context) => {
      const plain = open(stored, context);
      if (context.kind === 'checkpoint-preimage') {
        stillHeld.push(opened.filter((bytes) => bytes.some((byte) => byte !== 0)).length);
        opened.push(plain);
      }
      return plain;
    });

    await store.restoreToCheckpoint(SESSION, baseline);

    // Latest first: the pre-images a3, a2 and a1 are opened in that order, and only a1 decides
    // what a.txt becomes, so neither earlier one is still held when the next is opened.
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('a1');
    expect(stillHeld).toEqual([0, 0, 0]);
    expect(opened.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });

  it("restores a plain checkpoint's pre-image as stored, even one that begins like a sealed file", async () => {
    const content = 'RSL1 is how this file happens to begin';
    writeFileSync(join(project, 'a.txt'), content);
    const first = await editTurn(await storeOver(createDirectoryEditCheckpointState(root)), 'p', {
      'a.txt': 'a2',
    });

    await (
      await storeOver(sealedState(createTestArtifactSealer()))
    ).rollbackThroughCheckpoint(SESSION, first);

    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe(content);
  });
});
