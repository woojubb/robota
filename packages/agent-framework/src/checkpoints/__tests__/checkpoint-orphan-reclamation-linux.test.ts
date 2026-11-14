/**
 * Reclaiming the turn directories a stopped checkpoint writer left, on the real project boundary,
 * which removes project state only on Linux. The rule itself is checked on every platform in
 * `checkpoint-orphan-reclamation.test.ts`.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { makeCanonicalTempDir } from '../../testing/canonical-temp-dir.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';

import type { IArtifactSealer } from '@robota-sdk/agent-core';

const SESSION = 'session_1';
const SIBLING = 'session_2';

let scratch: string;
let project: string;
let state: string;

beforeEach(() => {
  scratch = makeCanonicalTempDir('checkpoint-orphans-linux-');
  project = join(scratch, 'project');
  state = join(project, '.agent', 'checkpoints');
  mkdirSync(project);
  writeFileSync(join(project, 'a.txt'), 'original A');
  mkdirSync(join(scratch, 'outside'));
  writeFileSync(join(scratch, 'outside', 'canary.txt'), 'CANARY');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

async function sealedStore(sealer: IArtifactSealer, locked = false): Promise<EditCheckpointStore> {
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'checkpoint orphan reclamation test',
    }),
    sealing: { sealer },
    keysLocked: () => locked,
  });
}

/** Claims the session's next turn in a contender process, then kills it before it finalizes. */
async function crashedWriter(): Promise<string> {
  const fixture = fileURLToPath(new URL('./fixtures/checkpoint-contender.ts', import.meta.url));
  const tsx = createRequire(import.meta.url).resolve('tsx');
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', tsx, '--conditions=source', fixture, project, state, 'a.txt', 'project'],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
  );
  try {
    const message = await new Promise<{ type: string; id?: string; message?: string }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`contender exited early: ${code}`)));
        child.once('message', (value) => resolve(value as { type: string; id?: string }));
      },
    );
    if (message.type !== 'ready' || message.id === undefined) {
      throw new Error(`contender did not claim a turn: ${message.message ?? message.type}`);
    }
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    return message.id;
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

const at = (...segments: string[]): string => join(state, ...segments);

it.runIf(process.platform === 'linux')(
  'reclaims what a crashed writer left and nothing else, following no planted link',
  async () => {
    const writer = await sealedStore(createTestArtifactSealer());
    await writer.beginTurn({ sessionId: SESSION, prompt: 'first' });
    await writer.captureFile(join(project, 'a.txt'));
    await writer.finalizeTurn();
    expect(await crashedWriter()).toBe('turn-0002');
    expect(readdirSync(at(SESSION, 'turn-0002'))).toEqual([]);
    mkdirSync(at(SESSION, 'turn-0003', 'files'), { recursive: true });
    writeFileSync(at(SESSION, 'turn-0003', 'files', '000001.content'), 'never named');
    mkdirSync(at(SESSION, 'turn-0004'));
    writeFileSync(at(SESSION, 'turn-0004', 'manifest.json'), 'not a sealed manifest');
    symlinkSync(join(scratch, 'outside'), at(SESSION, 'turn-0007'));
    execFileSync('mkfifo', [at(SESSION, 'turn-0008')]);
    mkdirSync(at(SIBLING, 'turn-0001'), { recursive: true });

    // Keys that cannot open anything: deciding what is an orphan reads no manifest.
    const store = await sealedStore(createTestArtifactSealer({ locked: true }), true);
    const claimed = await store.beginTurn({ sessionId: SESSION, prompt: 'next' });

    expect(claimed.id).toBe('turn-0005');
    expect(readdirSync(at(SESSION)).sort()).toEqual([
      '.writer',
      'turn-0001',
      'turn-0004',
      'turn-0005',
      'turn-0007',
      'turn-0008',
    ]);
    expect(readdirSync(at(SESSION, 'turn-0001')).sort()).toEqual(['files', 'manifest.json']);
    expect(readFileSync(at(SESSION, 'turn-0004', 'manifest.json'), 'utf8')).toBe(
      'not a sealed manifest',
    );
    expect(lstatSync(at(SESSION, 'turn-0007')).isSymbolicLink()).toBe(true);
    expect(lstatSync(at(SESSION, 'turn-0008')).isFIFO()).toBe(true);
    expect(readFileSync(join(scratch, 'outside', 'canary.txt'), 'utf8')).toBe('CANARY');
    expect(existsSync(at(SESSION, '.writer', 'active.guard'))).toBe(true);
    expect(existsSync(at(SIBLING, 'turn-0001'))).toBe(true);
  },
  30_000,
);

it.runIf(process.platform === 'linux')(
  'gives a crashed claim with the highest number back to the next turn',
  async () => {
    expect(await crashedWriter()).toBe('turn-0001');
    mkdirSync(at(SESSION, 'turn-0001', 'files'));
    writeFileSync(at(SESSION, 'turn-0001', 'files', '000001.content'), 'stale pre-image');

    const store = await sealedStore(createTestArtifactSealer());
    const claimed = await store.beginTurn({ sessionId: SESSION, prompt: 'next' });
    await store.captureFile(join(project, 'a.txt'));
    await store.finalizeTurn();

    expect(claimed.id).toBe('turn-0001');
    expect(store.list(SESSION).map((checkpoint) => checkpoint.id)).toEqual(['turn-0001']);
    expect(readFileSync(at(SESSION, 'turn-0001', 'files', '000001.content'))).not.toEqual(
      Buffer.from('stale pre-image'),
    );
  },
  30_000,
);
