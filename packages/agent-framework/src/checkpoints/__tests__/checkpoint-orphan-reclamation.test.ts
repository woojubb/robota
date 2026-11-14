/**
 * Reclaiming the turn directories a stopped checkpoint writer left, over state kept in a directory
 * with a recording removal, so the rule is checked on every platform. The same behaviour on the real
 * Linux project boundary is in `checkpoint-orphan-reclamation-linux.test.ts`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeCanonicalTempDir } from '../../testing/canonical-temp-dir.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';
import {
  ORPHAN_REMOVAL_ATTEMPTS,
  reclaimOrphanTurns,
} from '../edit-checkpoint-orphan-reclamation.js';
import {
  createDirectoryEditCheckpointState,
  type IEditCheckpointStateStorage,
} from '../edit-checkpoint-state-storage.js';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';

import type {
  IWorkspaceDirectoryEntry,
  TWorkspaceDirectoryRemoval,
} from '../../workspace-trust/index.js';
import type { IProcessMarkerHandle, TArtifactSealing } from '@robota-sdk/agent-core';

const SESSION = 'session_1';
const SIBLING = 'session_2';

let base: string;
let project: string;
let stateRoot: string;

beforeEach(() => {
  base = makeCanonicalTempDir('checkpoint-orphans-');
  project = join(base, 'project');
  stateRoot = join(base, 'state');
  mkdirSync(project);
  writeFileSync(join(project, 'a.txt'), 'original A');
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

type TRemove = (relativePath: string) => TWorkspaceDirectoryRemoval;

/** Directory state whose removal records each call and removes as `answer` says (default: removes). */
function removableState(answer?: TRemove): {
  state: IEditCheckpointStateStorage;
  removals: string[];
} {
  const inner = createDirectoryEditCheckpointState(stateRoot);
  const removals: string[] = [];
  const state = Object.create(inner) as IEditCheckpointStateStorage;
  Object.assign(state, {
    removeDirectory: (relativePath: string): TWorkspaceDirectoryRemoval => {
      removals.push(relativePath);
      if (answer !== undefined) return answer(relativePath);
      rmSync(join(stateRoot, relativePath), { recursive: true, force: true });
      return { status: 'removed' };
    },
  });
  return { state, removals };
}

async function storeOver(
  state: IEditCheckpointStateStorage,
  sealing: TArtifactSealing = 'plain',
  keysLocked?: () => boolean,
): Promise<EditCheckpointStore> {
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'checkpoint orphan reclamation test',
    }),
    stateStorage: state,
    sealing,
    ...(keysLocked === undefined ? {} : { keysLocked }),
  });
}

/** One finished checkpoint of `sessionId`, with a captured pre-image and a manifest. */
async function finishedTurn(store: EditCheckpointStore, sessionId = SESSION): Promise<string> {
  const turn = await store.beginTurn({ sessionId, prompt: 'edit a' });
  await store.captureFile(join(project, 'a.txt'));
  await store.finalizeTurn();
  return turn.id;
}

/** A turn directory as a writer that stopped before finalizing leaves it. */
function abandonedTurn(sessionId: string, id: string, preimage?: string): string {
  const dir = join(stateRoot, sessionId, id);
  mkdirSync(dir, { recursive: true });
  if (preimage !== undefined) {
    mkdirSync(join(dir, 'files'));
    writeFileSync(join(dir, 'files', '000001.content'), preimage);
  }
  return dir;
}

const at = (...segments: string[]): string => join(stateRoot, ...segments);

