/**
 * Claims and adoption of sealed session records.
 *
 * A session this process runs claims its id, and a claimed id is answered only from content the
 * owner wrote: a file something unverifiable changed is never handed to a writer (so it is never
 * merged into the session) and never overwritten by it (so the other writer's work survives). A claim
 * is exclusive, ended only by its own release, and fences every save made under it after that.
 * Adoption is the one way to raise a record to the owner's, bound to the digest of its exact bytes.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { loadSessionForUpdate } from '../load-session-for-update.js';
import { isSessionClaimedError } from '../session-claims.js';
import { SESSION_RECORD_ENVELOPE_VERSION } from '../session-record-codec/index.js';
import { NodeSessionStore } from '../session-store.js';
import { isSealedSessionUnreadableError } from '../sealed-session-refusal.js';

import type { IArtifactSealerDouble } from '@robota-sdk/agent-core/testing';
import type {
  IInteractiveSessionRecord,
  ISessionClaim,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface/session';

const CANARY = 'CANARY-claims-0b7f-owner-text';
const FORGED = 'CANARY-claims-77ac-forged-text';
const HEADER = /^robota-authorship\/v1 [A-Za-z0-9_-]{43}\n/;

function newStoreDir(): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), 'claims-store-')));
}

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

function envelopeOf(value: IInteractiveSessionRecord): string {
  return JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record: value }, null, 2);
}

const fileOf = (dir: string, id: string): string => path.join(dir, `${id}.json`);
const contextOf = (id: string) => ({ kind: 'session-record', id }) as const;
const digestOfFile = (dir: string, id: string): string =>
  createHash('sha256')
    .update(readFileSync(fileOf(dir, id)))
    .digest('hex');

function storeOf(dir: string, sealer: IArtifactSealerDouble): NodeSessionStore {
  return new NodeSessionStore(dir, { sealing: { sealer } });
}

function claimOf(store: NodeSessionStore, id: string, fresh?: true): ISessionClaim {
  return store.claim(id, fresh ? { fresh } : undefined);
}

function plaintextOf(dir: string, id: string, sealer: IArtifactSealerDouble): string {
  return Buffer.from(sealer.openBytes(readFileSync(fileOf(dir, id)), contextOf(id))).toString(
    'utf8',
  );
}

function authorshipSeenFresh(dir: string, id: string, sealer: IArtifactSealerDouble): unknown {
  const outcome = storeOf(dir, sealer).load(id);
  return outcome.status === 'valid' ? outcome.authorship : outcome.status;
}

function forge(dir: string, id: string, sealer: IArtifactSealerDouble, text = FORGED): void {
  const writeOnly = openTestWriteGrant(sealer.writeGrant());
  writeFileSync(
    fileOf(dir, id),
    writeOnly.sealBytes(Buffer.from(envelopeOf(record(id, text))), contextOf(id)),
  );
}

function contentOf(outcome: TSessionLoadOutcome | undefined): string {
  return outcome?.status === 'valid'
    ? JSON.stringify(outcome.record.messages)
    : String(outcome?.status);
}

function thrownBy(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

/**
 * `value` saved by another of the owner's processes over session `id`'s file, past this store's writer
 * marker: what a process that keeps no marker (an older build) or a same-user program could write.
 */
function savedElsewhere(
  dir: string,
  sealer: IArtifactSealerDouble,
  value: IInteractiveSessionRecord,
): void {
  const elsewhere = newStoreDir();
  storeOf(elsewhere, sealer).save(value, { provenance: 'owner' });
  writeFileSync(fileOf(dir, value.id), readFileSync(fileOf(elsewhere, value.id)));
}

/** A running session: claimed fresh and saved once as the owner's. */
function runningSession(dir: string, sealer: IArtifactSealerDouble, id = 'sess_run') {
  const store = storeOf(dir, sealer);
  const claim = claimOf(store, id, true);
  store.save(record(id), { claim, provenance: 'owner' });
  return { store, claim };
}

