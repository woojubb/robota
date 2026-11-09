import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const swap = vi.hoisted(() => ({
  parent: '',
  moved: '',
  outside: '',
  phase: 0,
  markerPublished: false,
}));

vi.mock('@robota-sdk/agent-core/node', async (importOriginal) => {
  const original = await importOriginal<typeof import('@robota-sdk/agent-core/node')>();
  const fs = await import('node:fs');
  const path = await import('node:path');
  const wrap = (markers: ReturnType<typeof original.createProcessMarkers>): typeof markers => ({
    ...markers,
    acquire(...args: Parameters<typeof markers.acquire>) {
      if (swap.phase !== 1) throw new Error('The marker publication was not armed.');
      fs.renameSync(swap.parent, swap.moved);
      fs.symlinkSync(swap.outside, swap.parent);
      swap.phase = 2;
      try {
        const result = markers.acquire(...args);
        const originalMarkerDir = path.join(swap.moved, '.writer');
        const outsideMarkerDir = path.join(swap.outside, '.writer');
        swap.markerPublished = [originalMarkerDir, outsideMarkerDir].some((directory) =>
          fs.readdirSync(directory).some((name) => name.endsWith('.owner')),
        );
        return result;
      } finally {
        fs.unlinkSync(swap.parent);
        fs.renameSync(swap.moved, swap.parent);
        swap.phase = 3;
      }
    },
  });
  return {
    ...original,
    createProcessMarkers(...args: Parameters<typeof original.createProcessMarkers>) {
      return wrap(original.createProcessMarkers(...args));
    },
    createProcessMarkersInOpenDirectory(
      ...args: Parameters<typeof original.createProcessMarkersInOpenDirectory>
    ) {
      return wrap(original.createProcessMarkersInOpenDirectory(...args));
    },
  };
});

import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectStateStorage } from '../../workspace-trust/index.js';
import { createProjectEditCheckpointState } from '../edit-checkpoint-state-storage.js';

const roots: string[] = [];
afterEach(() => {
  if (swap.phase === 2) {
    unlinkSync(swap.parent);
    renameSync(swap.moved, swap.parent);
  }
  swap.phase = 0;
  swap.markerPublished = false;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.runIf(process.platform === 'linux')(
  'never publishes a writer marker outside the trusted project when its parent is swapped and restored',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-marker-root-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'checkpoint-marker-outside-')));
    roots.push(root, outside);
    const session = join(root, '.agent', 'checkpoints', 'session_1');
    mkdirSync(session, { recursive: true });
    mkdirSync(join(outside, '.writer'));
    chmodSync(join(outside, '.writer'), 0o755);
    const access = await createTrustedProjectAccessFixture(root);
    if (access.status !== 'trusted') throw new Error('fixture trust missing');
    const storage = getWorkspaceProjectStateStorage(access.authority, 'checkpoints');
    const state = createProjectEditCheckpointState(storage);
    swap.parent = session;
    swap.moved = `${session}-moved`;
    swap.outside = outside;
    swap.phase = 1;
    const lease = state.acquireTurn?.('session_1', 'test');
    expect(swap.phase).toBe(3);
    expect(swap.markerPublished).toBe(true);
    expect(lstatSync(outside).isDirectory()).toBe(true);
    expect(statSync(join(outside, '.writer')).mode & 0o777).toBe(0o755);
    expect(readdirSync(join(outside, '.writer'))).toEqual([]);
    expect(lease?.holds()).toBe(true);
    lease?.release();
  },
  30_000,
);
