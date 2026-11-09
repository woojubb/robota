/**
 * Authorship and claims in the PROJECT session store. The user's directory store has
 * the full set in agent-session; the two share one records core, and these prove the project adapter
 * routes through it — in particular that a claimed id is answered before the store's own replay-log
 * fallback, since a log carries no authorship and anyone of the same user can write one.
 *
 * A project write needs the Linux stable-root host, so the cases that write are Linux-only;
 * the read cases make their files by hand and run everywhere.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { loadSessionForUpdate } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProjectSessionStore } from '../interactive/node-session-stores.js';
import { createTrustedProjectAccessFixture } from '../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

import type { IArtifactSealerDouble } from '@robota-sdk/agent-core/testing';
import type {
  IInteractiveSessionRecord,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface/session';

const CANARY = 'CANARY-project-authorship-3a5c-owner';
const FORGED = 'CANARY-project-authorship-e41d-forged';
const LOGGED = 'CANARY-project-authorship-6b0f-logged';
const linux = process.platform === 'linux';

function record(id: string, text = CANARY): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-08-01T00:30:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

const envelopeOf = (value: IInteractiveSessionRecord): string =>
  JSON.stringify({ schemaVersion: 2, record: value }, null, 2);
const contextOf = (id: string) => ({ kind: 'session-record', id }) as const;

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'agent-project-authorship-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const snapshotOf = (id: string): string => join(cwd, '.agent', 'sessions', `${id}.json`);

async function storeWith(sealer: IArtifactSealerDouble | undefined) {
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return createProjectSessionStore(
    getWorkspaceProjectStateStorage(access.authority, 'sessions'),
    getWorkspaceProjectStateStorage(access.authority, 'session-logs'),
    { sealing: sealer === undefined ? 'plain' : { sealer } },
  );
}

/** A snapshot written by hand, sealed with the public side alone, or tagged as the owner's. */
function writeSnapshot(
  sealer: IArtifactSealerDouble,
  id: string,
  how: 'forged' | 'tagged',
  text: string,
): void {
  mkdirSync(join(cwd, '.agent', 'sessions'), { recursive: true });
  const envelope = Buffer.from(envelopeOf(record(id, text)));
  const plaintext =
    how === 'forged'
      ? envelope
      : Buffer.concat([
          Buffer.from(
            `robota-authorship/v1 ${Buffer.from(sealer.tagAuthorship(envelope, contextOf(id))).toString('base64url')}\n`,
          ),
          envelope,
        ]);
  const writer = how === 'forged' ? openTestWriteGrant(sealer.writeGrant()) : sealer;
  writeFileSync(snapshotOf(id), writer.sealBytes(plaintext, contextOf(id)));
}

/** A plain replay log with one user message, as any program of the same user can write one. */
function writeReplayLog(id: string): void {
  mkdirSync(join(cwd, '.agent', 'logs'), { recursive: true });
  const lines = [
    {
      schemaVersion: 1,
      timestamp: '2026-08-01T00:00:00.000Z',
      sessionId: id,
      event: 'session_init',
      cwd,
      provider: 'scripted',
      model: 'scripted',
      systemPrompt: '',
      systemPromptLength: 0,
      toolSchemas: [],
    },
    {
      schemaVersion: 1,
      timestamp: '2026-08-01T00:00:01.000Z',
      sessionId: id,
      event: 'history_mutation',
      mutation: 'append_message',
      index: 0,
      message: {
        id: 'u1',
        role: 'user',
        content: LOGGED,
        state: 'complete',
        timestamp: '2026-08-01T00:00:01.000Z',
      },
    },
  ];
  writeFileSync(
    join(cwd, '.agent', 'logs', `${id}.jsonl`),
    lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
  );
}

const contentOf = (outcome: TSessionLoadOutcome | undefined): string =>
  outcome?.status === 'valid' ? JSON.stringify(outcome.record.messages) : String(outcome?.status);