describe('a claimed id whose file something unverifiable replaced', () => {
  it('is refused to writers, shown to probes as the held copy, and never overwritten', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const { store, claim } = runningSession(dir, sealer);
    forge(dir, 'sess_run', sealer);
    const planted = readFileSync(fileOf(dir, 'sess_run'));

    expect(store.load('sess_run', { hold: true })).toEqual({ status: 'locked', reason: 'changed' });
    expect(loadSessionForUpdate(store, 'sess_run')).toEqual({
      status: 'locked',
      reason: 'changed',
    });
    expect(store.loadHeld?.('sess_run')).toEqual({ status: 'locked', reason: 'changed' });
    for (const probe of [store.load('sess_run'), store.list()[0]?.outcome]) {
      expect(probe).toMatchObject({ status: 'valid', authorship: 'verified', diverged: true });
      expect(contentOf(probe)).toContain(CANARY);
      expect(contentOf(probe)).not.toContain(FORGED);
    }
    const refusal = thrownBy(() => store.save(record('sess_run', 'the next turn'), { claim }));
    expect(isSealedSessionUnreadableError(refusal)).toBe(true);
    expect((refusal as { reason?: unknown }).reason).toBe('changed');
    expect(readFileSync(fileOf(dir, 'sess_run')).equals(planted)).toBe(true);
  });

  it('is refused the same way when the replacement is a plain file', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const { store, claim } = runningSession(dir, sealer);
    writeFileSync(fileOf(dir, 'sess_run'), envelopeOf(record('sess_run', FORGED)));

    expect(loadSessionForUpdate(store, 'sess_run')).toEqual({
      status: 'locked',
      reason: 'changed',
    });
    expect(() => store.save(record('sess_run'), { claim })).toThrow(/changed on disk/);
    expect(readFileSync(fileOf(dir, 'sess_run'), 'utf8')).toContain(FORGED);
  });

  it('is locked with no reason, not changed, while only the locked keys stand in the way', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const { store, claim } = runningSession(dir, sealer);
    // Another of the owner's processes saved the session; while locked it cannot be shown to be theirs.
    savedElsewhere(dir, sealer, record('sess_run', 'saved elsewhere'));
    sealer.lock();

    expect(store.load('sess_run', { hold: true })).toEqual({ status: 'locked' });
    expect(loadSessionForUpdate(store, 'sess_run')).toEqual({ status: 'locked' });
    const refusal = thrownBy(() => store.save(record('sess_run'), { claim }));
    expect((refusal as { reason?: unknown }).reason).toBe('locked');

    sealer.unlock();
    expect(contentOf(loadSessionForUpdate(store, 'sess_run'))).toContain('saved elsewhere');
    expect(() => store.save(record('sess_run', 'saving resumes'), { claim })).not.toThrow();
  });

  it('takes a file another of the owner’s unlocked processes wrote, whose tag verifies', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const { store, claim } = runningSession(dir, sealer);
    savedElsewhere(dir, sealer, record('sess_run', 'saved elsewhere'));

    expect(loadSessionForUpdate(store, 'sess_run')).toMatchObject({
      status: 'valid',
      authorship: 'verified',
    });
    store.save(record('sess_run', 'the next turn'), { claim });
    expect(authorshipSeenFresh(dir, 'sess_run', sealer)).toBe('verified');
  });

  it('is answered with the held copy when the file is gone, and a fresh claim with nothing written is missing', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const { store } = runningSession(dir, sealer);
    unlinkSync(fileOf(dir, 'sess_run'));
    const fresh = claimOf(store, 'sess_new', true);

    expect(loadSessionForUpdate(store, 'sess_run')).toMatchObject({
      status: 'valid',
      diverged: true,
    });
    expect(fresh.outcome).toEqual({ status: 'missing' });
    expect(store.load('sess_new', { hold: true })).toEqual({ status: 'missing' });
  });
});

