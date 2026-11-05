import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const swap = vi.hoisted(() => ({ parent: '', moved: '', outside: '', phase: 0 }));
vi.mock('../../workspace-trust/node-project-state-directory.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../workspace-trust/node-project-state-directory.js')>();
  const fs = await import('node:fs');
  return {
    ...original,
    workspaceProjectStateDirectoryPath(...args: Parameters<typeof original.workspaceProjectStateDirectoryPath>) {
      if (swap.phase === 1) {
        const path = original.workspaceProjectStateDirectoryPath(...args);
        fs.renameSync(swap.parent, swap.moved);
        fs.symlinkSync(swap.outside, swap.parent);
        swap.phase = 2;
        return path;
      }
      if (swap.phase === 2) {
        fs.unlinkSync(swap.parent);
        fs.renameSync(swap.moved, swap.parent);
        swap.phase = 3;
      }
      return original.workspaceProjectStateDirectoryPath(...args);
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
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.runIf(process.platform === 'linux')('never creates or tightens a writer marker outside the trusted project when its parent is swapped and restored', async () => {
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
  let lease;
  try {
    lease = state.acquireTurn?.('session_1', 'test');
  } catch {
    // Refusal is acceptable; an outside mutation is not.
  } finally {
    lease?.release();
  }
  expect(lstatSync(outside).isDirectory()).toBe(true);
  expect(statSync(join(outside, '.writer')).mode & 0o777).toBe(0o755);
  expect(readdirSync(join(outside, '.writer'))).toEqual([]);
}, 30_000);
