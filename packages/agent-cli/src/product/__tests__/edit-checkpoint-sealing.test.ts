/**
 * #3679 step 3c — how the product's edit checkpoints seal, from the same decision as every store:
 * plain exactly while the session stores are plain. Once a process seals, a session's persistent
 * checkpoints (which a later process resumes) are sealed with the keyring, so they open through any
 * runtime that holds those keys; a run that persists no session seals its ephemeral checkpoints with
 * the process's own key. Either way a person's `/rewind` reads are refused while the keyring holder
 * is locked, so "locked" means one thing for what they read of a conversation.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { isArtifactCorruptError } from '@robota-sdk/agent-core';
import { PROCESS_OWNER_RECORD_NAME } from '@robota-sdk/agent-core/node';
import { WorkspaceTrustService } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { KeyHolderArtifactSealer } from '../../secure/artifact-sealer.js';
import { KeyHolder } from '../../secure/key-holder.js';
import {
  FIXTURE_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
} from '../../secure/__tests__/helpers.js';
import { createCliWorkspaceComposition } from '../../startup/workspace-project-composition.js';
import { productProjectStateDirectories } from '../project-state-directories.js';
import {
  overrideProductSecureMode,
  resolveProductTransientSealing,
  useProductKeyHolder,
} from '../session-sealing.js';

import type { ICliRuntimeContext } from '../runtime-context.js';
import type { IArtifactContext, IArtifactSealer } from '@robota-sdk/agent-core';
import type { IWorkspaceIdentity } from '@robota-sdk/agent-framework';

const CANARY = 'PRIVATE-CHECKPOINT-CANARY-e37b';
const SESSION = 'session_1';
const PROJECT_STATE_DIRECTORIES = productProjectStateDirectories(createTestProductRuntime());
const LOCKED_TEXT = 'The edit checkpoints are sealed and the keys are locked; unlock to rewind.';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

async function unlockedHolder(): Promise<KeyHolder> {
  const { keyring } = await fixtureKeyring();
  const holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
  return holder;
}

async function trustedAccess(root: string) {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `fixture:${root}`,
    displayPath: root,
    worktreeRoot: root,
  };
  const snapshot = {
    state: 'trusted' as const,
    generation: 1,
    grantedAt: '2026-11-03T00:00:00.000Z',
  };
  return new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    projectStateDirectories: PROJECT_STATE_DIRECTORIES,
    store: {
      inspect: async () => snapshot,
      grant: async () => snapshot,
      revoke: async () => ({ ...snapshot, state: 'revoked', generation: 2 }),
    },
  }).inspect(root);
}

/** A runtime of its own, sealing with `holder` when one is given. */
function runtimeFor(holder?: KeyHolder): ICliRuntimeContext {
  const runtime = createTestProductRuntime('test-product', {
    HOME: tempRoot('test-product-checkpoint-sealing-home-'),
  });
  if (holder !== undefined) {
    overrideProductSecureMode(runtime, true);
    useProductKeyHolder(runtime, holder);
  }
  return runtime;
}

async function checkpointStoreOf(
  runtime: ICliRuntimeContext,
  project: string,
  options: { ephemeral?: boolean } = {},
) {
  const composition = createCliWorkspaceComposition({
    productRuntime: runtime,
    cwd: project,
    projectAccess: await trustedAccess(project),
    platform: 'linux',
    ...(options.ephemeral === true ? { ephemeralEditCheckpoints: true } : {}),
  });
  const createStore = composition.createEditCheckpointStore;
  if (createStore === undefined) throw new Error('expected a checkpoint store factory');
  return createStore();
}

async function checkpointEdit(
  store: Awaited<ReturnType<typeof checkpointStoreOf>>,
  project: string,
): Promise<void> {
  await store.beginTurn({ sessionId: SESSION, prompt: `rewrite notes ${CANARY}` });
  await store.captureFile(join(project, 'notes.txt'));
  writeFileSync(join(project, 'notes.txt'), 'after', 'utf8');
  await store.finalizeTurn();
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== PROCESS_OWNER_RECORD_NAME)
    .map((entry) => join(entry.parentPath, entry.name));
}

/** The prompt `sealer` opens from the sealed manifest at `file`, or the error opening it threw. */
function promptOpenedBy(sealer: IArtifactSealer, file: string): string | unknown {
  const context: IArtifactContext = {
    kind: 'checkpoint-manifest',
    id: `${SESSION}:${basename(dirname(file))}`,
  };
  try {
    const opened = sealer.openBytes(readFileSync(file), context);
    return (JSON.parse(Buffer.from(opened).toString('utf8')) as { prompt: string }).prompt;
  } catch (error) {
    return error;
  }
}

function processSealerOf(runtime: ICliRuntimeContext): IArtifactSealer {
  const sealing = resolveProductTransientSealing(runtime);
  if (sealing === 'plain') throw new Error('expected a sealing runtime');
  return sealing.sealer;
}

function expectSealed(files: readonly string[]): void {
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    const stored = readFileSync(file);
    expect(stored.subarray(0, 4).toString('latin1'), file).toBe('RSL1');
    expect(stored.includes(Buffer.from(CANARY)), file).toBe(false);
  }
}