describe('claims', () => {
  it('are offered by every store, sealing or not', () => {
    expect(new NodeSessionStore(newStoreDir(), { sealing: 'plain' }).claim).toBeTypeOf('function');
    expect(storeOf(newStoreDir(), createTestArtifactSealer()).claim).toBeTypeOf('function');
  });

  it('read the record as the hold read the session restores from', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    storeOf(dir, sealer).save(record('sess_a'), { provenance: 'owner' });
    forge(dir, 'sess_b', sealer);
    const store = storeOf(dir, sealer);

    expect(claimOf(store, 'sess_a').outcome).toMatchObject({
      status: 'valid',
      authorship: 'verified',
    });
    const unverified = claimOf(store, 'sess_b').outcome;
    expect(unverified).toMatchObject({ status: 'valid', authorship: 'unverified' });
    expect(contentOf(unverified)).toContain(FORGED);
  });

  it('are exclusive, with a code and fixed text', () => {
    const store = storeOf(newStoreDir(), createTestArtifactSealer());
    claimOf(store, 'sess_a', true);

    const error = thrownBy(() => claimOf(store, 'sess_a', true));
    expect(isSessionClaimedError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'SESSION_CLAIMED', reason: 'has_writer' });
    expect((error as Error).message).toBe(
      `Session sess_a is already open in this process (pid ${process.pid}): a session running or ` +
        'still closing here. Try again once that has ended.',
    );
  });

  it('end only by their own release, which a late repeat cannot turn on a later claim', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    const first = claimOf(store, 'sess_a', true);
    first.release();
    const second = claimOf(store, 'sess_a');
    first.release();

    expect(() => claimOf(store, 'sess_a')).toThrow(/already open in this process/);
    expect(() =>
      store.save(record('sess_a'), { claim: second, provenance: 'owner' }),
    ).not.toThrow();
    second.release();
    second.release();
    expect(() => claimOf(store, 'sess_a').release()).not.toThrow();
  });

  it('fence saves: a released claim and a missing one are refused', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    const stale = claimOf(store, 'sess_a', true);
    store.save(record('sess_a'), { claim: stale, provenance: 'owner' });
    stale.release();
    const current = claimOf(store, 'sess_a');
    const before = readFileSync(fileOf(dir, 'sess_a'));

    const fenced = thrownBy(() =>
      store.save(record('sess_a', 'from the old session'), { claim: stale }),
    );
    expect((fenced as { reason?: unknown }).reason).toBe('released');
    const tokenless = thrownBy(() => store.save(record('sess_a', 'from a one-shot writer')));
    expect((tokenless as { reason?: unknown }).reason).toBe('has_writer');
    const otherId = claimOf(store, 'sess_b', true);
    expect(() => store.save(record('sess_a'), { claim: otherId })).toThrow(
      /claim it was saved under/,
    );
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
    expect(() => store.save(record('sess_a', 'the next turn'), { claim: current })).not.toThrow();
  });

  it('keep their entries through eviction pressure, unlike a session no one runs', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    const claim = claimOf(store, 'sess_claimed', true);
    store.save(record('sess_claimed'), { claim, provenance: 'owner' });
    store.save(record('sess_unclaimed'), { provenance: 'owner' });
    for (let index = 0; index < 40; index += 1) store.save(record(`sess_other_${index}`));
    sealer.lock();

    expect(store.loadHeld?.('sess_claimed')).toMatchObject({ status: 'valid' });
    expect(() => store.save(record('sess_claimed', 'still saving'), { claim })).not.toThrow();
    expect(store.loadHeld?.('sess_unclaimed')).toBeUndefined();
  });

  it('take over a record a handoff save left, instead of refusing it', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    store.save(record('sess_fork'), { handoff: true, provenance: 'owner' });

    const claim = claimOf(store, 'sess_fork');
    expect(claim.outcome).toMatchObject({ status: 'valid', authorship: 'verified' });
    expect(store.exportHeld?.('sess_fork', { handoffOnly: true })).toBeUndefined();
    expect(() => store.save(record('sess_fork', 'run in this process'), { claim })).not.toThrow();
  });

  it('are refused for a record a write-only child holds as handed to it', () => {
    const dir = newStoreDir();
    const parentSealer = createTestArtifactSealer();
    const parent = storeOf(dir, parentSealer);
    parent.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    const token = parent.exportHeld?.('sess_fork') as string;
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(parentSealer.writeGrant()) },
    });
    child.importHeld?.('sess_fork', token);

    expect(isSessionClaimedError(thrownBy(() => child.claim('sess_fork')))).toBe(true);
  });
});

describe('a write-only child’s pinned record', () => {
  it('answers only from the handed-over copy and the child’s own writes, never a planted file', () => {
    const dir = newStoreDir();
    const parentSealer = createTestArtifactSealer();
    const parent = storeOf(dir, parentSealer);
    parent.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    const token = parent.exportHeld?.('sess_fork') as string;
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(parentSealer.writeGrant()) },
    });
    child.importHeld?.('sess_fork', token);
    child.save(record('sess_fork', 'the child turn'));
    writeFileSync(fileOf(dir, 'sess_fork'), envelopeOf(record('sess_fork', FORGED)));

    expect(loadSessionForUpdate(child, 'sess_fork')).toEqual({
      status: 'locked',
      reason: 'changed',
    });
    expect(() => child.save(record('sess_fork', 'the next child turn'))).toThrow(/changed on disk/);
    expect(readFileSync(fileOf(dir, 'sess_fork'), 'utf8')).toContain(FORGED);
  });
});

