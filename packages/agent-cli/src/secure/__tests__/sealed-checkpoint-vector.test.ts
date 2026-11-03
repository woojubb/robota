/**
 * Known answer for the product's sealed edit checkpoint: one manifest and its two pre-images, sealed
 * by `KeyHolderArtifactSealer` through the framework's sealed checkpoint state to the sealing key of
 * the fixed master key the keyring's own known-answer vectors use (`fixtures/keyring-v1.json`).
 * Sealing draws fresh randomness, so the files cannot be recomputed; they were produced once from
 * source and checked in. What they pin is that a checkpoint this build wrote still opens to the same
 * bytes, and only at its place: a change to the framing, the binding of a file to its session, turn
 * and pre-image number (kind, separator, the ids), or the keyring's sealing fails here even though
 * every round trip still passes.
 */
import { Buffer } from 'node:buffer';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EditCheckpointStore,
  WorkspaceTrustService,
  createDirectoryEditCheckpointState,
  createSealedEditCheckpointState,
  createWorkspaceProjectMutation,
} from '@robota-sdk/agent-framework';
import { parseKeyring } from '@robota-sdk/agent-keyring';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KeyHolderArtifactSealer } from '../artifact-sealer.js';
import { KeyHolder } from '../key-holder.js';
import { createMemoryKeyringStore } from './helpers.js';

import type { IEditCheckpointStateStorage } from '@robota-sdk/agent-framework';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const FIXTURE_RECOVERY_KEY = 'M2GT-58X4-MPKA-FA59-NANT-SBDE-NYRB-3CNK';
const SESSION = 'session_kat_v1';
const PREIMAGE_ONE = Buffer.from('known-answer pre-image one\n', 'utf8');
const PREIMAGE_TWO = Buffer.concat([
  Buffer.from([0x00, 0x01, 0xfe, 0xff]),
  Buffer.from('pre-image two', 'utf8'),
]);
/** The manifest the checked-in file holds, exactly as the store writes one. */
const KNOWN_MANIFEST = JSON.stringify(
  {
    version: 2,
    id: 'turn-0001',
    sessionId: SESSION,
    sequence: 1,
    prompt: 'known-answer edit, sealed checkpoint v1',
    createdAt: '2026-11-03T00:00:00.000Z',
    fileCount: 2,
    files: [
      {
        originalPath: '/work/kat/notes.txt',
        existed: true,
        snapshotFile: 'files/000001.content',
        byteLength: 27,
      },
      {
        originalPath: '/work/kat/data.bin',
        existed: true,
        snapshotFile: 'files/000002.content',
        byteLength: 17,
      },
    ],
    branchId: 'main',
  },
  null,
  2,
);

const keyring = parseKeyring(readFileSync(fixture('keyring-v1.json'), 'utf8'));

let dir: string;
let holder: KeyHolder;
let state: IEditCheckpointStateStorage;

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'sealed-checkpoint-vector-')));
  holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock({ type: 'recoveryKey', recoveryKey: FIXTURE_RECOVERY_KEY });
  state = createSealedEditCheckpointState(createDirectoryEditCheckpointState(join(dir, 'state')), {
    sealer: new KeyHolderArtifactSealer(holder),
  });
  placeFixture(SESSION, 'turn-0001');
});

afterEach(() => {
  holder.lock('explicit');
  rmSync(dir, { recursive: true, force: true });
});

/** The checked-in files laid out as checkpoint `turn` of session `session`. */
function placeFixture(session: string, turn: string): void {
  const checkpoint = join(dir, 'state', session, turn);
  mkdirSync(join(checkpoint, 'files'), { recursive: true });
  copyFileSync(fixture('checkpoint-v1-manifest.sealed'), join(checkpoint, 'manifest.json'));
  copyFileSync(fixture('checkpoint-v1-000001.sealed'), join(checkpoint, 'files', '000001.content'));
  copyFileSync(fixture('checkpoint-v1-000002.sealed'), join(checkpoint, 'files', '000002.content'));
}

function opened(path: string): Buffer {
  return Buffer.from(state.readBytes(path, 'known answer') ?? []);
}

async function storeOverFixture(): Promise<EditCheckpointStore> {
  const project = join(dir, 'project');
  mkdirSync(project, { recursive: true });
  const identity = {
    repositoryKey: `fixture:${project}`,
    displayPath: project,
    worktreeRoot: project,
  };
  const snapshot = { state: 'trusted' as const, generation: 1 };
  const access = await new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    projectStateDirectories: {
      sessions: '.kat/sessions',
      'session-logs': '.kat/logs',
      memory: '.kat/memory',
      checkpoints: '.kat/checkpoints',
    },
    store: {
      inspect: async () => snapshot,
      grant: async () => snapshot,
      revoke: async () => ({ ...snapshot, state: 'revoked' as const, generation: 2 }),
    },
  }).inspect(project);
  if (access.status !== 'trusted') throw new Error('expected a trusted fixture');
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'known answer',
    }),
    stateStorage: state,
  });
}

describe('sealed edit checkpoint version 1 — known answer', () => {
  it('opens the manifest and both pre-images to the known bytes', () => {
    for (const name of ['manifest', '000001', '000002']) {
      expect(
        readFileSync(fixture(`checkpoint-v1-${name}.sealed`))
          .subarray(0, 4)
          .toString('latin1'),
      ).toBe('RSL1');
    }
    expect(opened(`${SESSION}/turn-0001/manifest.json`).toString('utf8')).toBe(KNOWN_MANIFEST);
    expect(opened(`${SESSION}/turn-0001/files/000001.content`).equals(PREIMAGE_ONE)).toBe(true);
    expect(opened(`${SESSION}/turn-0001/files/000002.content`).equals(PREIMAGE_TWO)).toBe(true);
  });

  it('is listed and inspected through the store from its recorded sizes', async () => {
    const store = await storeOverFixture();

    expect(store.list(SESSION)).toEqual([
      {
        id: 'turn-0001',
        sessionId: SESSION,
        sequence: 1,
        prompt: 'known-answer edit, sealed checkpoint v1',
        createdAt: '2026-11-03T00:00:00.000Z',
        fileCount: 2,
      },
    ]);
    expect(
      store.inspect(SESSION, 'turn-0001').capturedFiles.map((file) => file.snapshotSizeBytes),
    ).toEqual([27, 17]);
  });

  it('does not open anywhere but its own place', () => {
    // The same files as another turn, and as another session.
    placeFixture(SESSION, 'turn-0002');
    placeFixture('session_kat_v2', 'turn-0001');
    // Pre-image one at pre-image two's number.
    copyFileSync(
      fixture('checkpoint-v1-000001.sealed'),
      join(dir, 'state', SESSION, 'turn-0002', 'files', '000002.content'),
    );

    for (const path of [
      `${SESSION}/turn-0002/manifest.json`,
      `${SESSION}/turn-0002/files/000001.content`,
      `${SESSION}/turn-0002/files/000002.content`,
      'session_kat_v2/turn-0001/manifest.json',
      'session_kat_v2/turn-0001/files/000001.content',
    ]) {
      expect(() => opened(path), path).toThrow(
        expect.objectContaining({ code: 'ARTIFACT_CORRUPT' }),
      );
    }
  });
});