describe('orphan reclamation at the first turn of a session', () => {
  it('removes manifest-less turn directories and keeps every checkpoint, name and session beside them', async () => {
    const { state, removals } = removableState();
    expect(await finishedTurn(await storeOver(state))).toBe('turn-0001');
    abandonedTurn(SESSION, 'turn-0002');
    abandonedTurn(SESSION, 'turn-0003', 'captured but never named');
    writeFileSync(join(abandonedTurn(SESSION, 'turn-0004'), 'manifest.json'), '{ not json');
    abandonedTurn(SESSION, 'turn-00005');
    abandonedTurn(SESSION, 'notes');
    writeFileSync(at(SESSION, 'turn-0009'), 'a file under a turn name');
    abandonedTurn(SIBLING, 'turn-0001', 'another session');

    const store = await storeOver(state);
    const claimed = await store.beginTurn({ sessionId: SESSION, prompt: 'next' });

    expect(removals.sort()).toEqual([join(SESSION, 'turn-0002'), join(SESSION, 'turn-0003')]);
    // The reclaimed number is free again: no manifest named it, so nothing can point at it.
    expect(claimed.id).toBe('turn-0002');
    expect(readdirSync(at(SESSION, 'turn-0002'))).toEqual([]);
    expect(existsSync(at(SESSION, 'turn-0003'))).toBe(false);
    expect(existsSync(at(SESSION, 'turn-0001', 'manifest.json'))).toBe(true);
    expect(readFileSync(at(SESSION, 'turn-0004', 'manifest.json'), 'utf8')).toBe('{ not json');
    expect(existsSync(at(SESSION, 'turn-00005'))).toBe(true);
    expect(existsSync(at(SESSION, 'notes'))).toBe(true);
    expect(readFileSync(at(SESSION, 'turn-0009'), 'utf8')).toBe('a file under a turn name');
    expect(existsSync(at(SESSION, '.writer', 'active.guard'))).toBe(true);
    expect(readFileSync(at(SIBLING, 'turn-0001', 'files', '000001.content'), 'utf8')).toBe(
      'another session',
    );
    await store.finalizeTurn();
  });

  it('keeps a sealed checkpoint whose keys cannot open it, judging by its name alone', async () => {
    const { state, removals } = removableState();
    await finishedTurn(await storeOver(state, { sealer: createTestArtifactSealer() }));
    abandonedTurn(SESSION, 'turn-0002');
    const locked = createTestArtifactSealer({ locked: true });

    const store = await storeOver(state, { sealer: locked }, () => true);
    const claimed = await store.beginTurn({ sessionId: SESSION, prompt: 'next' });

    expect(removals).toEqual([join(SESSION, 'turn-0002')]);
    expect(claimed.id).toBe('turn-0002');
    expect(readdirSync(at(SESSION, 'turn-0001')).sort()).toEqual(['files', 'manifest.json']);
  });

  it('runs once per session per store: a later orphan waits for another store', async () => {
    const { state, removals } = removableState();
    const store = await storeOver(state);
    await finishedTurn(store);
    abandonedTurn(SESSION, 'turn-0007');
    await finishedTurn(store);
    expect(removals).toEqual([]);
    expect(existsSync(at(SESSION, 'turn-0007'))).toBe(true);

    await finishedTurn(store, SIBLING);
    expect(removals).toEqual([]);

    await finishedTurn(await storeOver(state));
    expect(removals).toEqual([join(SESSION, 'turn-0007')]);
  });

  it('touches nothing while another writer holds the lease, and reclaims once it may', async () => {
    const { state, removals } = removableState();
    const writer = await storeOver(state);
    const live = await writer.beginTurn({ sessionId: SESSION, prompt: 'live' });
    await writer.captureFile(join(project, 'a.txt'));
    const other = await storeOver(state);

    await expect(other.beginTurn({ sessionId: SESSION, prompt: 'blocked' })).rejects.toThrow(
      'Another checkpoint writer',
    );
    expect(removals).toEqual([]);
    expect(readdirSync(at(SESSION, live.id))).toEqual(['files']);

    await writer.finalizeTurn();
    abandonedTurn(SESSION, 'turn-0005');
    await finishedTurn(other);
    expect(removals).toEqual([join(SESSION, 'turn-0005')]);
    expect(existsSync(at(SESSION, live.id, 'manifest.json'))).toBe(true);
  });

  it('retries a partial removal a bounded number of times, then leaves it and starts the turn', async () => {
    const { state, removals } = removableState(() => ({ status: 'partial', reason: 'concurrent' }));
    abandonedTurn(SESSION, 'turn-0001');

    const claimed = await (await storeOver(state)).beginTurn({ sessionId: SESSION, prompt: 'x' });

    expect(removals).toEqual(Array(ORPHAN_REMOVAL_ATTEMPTS).fill(join(SESSION, 'turn-0001')));
    expect(existsSync(at(SESSION, 'turn-0001'))).toBe(true);
    expect(claimed.id).toBe('turn-0002');
  });

  it('never fails the turn when a removal throws', async () => {
    const { state, removals } = removableState(() => {
      throw new Error('injected removal failure');
    });
    abandonedTurn(SESSION, 'turn-0001');
    abandonedTurn(SESSION, 'turn-0002');

    const claimed = await (await storeOver(state)).beginTurn({ sessionId: SESSION, prompt: 'x' });

    expect(removals).toHaveLength(1);
    expect(claimed.id).toBe('turn-0003');
  });

  it('leaves everything as it is on state that cannot remove directories', async () => {
    abandonedTurn(SESSION, 'turn-0001');
    abandonedTurn(SIBLING, 'turn-0001');
    const plain = createDirectoryEditCheckpointState(stateRoot);
    expect(plain.removeDirectory).toBeUndefined();

    const claimed = await (await storeOver(plain)).beginTurn({ sessionId: SESSION, prompt: 'x' });
    const sealed = await storeOver(createDirectoryEditCheckpointState(stateRoot), {
      sealer: createTestArtifactSealer(),
    });
    const next = await sealed.beginTurn({ sessionId: SIBLING, prompt: 'y' });

    expect(claimed.id).toBe('turn-0002');
    expect(next.id).toBe('turn-0002');
    expect(existsSync(at(SESSION, 'turn-0001'))).toBe(true);
    expect(existsSync(at(SIBLING, 'turn-0001'))).toBe(true);
  });
});