describe('adopting a record', () => {
  it('drops only the live abandoned claim\'s held record, never a later claim\'s', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_a', sealer, CANARY);
    const store = storeOf(dir, sealer);
    const first = claimOf(store, 'sess_a');
    first.release();
    const second = claimOf(store, 'sess_a');
    first.discard?.();
    sealer.lock();
    expect(store.loadHeld?.('sess_a')).toMatchObject({ status: 'valid' });
    second.discard?.();
    expect(store.loadHeld?.('sess_a')).toBeUndefined();
    second.discard?.();
    second.release();
  });

  it('raises bytes this store holds, tags them in place and clears the taint', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_a', sealer, CANARY);
    const store = storeOf(dir, sealer);
    const shown = store.load('sess_a', { hold: true });
    expect(shown).toMatchObject({ authorship: 'unverified' });

    expect(store.authorship?.adopt('sess_a', (shown as { digest: string }).digest)).toBe('adopted');
    expect(plaintextOf(dir, 'sess_a', sealer)).toMatch(HEADER);
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('verified');
    store.save(record('sess_a', 'the next turn'), { provenance: 'owner' });
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('verified');
  });

  it('defers the tag while locked and settles it at the unlock', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_a', sealer, CANARY);
    const store = storeOf(dir, sealer);
    const digest = (store.load('sess_a', { hold: true }) as { digest: string }).digest;
    sealer.lock();

    expect(store.authorship?.adopt('sess_a', digest)).toBe('pending');
    expect(store.loadHeld?.('sess_a')).toMatchObject({ authorship: 'verified' });
    sealer.unlock();
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('verified');
  });

  it('tags exactly the bytes a child left, holding nothing for them', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_fork', sealer, CANARY);
    const store = storeOf(dir, sealer);

    expect(store.authorship?.adopt('sess_fork', digestOfFile(dir, 'sess_fork'))).toBe('adopted');
    expect(authorshipSeenFresh(dir, 'sess_fork', sealer)).toBe('verified');
    expect(store.loadHeld?.('sess_fork')).toBeUndefined();
  });

  it('defers a child’s bytes while locked, holding nothing, and tags them at the unlock', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_fork', sealer, CANARY);
    const store = storeOf(dir, sealer);
    sealer.lock();

    expect(store.authorship?.adopt('sess_fork', digestOfFile(dir, 'sess_fork'))).toBe('pending');
    expect(store.loadHeld?.('sess_fork')).toBeUndefined();
    sealer.unlock();
    expect(authorshipSeenFresh(dir, 'sess_fork', sealer)).toBe('verified');
    expect(store.loadHeld?.('sess_fork')).toBeUndefined();
  });

  it('raises nothing for bytes that are not there', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_a', sealer);
    const store = storeOf(dir, sealer);
    const before = readFileSync(fileOf(dir, 'sess_a'));

    expect(store.authorship?.adopt('sess_a', 'f'.repeat(64))).toBe('changed');
    expect(store.authorship?.adopt('sess_a', 'not a digest')).toBe('changed');
    expect(store.authorship?.adopt('sess_none', 'f'.repeat(64))).toBe('changed');
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(before)).toBe(true);
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('unverified');
  });

  it('raises held bytes whose file changed since, without touching the file', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_a', sealer, CANARY);
    const store = storeOf(dir, sealer);
    const digest = (store.load('sess_a', { hold: true }) as { digest: string }).digest;
    forge(dir, 'sess_a', sealer);
    const swapped = readFileSync(fileOf(dir, 'sess_a'));

    expect(store.authorship?.adopt('sess_a', digest)).toBe('adopted');
    expect(readFileSync(fileOf(dir, 'sess_a')).equals(swapped)).toBe(true);
  });
});