describe('ephemeral edit checkpoints of a sealing process', () => {
  it('open with the process key and never with the keyring, and take no plain manifest for one', async () => {
    const holder = await unlockedHolder();
    const runtime = runtimeFor(holder);
    const project = tempRoot('test-product-checkpoint-sealing-project-');
    writeFileSync(join(project, 'notes.txt'), `before ${CANARY}`, 'utf8');
    const store = await checkpointStoreOf(runtime, project, { ephemeral: true });
    // A plain manifest planted in the process's directory before its first checkpoint, as a program
    // of the same user could: numbered below every sealed one, it is still never believed.
    const [processDirectory] = readdirSync(runtime.layout.userPaths.ephemeralCheckpoints);
    const planted = join(runtime.layout.userPaths.ephemeralCheckpoints, processDirectory!, SESSION);
    mkdirSync(join(planted, 'turn-0001'), { recursive: true });
    writeFileSync(
      join(planted, 'turn-0001', 'manifest.json'),
      JSON.stringify({
        version: 2,
        id: 'turn-0001',
        sessionId: SESSION,
        sequence: 1,
        prompt: 'planted',
        createdAt: '2026-11-03T00:00:00.000Z',
        fileCount: 0,
        files: [],
        branchId: 'main',
      }),
    );

    await checkpointEdit(store, project);

    const manifest = join(planted, 'turn-0002', 'manifest.json');
    expect(promptOpenedBy(processSealerOf(runtime), manifest)).toBe(`rewrite notes ${CANARY}`);
    expect(
      isArtifactCorruptError(promptOpenedBy(new KeyHolderArtifactSealer(holder), manifest)),
    ).toBe(true);
    expect(store.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual(['turn-0002']);
    expect(store.countUnreadable(SESSION)).toEqual({ damaged: 1, newer: 0 });
  });

  it('are sealed with the process key, and refused to a person while the keyring is locked', async () => {
    const holder = await unlockedHolder();
    const runtime = runtimeFor(holder);
    const project = tempRoot('test-product-checkpoint-sealing-project-');
    writeFileSync(join(project, 'notes.txt'), `before ${CANARY}`, 'utf8');
    const store = await checkpointStoreOf(runtime, project, { ephemeral: true });
    holder.lock('explicit');

    // The turn is still checkpointed while locked: writes are never refused.
    await checkpointEdit(store, project);

    expectSealed(filesUnder(runtime.layout.userPaths.ephemeralCheckpoints));
    expect(() => store.list(SESSION)).toThrow(LOCKED_TEXT);
    expect(() => store.inspect(SESSION, 'turn-0001')).toThrow(LOCKED_TEXT);

    await holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    expect(store.list(SESSION)).toEqual([
      expect.objectContaining({ id: 'turn-0001', fileCount: 1 }),
    ]);
    expect(store.inspect(SESSION, 'turn-0001').capturedFiles).toEqual([
      expect.objectContaining({
        snapshotAvailable: true,
        snapshotSizeBytes: `before ${CANARY}`.length,
      }),
    ]);
  });
});

// ARCH-047: the project's checkpoint directory is written through project mutation, Linux-only.
describe.runIf(process.platform === 'linux')('persistent edit checkpoints', () => {
  it('written through one runtime open through another holding the same keys, not its process key', async () => {
    const project = tempRoot('test-product-checkpoint-sealing-project-');
    writeFileSync(join(project, 'notes.txt'), `before ${CANARY}`, 'utf8');
    const writer = runtimeFor(await unlockedHolder());
    const reader = runtimeFor(await unlockedHolder());
    const writerTransient = resolveProductTransientSealing(writer);
    const readerTransient = resolveProductTransientSealing(reader);
    expect(writerTransient === 'plain' ? undefined : writerTransient.sealer).not.toBe(
      readerTransient === 'plain' ? undefined : readerTransient.sealer,
    );

    await checkpointEdit(await checkpointStoreOf(writer, project), project);

    const persisted = filesUnder(join(project, PROJECT_STATE_DIRECTORIES.checkpoints));
    expectSealed(persisted);
    const manifest = persisted.find((file) => file.endsWith('manifest.json'))!;
    expect(isArtifactCorruptError(promptOpenedBy(processSealerOf(writer), manifest))).toBe(true);
    const resumed = await checkpointStoreOf(reader, project);
    expect(resumed.list(SESSION)).toEqual([expect.objectContaining({ id: 'turn-0001' })]);
    await resumed.rollbackThroughCheckpoint(SESSION, 'turn-0001');
    expect(readFileSync(join(project, 'notes.txt'), 'utf8')).toBe(`before ${CANARY}`);
  });

  it('of a plain runtime are written as they always were', async () => {
    const project = tempRoot('test-product-checkpoint-sealing-project-');
    writeFileSync(join(project, 'notes.txt'), `before ${CANARY}`, 'utf8');

    await checkpointEdit(await checkpointStoreOf(runtimeFor(), project), project);

    const checkpoint = join(project, PROJECT_STATE_DIRECTORIES.checkpoints, SESSION, 'turn-0001');
    expect(readFileSync(join(checkpoint, 'files', '000001.content'), 'utf8')).toBe(
      `before ${CANARY}`,
    );
    const manifest = JSON.parse(readFileSync(join(checkpoint, 'manifest.json'), 'utf8')) as {
      prompt: string;
      files: Record<string, unknown>[];
    };
    expect(manifest.prompt).toBe(`rewrite notes ${CANARY}`);
    expect(Object.keys(manifest.files[0]!)).toEqual(['originalPath', 'existed', 'snapshotFile']);
  });
});
