/**
 * Sealing a trusted project's plain edit checkpoints in place (#3679, secure conversation): newest
 * turn first so every turn stays readable while it runs, stopping at the first turn that must stay
 * plain, staged pre-images flushed before the manifest commits, and a rerun that finishes from what
 * opens — never swapping in a staged file that does not. Project writes are Linux-only, so these run
 * there.
 */
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import {
  createWorkspaceProjectMutation,
  getWorkspaceProjectStateStorage,
} from '../../workspace-trust/index.js';
import { SEALED_PREIMAGE_MAX_BYTES } from '../edit-checkpoint-authority-io.js';
import { EditCheckpointUnreadableError } from '../edit-checkpoint-errors.js';
import { migrateWorkspaceEditCheckpoints } from '../edit-checkpoint-migration.js';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';

import type { IWorkspaceProjectAuthority } from '../../workspace-trust/index.js';
import type { IArtifactSealer } from '@robota-sdk/agent-core';

const CANARY = 'CANARY-0d4a-before-the-edit';
const SESSION = 'session_1';

let base: string;
let project: string;
let authority: IWorkspaceProjectAuthority;

beforeEach(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-migration-')));
  project = join(base, 'project');
  mkdirSync(project);
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected a trusted fixture');
  authority = access.authority;
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const checkpoints = () => getWorkspaceProjectStateStorage(authority, 'checkpoints');
const turnPath = (turn: string, ...rest: string[]): string =>
  join(project, '.agent', 'checkpoints', SESSION, turn, ...rest);

function store(sealer?: IArtifactSealer): EditCheckpointStore {
  return new EditCheckpointStore({
    authority,
    mutation: createWorkspaceProjectMutation(authority, {
      status: 'approved',
      purpose: 'checkpoint migration test',
    }),
    sealing: sealer === undefined ? 'plain' : { sealer },
  });
}

/**
 * `turns` plain checkpoints, as builds before sealing wrote them: turn N captures `a.txt` as it was
 * (`a<N>` with the canary) before rewriting it, so restoring to turn N brings back `a<N>`.
 */
async function seedPlainTurns(turns: number, big?: number): Promise<string[]> {
  const plain = store();
  const ids: string[] = [];
  writeFileSync(join(project, 'a.txt'), `a1 ${CANARY}`);
  for (let turn = 1; turn <= turns; turn += 1) {
    const summary = await plain.beginTurn({
      sessionId: SESSION,
      prompt: `${CANARY} prompt ${turn}`,
    });
    if (turn === big) {
      writeFileSync(join(project, 'big.bin'), Buffer.alloc(SEALED_PREIMAGE_MAX_BYTES + 1, 0x61));
      await plain.captureFile(join(project, 'big.bin'));
    }
    await plain.captureFile(join(project, 'a.txt'));
    writeFileSync(join(project, 'a.txt'), `a${turn + 1} ${CANARY}`);
    await plain.finalizeTurn();
    ids.push(summary.id);
  }
  return ids;
}

function everyFile(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

const checkpointFiles = (): string[] => everyFile(join(project, '.agent', 'checkpoints'));
const withCanary = (): string[] =>
  checkpointFiles().filter((path) => readFileSync(path).includes(Buffer.from(CANARY)));
const snapshot = () => checkpointFiles().map((path) => [path, readFileSync(path)] as const);

describe.runIf(process.platform === 'linux')('migrateWorkspaceEditCheckpoints', () => {
  it('seals every turn with its pre-images; a sealing store reads, inspects and restores them all', async () => {
    const ids = await seedPlainTurns(3);
    const sealer = createTestArtifactSealer();

    const result = migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true });

    expect(result).toMatchObject({
      turnsSealed: 3,
      preimagesSealed: 3,
      keptPlain: [],
      damaged: [],
    });
    expect(withCanary()).toEqual([]);
    const sealed = store(sealer);
    expect(sealed.listing(SESSION)).toMatchObject({ unreadable: { damaged: 0, newer: 0 } });
    expect(sealed.list(SESSION).map((summary) => summary.id)).toEqual(ids);
    expect(sealed.inspect(SESSION, ids[1]!).capturedFiles[0]).toMatchObject({
      snapshotSizeBytes: Buffer.byteLength(`a2 ${CANARY}`),
      snapshotSizeSource: 'recorded',
    });
    await sealed.rollbackThroughCheckpoint(SESSION, ids[1]!);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe(`a2 ${CANARY}`);
  });

  it('goes newest turn first, so a run stopped part-way leaves every turn readable', async () => {
    const ids = await seedPlainTurns(3);
    const sealer = createTestArtifactSealer();
    let commits = 0;

    expect(() =>
      migrateWorkspaceEditCheckpoints(checkpoints(), {
        sealer,
        apply: true,
        beforeCommit: () => {
          commits += 1;
          if (commits === 2) throw new Error('stopped after the first turn');
        },
      }),
    ).toThrow('stopped after the first turn');

    const sealed = store(sealer);
    expect(sealed.listing(SESSION).unreadable).toEqual({ damaged: 0, newer: 0 });
    expect(sealed.list(SESSION).map((summary) => summary.id)).toEqual(ids);
    expect(readFileSync(turnPath(ids[2]!, 'manifest.json')).subarray(0, 4).toString('ascii')).toBe(
      'RSL1',
    );
    expect(readFileSync(turnPath(ids[0]!, 'manifest.json'), 'utf8')).toContain(CANARY);
  });

  it('stops descending at a turn whose pre-image would be past the read limit sealed', async () => {
    const ids = await seedPlainTurns(3, 2);
    const sealer = createTestArtifactSealer();

    const result = migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true });

    expect(result.turnsSealed).toBe(1);
    expect(result.keptPlain).toEqual([
      { turn: `.agent/checkpoints/${SESSION}/${ids[1]}`, reason: 'over-cap', olderTurns: 1 },
    ]);
    const sealed = store(sealer);
    expect(sealed.listing(SESSION).unreadable).toEqual({ damaged: 0, newer: 0 });
    expect(sealed.list(SESSION).map((summary) => summary.id)).toEqual(ids);
  });

  it('stops descending at a turn that keeps a pre-image under a name no sealed checkpoint can hold', async () => {
    const ids = await seedPlainTurns(2);
    const manifestPath = turnPath(ids[0]!, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: { snapshotFile: string }[];
    };
    manifest.files[0]!.snapshotFile = 'files/custom.bin';
    writeFileSync(join(turnPath(ids[0]!, 'files'), 'custom.bin'), `a1 ${CANARY}`);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = migrateWorkspaceEditCheckpoints(checkpoints(), {
      sealer: createTestArtifactSealer(),
      apply: true,
    });

    expect(result.turnsSealed).toBe(1);
    expect(result.keptPlain).toEqual([
      { turn: `.agent/checkpoints/${SESSION}/${ids[0]}`, reason: 'snapshot-name', olderTurns: 0 },
    ]);
  });

  it('never follows a pre-image that is a link: that turn and every older one stay plain', async () => {
    const ids = await seedPlainTurns(2);
    const outside = join(base, 'outside.txt');
    writeFileSync(outside, `${CANARY} outside the project`);
    const preimage = turnPath(ids[0]!, 'files', '000001.content');
    rmSync(preimage);
    symlinkSync(outside, preimage);

    const result = migrateWorkspaceEditCheckpoints(checkpoints(), {
      sealer: createTestArtifactSealer(),
      apply: true,
    });

    expect(result.keptPlain).toEqual([
      { turn: `.agent/checkpoints/${SESSION}/${ids[0]}`, reason: 'snapshot-name', olderTurns: 0 },
    ]);
    expect(result.refused).toEqual([
      `.agent/checkpoints/${SESSION}/${ids[0]}/files/000001.content`,
    ]);
    expect(readFileSync(outside, 'utf8')).toBe(`${CANARY} outside the project`);
  });

  it('is idempotent, and planning writes nothing', async () => {
    await seedPlainTurns(2);
    const sealer = createTestArtifactSealer();
    const plain = snapshot();

    expect(migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: false })).toMatchObject({
      turnsSealed: 2,
      preimagesSealed: 2,
    });
    expect(snapshot()).toEqual(plain);

    migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true });
    const sealed = snapshot();
    expect(migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true })).toMatchObject({
      turnsSealed: 0,
      turnsFinished: 0,
      alreadySealed: 2,
    });
    expect(snapshot()).toEqual(sealed);
  });

  it('stopped at a manifest commit, leaves staged files under the plain manifest that a rerun redoes', async () => {
    const ids = await seedPlainTurns(1);
    const sealer = createTestArtifactSealer();

    expect(() =>
      migrateWorkspaceEditCheckpoints(checkpoints(), {
        sealer,
        apply: true,
        beforeCommit: () => {
          throw new Error('crash at the commit');
        },
      }),
    ).toThrow('crash at the commit');
    expect(existsSync(turnPath(ids[0]!, 'files', '000001.content.sealing'))).toBe(true);
    expect(readFileSync(turnPath(ids[0]!, 'manifest.json'), 'utf8')).toContain(CANARY);

    expect(migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true })).toMatchObject({
      turnsSealed: 1,
    });
    expect(withCanary()).toEqual([]);
    expect(existsSync(turnPath(ids[0]!, 'files', '000001.content.sealing'))).toBe(false);
    await store(sealer).rollbackThroughCheckpoint(SESSION, ids[0]!);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe(`a1 ${CANARY}`);
  });

  it('finishes from a staged file that opens a turn stopped after its commit; until then a rewind says to run it again', async () => {
    const ids = await seedPlainTurns(1);
    const sealer = createTestArtifactSealer();
    migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true });
    // The state a crash right after the manifest commit leaves: the sealed pre-image is staged, and
    // the original is still the plain one.
    const preimage = turnPath(ids[0]!, 'files', '000001.content');
    writeFileSync(`${preimage}.sealing`, readFileSync(preimage));
    writeFileSync(preimage, `a1 ${CANARY}`);

    const refused = await store(sealer)
      .rollbackThroughCheckpoint(SESSION, ids[0]!)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(EditCheckpointUnreadableError);
    expect((refused as EditCheckpointUnreadableError).unfinishedMigration).toBe(true);
    expect((refused as Error).message).toContain('running `secure migrate` again finishes it');

    expect(migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true })).toMatchObject({
      turnsFinished: 1,
      preimagesSealed: 1,
    });
    expect(withCanary()).toEqual([]);
    expect(existsSync(`${preimage}.sealing`)).toBe(false);
    await store(sealer).rollbackThroughCheckpoint(SESSION, ids[0]!);
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe(`a1 ${CANARY}`);
  });

  it('never seals a plain pre-image found under a sealed manifest with no staged file that opens: it is reported, as a rewind reports it', async () => {
    const ids = await seedPlainTurns(1);
    const sealer = createTestArtifactSealer();
    migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true });
    // Plaintext where a sealed pre-image was, and a staged file that does not open: nothing vouches
    // for these bytes, so sealing them would make whatever put them there restorable.
    const preimage = turnPath(ids[0]!, 'files', '000001.content');
    writeFileSync(`${preimage}.sealing`, '');
    writeFileSync(preimage, `planted ${CANARY}`);

    const result = migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true });

    expect(result.damaged).toEqual([
      `.agent/checkpoints/${SESSION}/${ids[0]}/files/000001.content`,
    ]);
    expect(result).toMatchObject({ turnsFinished: 0, preimagesSealed: 0 });
    expect(readFileSync(preimage, 'utf8')).toBe(`planted ${CANARY}`);
    const refused = await store(sealer)
      .rollbackThroughCheckpoint(SESSION, ids[0]!)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(EditCheckpointUnreadableError);
    expect((refused as EditCheckpointUnreadableError).unfinishedMigration).toBe(false);
    expect((refused as Error).message).not.toContain('secure migrate');
  });

  it('leaves as it is, and reports, a plain manifest numbered above a sealed one, as a sealing store reads it', async () => {
    const ids = await seedPlainTurns(2);
    const newest = turnPath(ids[1]!, 'manifest.json');
    const plainManifest = readFileSync(newest);
    const plainPreimage = readFileSync(turnPath(ids[1]!, 'files', '000001.content'));
    const sealer = createTestArtifactSealer();
    migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true });
    // A plain turn put back above the sealed one, as only something other than a sealing store writes.
    writeFileSync(newest, plainManifest);
    writeFileSync(turnPath(ids[1]!, 'files', '000001.content'), plainPreimage);

    const result = migrateWorkspaceEditCheckpoints(checkpoints(), { sealer, apply: true });

    expect(result.damaged).toEqual([`.agent/checkpoints/${SESSION}/${ids[1]}/manifest.json`]);
    expect(result).toMatchObject({ turnsSealed: 0, alreadySealed: 1 });
    expect(readFileSync(newest)).toEqual(plainManifest);
    expect(store(sealer).listing(SESSION).unreadable).toEqual({ damaged: 1, newer: 0 });
  });

  it('never seals a turn whose pre-image has another name: that turn and every older one stay plain', async () => {
    const ids = await seedPlainTurns(2);
    const preimage = turnPath(ids[1]!, 'files', '000001.content');
    linkSync(preimage, join(base, 'kept-elsewhere.content'));

    const result = migrateWorkspaceEditCheckpoints(checkpoints(), {
      sealer: createTestArtifactSealer(),
      apply: true,
    });

    expect(result.keptPlain).toEqual([
      { turn: `.agent/checkpoints/${SESSION}/${ids[1]}`, reason: 'hard-linked', olderTurns: 1 },
    ]);
    expect(result.refused).toEqual([
      `.agent/checkpoints/${SESSION}/${ids[1]}/files/000001.content`,
    ]);
    expect(readFileSync(preimage, 'utf8')).toContain(CANARY);
  });

  it('reports, and leaves as it is, a plain manifest that does not parse, going on below it', async () => {
    const ids = await seedPlainTurns(2);
    writeFileSync(turnPath(ids[1]!, 'manifest.json'), `{"prompt":"${CANARY}`);

    const result = migrateWorkspaceEditCheckpoints(checkpoints(), {
      sealer: createTestArtifactSealer(),
      apply: true,
    });

    expect(result.damaged).toEqual([`.agent/checkpoints/${SESSION}/${ids[1]}/manifest.json`]);
    expect(result.turnsSealed).toBe(1);
  });
});