describe('tagging at unlock', () => {
  it('tags a claimed session’s owner writes, and an unclaimed id still exactly its last owner write', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = storeOf(dir, sealer);
    const claim = claimOf(store, 'sess_running', true);
    store.save(record('sess_running'), { claim, provenance: 'owner' });
    store.save(record('sess_closed'), { provenance: 'owner' });

    sealer.unlock();

    expect(authorshipSeenFresh(dir, 'sess_running', sealer)).toBe('verified');
    expect(authorshipSeenFresh(dir, 'sess_closed', sealer)).toBe('verified');
  });

  it('leaves a file that is no longer this store’s last write as it is', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    storeOf(dir, sealer).save(record('sess_a'), { provenance: 'owner' });
    forge(dir, 'sess_a', sealer);
    const replaced = readFileSync(fileOf(dir, 'sess_a'));

    sealer.unlock();

    expect(readFileSync(fileOf(dir, 'sess_a')).equals(replaced)).toBe(true);
  });

  it('never tags a handoff save, nor an id lent to a child, which would refuse its saves', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = storeOf(dir, sealer);
    store.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    const claim = claimOf(store, 'sess_lent', true);
    store.save(record('sess_lent'), { claim, provenance: 'owner' });
    claim.release();
    store.lend('sess_lent');
    const fork = readFileSync(fileOf(dir, 'sess_fork'));
    const lent = readFileSync(fileOf(dir, 'sess_lent'));

    sealer.unlock();

    expect(readFileSync(fileOf(dir, 'sess_fork')).equals(fork)).toBe(true);
    expect(readFileSync(fileOf(dir, 'sess_lent')).equals(lent)).toBe(true);
  });

  it('settles a countersign deferred while locked, once the lease to the child has ended', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = storeOf(dir, sealer);
    store.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    const lease = store.lend('sess_fork');
    const token = store.exportHeld?.('sess_fork') as string;
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
    });
    child.importHeld?.('sess_fork', token);
    const childClaim = child.claim('sess_fork', { lease: lease.nonce });
    child.save(record('sess_fork', 'the child turn'), { claim: childClaim });
    childClaim.release();
    // The countersign ends the lease first, as the child has exited.
    lease.end();

    expect(store.authorship?.adopt('sess_fork', digestOfFile(dir, 'sess_fork'))).toBe('pending');
    sealer.unlock();

    expect(authorshipSeenFresh(dir, 'sess_fork', sealer)).toBe('verified');
    expect(contentOf(storeOf(dir, sealer).load('sess_fork'))).toContain('the child turn');
  });
});

describe('an export that asks for the handoff copy only', () => {
  it('refuses a swapped record, and anything not left by a handoff save', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    store.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    storeOf(dir, sealer).save(record('sess_fork', 'swapped in by another writer'));
    storeOf(dir, sealer).save(record('sess_other'), { provenance: 'owner' });

    expect(store.exportHeld?.('sess_fork', { handoffOnly: true })).toBeUndefined();
    expect(store.exportHeld?.('sess_other', { handoffOnly: true })).toBeUndefined();
    expect(store.exportHeld?.('sess_other')).toMatch(/^rsh2\./);
  });

  it('hands over the copy while the file is still its bytes', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    store.save(record('sess_fork'), { handoff: true, provenance: 'owner' });

    expect(store.exportHeld?.('sess_fork', { handoffOnly: true, keep: true })).toMatch(/^rsh2\./);
    expect(store.exportHeld?.('sess_fork', { handoffOnly: true })).toMatch(/^rsh2\./);
    expect(store.exportHeld?.('sess_fork', { handoffOnly: true })).toBeUndefined();
  });
});

describe('the end of a lease to a child', () => {
  it('lets an unlock tag the id again, which it never does while the child may still save it', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const { store, claim } = runningSession(dir, sealer, 'sess_lent');
    claim.release();
    const lease = store.lend('sess_lent');

    lease.end();
    sealer.unlock();

    expect(authorshipSeenFresh(dir, 'sess_lent', sealer)).toBe('verified');
  });
});