describe('authorship in the project store (any platform)', () => {
  it('is decided from the snapshot bytes: a tag that verifies, or unverified', async () => {
    const sealer = createTestArtifactSealer();
    writeSnapshot(sealer, 'sess_tagged', 'tagged', CANARY);
    writeSnapshot(sealer, 'sess_forged', 'forged', FORGED);
    const store = await storeWith(sealer);

    expect(store.load('sess_tagged')).toMatchObject({ status: 'valid', authorship: 'verified' });
    expect(store.load('sess_forged')).toMatchObject({ status: 'valid', authorship: 'unverified' });
    for (const { outcome } of store.list()) {
      expect(outcome).toMatchObject({ digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    }
  });

  it('is unverified, with no digest, for a session rebuilt from its replay log', async () => {
    writeReplayLog('sess_logged');
    const store = await storeWith(createTestArtifactSealer());

    const outcome = store.load('sess_logged');
    expect(outcome).toMatchObject({ status: 'valid', authorship: 'unverified' });
    expect(outcome).not.toHaveProperty('digest');
    expect(contentOf(outcome)).toContain(LOGGED);
    expect(store.list()[0]?.outcome).toMatchObject({ authorship: 'unverified' });
  });

  it('is absent from a store that seals nothing, which offers no authorship member', async () => {
    writeReplayLog('sess_logged');
    const store = await storeWith(undefined);

    expect(store.load('sess_logged')).not.toHaveProperty('authorship');
    expect(store.authorship).toBeUndefined();
  });
});

describe('a claimed id in the project store (any platform)', () => {
  it('is never rebuilt from a replay log when it was claimed fresh', async () => {
    writeReplayLog('sess_new');
    const store = await storeWith(createTestArtifactSealer());

    const claim = store.claim('sess_new', { fresh: true });
    expect(claim.outcome).toEqual({ status: 'missing' });
    expect(store.load('sess_new', { hold: true })).toEqual({ status: 'missing' });
    expect(store.load('sess_new')).toEqual({ status: 'missing' });
    expect(loadSessionForUpdate(store, 'sess_new')).toEqual({ status: 'missing' });

    claim.release();
    expect(contentOf(store.load('sess_new'))).toContain(LOGGED);
  });

  it('is answered from its held copy, not a forged replacement nor a log, once the snapshot is gone or swapped', async () => {
    const sealer = createTestArtifactSealer();
    writeSnapshot(sealer, 'sess_run', 'tagged', CANARY);
    const store = await storeWith(sealer);
    const claim = store.claim('sess_run');
    expect(claim.outcome).toMatchObject({ status: 'valid', authorship: 'verified' });

    writeSnapshot(sealer, 'sess_run', 'forged', FORGED);
    expect(loadSessionForUpdate(store, 'sess_run')).toEqual({
      status: 'locked',
      reason: 'changed',
    });
    expect(store.load('sess_run')).toMatchObject({ authorship: 'verified', diverged: true });
    expect(contentOf(store.load('sess_run'))).not.toContain(FORGED);

    rmSync(snapshotOf('sess_run'));
    writeReplayLog('sess_run');
    const reread = loadSessionForUpdate(store, 'sess_run');
    expect(reread).toMatchObject({ status: 'valid', diverged: true });
    expect(contentOf(reread)).toContain(CANARY);
    expect(contentOf(reread)).not.toContain(LOGGED);
  });
});

describe.runIf(linux)('saves in the project store', () => {
  it('tag an owner save, and tag one made while locked at the unlock', async () => {
    const sealer = createTestArtifactSealer();
    const store = await storeWith(sealer);
    store.save(record('sess_a'), { provenance: 'owner' });
    sealer.lock();
    store.save(record('sess_b'), { provenance: 'owner' });
    const lockedWrite = readFileSync(snapshotOf('sess_b'));
    sealer.unlock();

    const fresh = await storeWith(sealer);
    expect(fresh.load('sess_a')).toMatchObject({ authorship: 'verified' });
    expect(readFileSync(snapshotOf('sess_b')).equals(lockedWrite)).toBe(false);
    expect(fresh.load('sess_b')).toMatchObject({ authorship: 'verified' });
  });

  it('refuse a claimed id whose snapshot was replaced, and leave the replacement', async () => {
    const sealer = createTestArtifactSealer();
    const store = await storeWith(sealer);
    const claim = store.claim('sess_run', { fresh: true });
    store.save(record('sess_run'), { claim, provenance: 'owner' });
    writeSnapshot(sealer, 'sess_run', 'forged', FORGED);
    const planted = readFileSync(snapshotOf('sess_run'));

    expect(() => store.save(record('sess_run', 'the next turn'), { claim })).toThrow(
      expect.objectContaining({ reason: 'changed' }),
    );
    expect(readFileSync(snapshotOf('sess_run')).equals(planted)).toBe(true);
  });

  it('adopt a record by the digest of its bytes', async () => {
    const sealer = createTestArtifactSealer();
    writeSnapshot(sealer, 'sess_a', 'forged', CANARY);
    const store = await storeWith(sealer);
    const shown = store.load('sess_a', { hold: true }) as { digest: string };

    expect(store.authorship?.adopt('sess_a', shown.digest)).toBe('adopted');
    expect((await storeWith(sealer)).load('sess_a')).toMatchObject({ authorship: 'verified' });
  });
});
