/**
 * A run that persists no session still gets working edit checkpoints (so `/rewind` can undo the run's
 * own edits), but the pre-images and the prompts the manifests record must not outlive it or sit in
 * the project: they live in an owner-only per-process directory of the state root.
 *
 * The composition's platform is injected, as the other checkpoint tests do, so the store is built on
 * a host whose project writes are refused; the ephemeral directory is the store's own state and does
 * not need them. A permissive umask is set so a mode assertion cannot pass on an inherited one.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PROCESS_OWNER_RECORD_NAME,
  runProcessEndNow,
} from '@robota-sdk/agent-core/node';
import { WorkspaceTrustService } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { productProjectStateDirectories } from '../../product/project-state-directories.js';
import { createCliWorkspaceComposition } from '../workspace-project-composition.js';

import { createNodeWorkspaceProjectFiles } from '@robota-sdk/agent-framework/node';
import type { IWorkspaceIdentity } from '@robota-sdk/agent-framework';

const CANARY = 'PRIVATE-CONVERSATION-CANARY-91c4';
const PROJECT_STATE_DIRECTORIES = productProjectStateDirectories(createTestProductRuntime());
const mode = (path: string): number => statSync(path).mode & 0o7777;

const roots: string[] = [];
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(0o022);
});

afterEach(() => {
  process.umask(previousUmask);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
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
    grantedAt: '2026-11-01T00:00:00.000Z',
  };
  return new WorkspaceTrustService({
    projectFiles: createNodeWorkspaceProjectFiles(),
    identityResolver: { resolve: () => identity },
    projectStateDirectories: PROJECT_STATE_DIRECTORIES,
    store: {
      inspect: async () => snapshot,
      grant: async () => snapshot,
      revoke: async () => ({ ...snapshot, state: 'revoked', generation: 2 }),
    },
  }).inspect(root);
}

async function compositionFor(options: { ephemeral: boolean }) {
  const project = tempRoot('test-product-ephemeral-checkpoints-project-');
  const home = tempRoot('test-product-ephemeral-checkpoints-home-');
  writeFileSync(join(project, 'notes.txt'), `before ${CANARY}`, 'utf8');
  const productRuntime = createTestProductRuntime('test-product', { HOME: home });
  const composition = createCliWorkspaceComposition({
    productRuntime,
    cwd: project,
    userHome: home,
    projectAccess: await trustedAccess(project),
    platform: 'linux',
    ...(options.ephemeral ? { ephemeralEditCheckpoints: true } : {}),
  });
  const createStore = composition.createEditCheckpointStore;
  if (createStore === undefined) throw new Error('expected a checkpoint store factory');
  return { project, home, productRuntime, createStore };
}

describe('edit checkpoints of a run that persists no session', () => {
  it.skipIf(process.platform === 'win32')(
    'keep the pre-image and the prompt in an owner-only per-process directory of the state root, nothing in the project',
    async () => {
      const { project, productRuntime, createStore } = await compositionFor({ ephemeral: true });
      const store = createStore();

      await store.beginTurn({ sessionId: 'session_1', prompt: `rewrite notes ${CANARY}` });
      await store.captureFile(join(project, 'notes.txt'));
      writeFileSync(join(project, 'notes.txt'), 'after', 'utf8');
      await store.finalizeTurn();

      expect(readdirSync(project)).toEqual(['notes.txt']);
      const parent = productRuntime.layout.userPaths.ephemeralCheckpoints;
      const [directoryName] = readdirSync(parent);
      expect(directoryName).toMatch(new RegExp(`^checkpoints-${process.pid}-[A-Za-z0-9]{6}$`, 'u'));
      const directory = join(parent, directoryName!);
      const preImage = join(directory, 'session_1/turn-0001/files/000001.content');
      const manifest = join(directory, 'session_1/turn-0001/manifest.json');
      expect(readFileSync(preImage, 'utf8')).toBe(`before ${CANARY}`);
      expect(readFileSync(manifest, 'utf8')).toContain(CANARY);
      expect([parent, directory, join(directory, 'session_1')].map(mode)).toEqual([
        0o700, 0o700, 0o700,
      ]);
      expect([preImage, manifest].map(mode)).toEqual([0o600, 0o600]);
      expect(store.list('session_1')).toEqual([expect.objectContaining({ fileCount: 1 })]);
    },
  );

  it('share one directory across the stores a run builds, since each is keyed by its session', async () => {
    const { productRuntime, createStore } = await compositionFor({ ephemeral: true });

    const first = createStore();
    const second = createStore();
    await first.beginTurn({ sessionId: 'session_1', prompt: 'one' });
    await first.finalizeTurn();
    await second.beginTurn({ sessionId: 'session_2', prompt: 'two' });
    await second.finalizeTurn();

    const [only, ...others] = readdirSync(productRuntime.layout.userPaths.ephemeralCheckpoints);
    expect(others).toEqual([]);
    expect(
      readdirSync(join(productRuntime.layout.userPaths.ephemeralCheckpoints, only!))
        .filter((name) => name !== PROCESS_OWNER_RECORD_NAME)
        .sort(),
    ).toEqual(['session_1', 'session_2']);
  });

  it('are removed when the run ends', async () => {
    const { productRuntime, createStore } = await compositionFor({ ephemeral: true });
    const store = createStore();
    await store.beginTurn({ sessionId: 'session_1', prompt: `rewrite notes ${CANARY}` });
    await store.finalizeTurn();
    const parent = productRuntime.layout.userPaths.ephemeralCheckpoints;
    expect(readdirSync(parent)).toHaveLength(1);

    // What every ending runs: exit, the handled signals, and the crash policy before it rethrows.
    runProcessEndNow();

    expect(readdirSync(parent)).toEqual([]);
  });

  it('create nothing until the first store is built', async () => {
    const { productRuntime, createStore } = await compositionFor({ ephemeral: true });

    expect(existsSync(productRuntime.layout.userPaths.ephemeralCheckpoints)).toBe(false);
    createStore();

    expect(readdirSync(productRuntime.layout.userPaths.ephemeralCheckpoints)).toHaveLength(1);
  });

  // Writing under the project is Linux-only, so the project directory is only reachable there.
  it.runIf(process.platform === 'linux')(
    'are the project directory’s without the flag, which is what the flag changes',
    async () => {
      const { project, productRuntime, createStore } = await compositionFor({ ephemeral: false });
      const store = createStore();

      await store.beginTurn({ sessionId: 'session_1', prompt: `rewrite notes ${CANARY}` });
      await store.captureFile(join(project, 'notes.txt'));
      await store.finalizeTurn();

      const projectCheckpoints = join(project, PROJECT_STATE_DIRECTORIES.checkpoints);
      expect(
        readFileSync(join(projectCheckpoints, 'session_1/turn-0001/manifest.json'), 'utf8'),
      ).toContain(CANARY);
      expect(existsSync(productRuntime.layout.userPaths.ephemeralCheckpoints)).toBe(false);
    },
  );
});