describe('what a store says it holds for an id', () => {
  it('is the digest of the bytes it last wrote or read to hold', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    store.save(record('sess_owned'), { provenance: 'owner' });
    forge(dir, 'sess_planted', sealer);
    store.load('sess_planted', { hold: true });

    expect(store.authorship?.heldDigest('sess_owned')).toBe(digestOfFile(dir, 'sess_owned'));
    expect(store.authorship?.heldDigest('sess_planted')).toBe(digestOfFile(dir, 'sess_planted'));
    expect(store.authorship?.heldDigest('sess_never_read')).toBeUndefined();
  });

  it('is, in a write-only child, the bytes of each save of the record it was handed', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const parent = storeOf(dir, sealer);
    parent.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
    });
    child.importHeld?.('sess_fork', parent.exportHeld?.('sess_fork') as string);

    child.save(record('sess_fork', 'the child turn'));

    expect(child.authorship?.heldDigest('sess_fork')).toBe(digestOfFile(dir, 'sess_fork'));
  });

  it('is never offered by a store that seals nothing', () => {
    const store = new NodeSessionStore(newStoreDir(), { sealing: 'plain' });
    store.save(record('sess_plain'));

    expect(store.authorship).toBeUndefined();
    expect('authorship' in store).toBe(false);
  });
});

describe('claims in a store that seals nothing', () => {
  it('are exclusive and fence saves, exactly as in one that seals', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, { sealing: 'plain' });
    const first = store.claim('sess_plain', { fresh: true });
    store.save(record('sess_plain'), { claim: first });

    expect(isSessionClaimedError(thrownBy(() => store.claim('sess_plain')))).toBe(true);
    expect((thrownBy(() => store.save(record('sess_plain'))) as { reason?: unknown }).reason).toBe(
      'has_writer',
    );
    first.release();
    const second = store.claim('sess_plain');
    expect(second.outcome).toMatchObject({ status: 'valid', record: { id: 'sess_plain' } });
    expect(
      (thrownBy(() => store.save(record('sess_plain'), { claim: first })) as { reason?: unknown })
        .reason,
    ).toBe('released');
    expect(() =>
      store.save(record('sess_plain', 'the next turn'), { claim: second }),
    ).not.toThrow();
  });
});

describe('adopting a record lent to a child that still saves it', () => {
  it('raises nothing and leaves the file, so the child’s next save still goes through', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const parent = storeOf(dir, sealer);
    parent.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    const lease = parent.lend('sess_fork');
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
    });
    child.importHeld('sess_fork', parent.exportHeld('sess_fork') as string);
    const claim = child.claim('sess_fork', { lease: lease.nonce });
    child.save(record('sess_fork', 'the child turn'), { claim });
    const before = readFileSync(fileOf(dir, 'sess_fork'));

    expect(parent.authorship?.adopt('sess_fork', digestOfFile(dir, 'sess_fork'))).toBe(
      'has_writer',
    );
    expect(readFileSync(fileOf(dir, 'sess_fork')).equals(before)).toBe(true);
    expect(() => child.save(record('sess_fork', 'the next child turn'), { claim })).not.toThrow();
  });
});

/** `base`, writing `newer` over session `id`'s file the first time it is asked, unlocked, for a tag of it. */
function sealerWritingDuringTag(
  base: IArtifactSealerDouble,
  dir: string,
  id: string,
  newer: IInteractiveSessionRecord,
): IArtifactSealerDouble {
  let written = false;
  return {
    ...base,
    get isLocked() {
      return base.isLocked;
    },
    tagAuthorship(bytes, context) {
      if (!written && !base.isLocked && context.id === id) {
        written = true;
        // Another of the owner's processes, unlocked, saves the session in between, past the marker.
        savedElsewhere(dir, base, newer);
      }
      return base.tagAuthorship(bytes, context);
    },
  };
}

describe('a raise or a tag at unlock that another owner process’s write overtakes', () => {
  it('never replaces the newer write with the adopted bytes', () => {
    const dir = newStoreDir();
    const base = createTestArtifactSealer();
    forge(dir, 'sess_a', base, CANARY);
    const sealer = sealerWritingDuringTag(base, dir, 'sess_a', record('sess_a', 'the newer write'));
    const store = storeOf(dir, sealer);
    const digest = (store.load('sess_a', { hold: true }) as { digest: string }).digest;

    expect(store.authorship?.adopt('sess_a', digest)).toBe('adopted');

    expect(plaintextOf(dir, 'sess_a', base)).toContain('the newer write');
    expect(authorshipSeenFresh(dir, 'sess_a', base)).toBe('verified');
  });

  it('never replaces the newer write when tagging an owner write at the unlock', () => {
    const dir = newStoreDir();
    const base = createTestArtifactSealer({ locked: true });
    const sealer = sealerWritingDuringTag(base, dir, 'sess_a', record('sess_a', 'the newer write'));
    const store = storeOf(dir, sealer);
    store.save(record('sess_a', 'written while locked'), { provenance: 'owner' });

    base.unlock();

    expect(plaintextOf(dir, 'sess_a', base)).toContain('the newer write');
    expect(plaintextOf(dir, 'sess_a', base)).not.toContain('written while locked');
  });
});