describe('reclaimOrphanTurns', () => {
  const lease = (status: 'ran' | 'lost' | 'busy' = 'ran'): IProcessMarkerHandle => ({
    holds: () => true,
    withGuard: <T>(operation: () => T) =>
      status === 'ran' ? { status, value: operation() } : { status },
    release: () => {},
  });

  /** A listing-only state: `turns` maps each turn name to its kind and its entries (or a refusal). */
  function listedState(
    turns: Record<string, { kind?: IWorkspaceDirectoryEntry['kind']; entries: unknown }>,
  ): { state: IEditCheckpointStateStorage; remove: ReturnType<typeof vi.fn> } {
    const remove = vi.fn(() => ({ status: 'removed' as const }));
    const fail = (): never => {
      throw new Error('not used');
    };
    const state: IEditCheckpointStateStorage = {
      readText: fail,
      readBytes: fail,
      writeText: fail,
      writeBytes: fail,
      replaceBytes: fail,
      removeDirectory: remove,
      listDirectory: (path) => {
        if (path === 's') {
          return Object.entries(turns).map(([name, turn]) => ({
            name,
            kind: turn.kind ?? 'directory',
          }));
        }
        const turn = turns[path.slice(2)];
        if (turn?.entries instanceof Error) throw turn.entries;
        return turn?.entries as IWorkspaceDirectoryEntry[];
      },
    };
    return { state, remove };
  }

  it('keeps a turn whose manifest name is any kind of entry, or whose listing is refused', () => {
    const { state, remove } = listedState({
      'turn-0001': { entries: [{ name: 'manifest.json', kind: 'link' }] },
      'turn-0002': { entries: [{ name: 'manifest.json', kind: 'other' }] },
      'turn-0003': { entries: [{ name: 'manifest.json', kind: 'directory' }] },
      'turn-0004': { entries: new Error('refused') },
      'turn-0005': { entries: [{ name: 'files', kind: 'directory' }] },
      'turn-0006': { kind: 'link', entries: [] },
      'turn-0007': { kind: 'other', entries: [] },
    });

    reclaimOrphanTurns(state, 's', lease());

    expect(remove.mock.calls.map(([path]) => path)).toEqual([join('s', 'turn-0005')]);
  });

  it('stops at once when the lease guard does not run the removal', () => {
    for (const status of ['lost', 'busy'] as const) {
      const { state, remove } = listedState({
        'turn-0001': { entries: [] },
        'turn-0002': { entries: [] },
      });
      reclaimOrphanTurns(state, 's', lease(status));
      expect(remove).not.toHaveBeenCalled();
    }
  });

  it('stops removing once its time is spent', () => {
    const { state, remove } = listedState({
      'turn-0001': { entries: [] },
      'turn-0002': { entries: [] },
    });
    let clock = 0;
    remove.mockImplementation(() => {
      clock += 5_000;
      return { status: 'removed' as const };
    });

    reclaimOrphanTurns(state, 's', lease(), () => clock);

    expect(remove).toHaveBeenCalledOnce();
  });
});
