import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';
import { EditCheckpointStore } from '../edit-checkpoint-store';

const MARKER = 'TOP-SECRET-CONTENTS-abc123';

/** Every file under `dir` whose bytes contain the marker — i.e. what leaked into the sandbox. */
function leakedInto(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        try {
          if (readFileSync(p, 'utf8').includes(MARKER)) found.push(p);
        } catch {
          /* unreadable entries cannot carry the marker onward */
        }
      }
    }
  };
  walk(dir);
  return found;
}

function scratch() {
  const base = mkdtempSync(join(tmpdir(), 'checkpoint-containment-'));
  const sandbox = join(base, 'sandbox');
  const outside = join(base, 'outside');
  mkdirSync(sandbox, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'secret.txt'), MARKER);
  return { base, sandbox, outside };
}

async function createStore(cwd: string): Promise<EditCheckpointStore> {
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'checkpoint containment test',
    }),
  });
}

describe('EditCheckpointStore.captureFile containment', () => {
  // captureFile runs BEFORE the contained tool refuses, so without containment the snapshot IS the
  // read the sandbox denied: the bytes land inside the working directory and stay there for a later
  // in-sandbox Read. Proven end-to-end before the fix.
  it('does not pull a file outside the working directory into the sandbox', async () => {
    const { sandbox, outside } = scratch();
    const store = await createStore(sandbox);
    await store.beginTurn({ sessionId: 's1', prompt: 'p' });
    await store.captureFile(join(outside, 'secret.txt'));
    await store.finalizeTurn();

    expect(leakedInto(join(sandbox, '.robota'))).toEqual([]);
  });

  // Containment is decided on the canonical path, so a symlink planted inside the tree cannot be
  // used to walk out of it.
  it('does not follow a symlink out of the working directory', async () => {
    const { sandbox, outside } = scratch();
    const link = join(sandbox, 'link-to-secret.txt');
    symlinkSync(join(outside, 'secret.txt'), link);

    const store = await createStore(sandbox);
    await store.beginTurn({ sessionId: 's2', prompt: 'p' });
    await store.captureFile(link);
    await store.finalizeTurn();

    expect(leakedInto(join(sandbox, '.robota'))).toEqual([]);
  });

  // The guard must not break what checkpoints are for: an in-sandbox file still gets its snapshot,
  // otherwise a restore point silently stops existing and the fix costs more than the hole.
  it('still snapshots a file inside the working directory', async () => {
    const { sandbox } = scratch();
    const target = join(sandbox, 'tracked.txt');
    writeFileSync(target, MARKER);

    const store = await createStore(sandbox);
    await store.beginTurn({ sessionId: 's3', prompt: 'p' });
    await store.captureFile(target);
    await store.finalizeTurn();

    expect(leakedInto(join(sandbox, '.robota')).length).toBeGreaterThan(0);
  });
});