describe('an id lent to a child that may still save it', () => {
  it('cannot be claimed until the lease ends, and can be then', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    store.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    const lease = store.lend('sess_fork');
    expect(store.exportHeld?.('sess_fork', { handoffOnly: true })).toBeDefined();
    expect(store.load('sess_fork')).toMatchObject({ status: 'valid', authorship: 'verified' });

    const refusal = thrownBy(() => claimOf(store, 'sess_fork'));
    expect(isSessionClaimedError(refusal)).toBe(true);
    expect(refusal).toMatchObject({ sessionId: 'sess_fork', reason: 'has_writer' });

    lease.end();
    const claim = claimOf(store, 'sess_fork');
    expect(claim.outcome).toMatchObject({ status: 'valid', authorship: 'verified' });
    claim.release();
  });

  it('cannot be deleted while it is lent, since the child may still save it', () => {
    const dir = newStoreDir();
    const store = storeOf(dir, createTestArtifactSealer());
    store.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    const lease = store.lend('sess_fork');

    expect(thrownBy(() => store.delete('sess_fork'))).toMatchObject({ reason: 'has_writer' });
    expect(store.hasWriter('sess_fork')).toBe(true);
    lease.end();
    store.delete('sess_fork');
    expect(store.hasWriter('sess_fork')).toBe(false);
    expect(store.load('sess_fork')).toEqual({ status: 'missing' });
  });
});

describe('whether an id has a writer', () => {
  it('is so while a session claims it, in a store that seals nothing too, and not once it lets go', () => {
    for (const store of [
      storeOf(newStoreDir(), createTestArtifactSealer()),
      new NodeSessionStore(newStoreDir(), { sealing: 'plain' }),
    ]) {
      expect(store.hasWriter('sess_run')).toBe(false);
      const claim = claimOf(store, 'sess_run', true);
      expect(store.hasWriter('sess_run')).toBe(true);
      claim.release();
      expect(store.hasWriter('sess_run')).toBe(false);
    }
  });

  it('is so while the record is lent to a child, and not once the lease ends', () => {
    const dir = newStoreDir();
    const store = storeOf(dir, createTestArtifactSealer());
    store.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    expect(store.hasWriter('sess_fork')).toBe(false);

    const lease = store.lend('sess_fork');
    expect(store.hasWriter('sess_fork')).toBe(true);

    lease.end();
    expect(store.hasWriter('sess_fork')).toBe(false);
  });
});

describe('the record a write-only child is handed', () => {
  function handedToChild(dir: string, sealer: IArtifactSealerDouble, provenance?: 'owner') {
    const parent = storeOf(dir, sealer);
    parent.save(record('sess_fork'), { handoff: true, ...(provenance ? { provenance } : {}) });
    const token = parent.exportHeld?.('sess_fork', { handoffOnly: true }) as string;
    const child = new NodeSessionStore(dir, {
      sealing: { sealer: openTestWriteGrant(sealer.writeGrant()) },
    });
    child.importHeld?.('sess_fork', token);
    return child;
  }

  it('is the owner’s to the child when the parent handed it over as the owner’s', () => {
    const child = handedToChild(newStoreDir(), createTestArtifactSealer(), 'owner');

    expect(child.load('sess_fork', { hold: true })).toMatchObject({
      status: 'valid',
      authorship: 'verified',
    });
  });

  it('stays unverified to the child when the parent could not vouch for it', () => {
    const child = handedToChild(newStoreDir(), createTestArtifactSealer());

    expect(child.load('sess_fork', { hold: true })).toMatchObject({
      status: 'valid',
      authorship: 'unverified',
    });
  });

  it('is never what a file swapped in after the handover says', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const child = handedToChild(dir, sealer, 'owner');
    forge(dir, 'sess_fork', sealer);

    expect(child.load('sess_fork', { hold: true })).toEqual({
      status: 'locked',
      reason: 'changed',
    });
  });
});
