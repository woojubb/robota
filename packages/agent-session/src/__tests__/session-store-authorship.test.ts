/**
 * Authorship of sealed session records (#3679 step 3e). Sealing needs only the public key, so a record
 * that opens says nothing about who wrote it; a resumed record is fed back to the model as its own
 * history, so the store decides whose each record is when it opens the bytes, and says so on every
 * `valid` outcome. These drive NodeSessionStore with the agent-core sealer double (its tags are an
 * HMAC only the unlocked double makes) and read the bytes on disk.
 *
 * What they protect: a forgery made with the public key alone never reads as the owner's; a save
 * tags only what the store can vouch for; content handed out unverified is never tagged by a later
 * save; and a plain store is exactly the store it always was.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestArtifactSealer, openTestWriteGrant } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { loadSessionForUpdate } from '../load-session-for-update.js';
import { SESSION_RECORD_ENVELOPE_VERSION } from '../session-record-codec/index.js';
import { NodeSessionStore } from '../session-store.js';

import type { IArtifactSealerDouble } from '@robota-sdk/agent-core/testing';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const CANARY = 'CANARY-authorship-51e0-owner-text';
const FORGED = 'CANARY-authorship-9d22-forged-text';
const HEADER = /^robota-authorship\/v1 [A-Za-z0-9_-]{43}\n/;

function newStoreDir(): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), 'authorship-store-')));
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

function storeOf(dir: string, sealer: IArtifactSealerDouble): NodeSessionStore {
  return new NodeSessionStore(dir, { sealing: { sealer } });
}

/** The sealed plaintext of the record at `id`, as the (unlocked) double opens it. */
function plaintextOf(dir: string, id: string, sealer: IArtifactSealerDouble): string {
  return Buffer.from(sealer.openBytes(readFileSync(fileOf(dir, id)), contextOf(id))).toString(
    'utf8',
  );
}

/** Whose a store that never saw the record says it is: decided from the bytes alone. */
function authorshipSeenFresh(dir: string, id: string, sealer: IArtifactSealerDouble): unknown {
  const outcome = storeOf(dir, sealer).load(id);
  return outcome.status === 'valid' ? outcome.authorship : outcome.status;
}

/** A record sealed with the public side alone, as any program of the same user can. */
function forge(dir: string, id: string, sealer: IArtifactSealerDouble, plaintext: string): void {
  const writeOnly = openTestWriteGrant(sealer.writeGrant());
  writeFileSync(fileOf(dir, id), writeOnly.sealBytes(Buffer.from(plaintext), contextOf(id)));
}

function textOfOutcome(outcome: ReturnType<NodeSessionStore['load']>): string {
  return outcome.status === 'valid' ? JSON.stringify(outcome.record.messages) : outcome.status;
}

describe('the authorship header', () => {
  it('is put in front of the exact envelope bytes by an owner save while unlocked', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    storeOf(dir, sealer).save(record('sess_a'), { provenance: 'owner' });

    const plaintext = plaintextOf(dir, 'sess_a', sealer);
    expect(plaintext).toMatch(HEADER);
    expect(plaintext.replace(HEADER, '')).toBe(envelopeOf(record('sess_a')));
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('verified');
  });

  it('is left off a save of an id the store holds nothing for and was told nothing about', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    storeOf(dir, sealer).save(record('sess_a'));

    expect(plaintextOf(dir, 'sess_a', sealer)).toBe(envelopeOf(record('sess_a')));
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('unverified');
  });

  it('is never carried by a token handed to another process', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    store.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    expect(plaintextOf(dir, 'sess_fork', sealer)).toMatch(HEADER);

    const token = store.exportHeld?.('sess_fork') as string;
    const [, , , encoded] = token.split('.');
    expect(Buffer.from(encoded ?? '', 'base64url').toString('utf8')).toBe(
      envelopeOf(record('sess_fork')),
    );
  });
});

describe('a record forged with only the public key', () => {
  it('opens, and reads as unverified', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_a', sealer, envelopeOf(record('sess_a', FORGED)));

    const outcome = storeOf(dir, sealer).load('sess_a');
    expect(outcome.status).toBe('valid');
    expect(outcome).toMatchObject({ authorship: 'unverified' });
  });

  it('reads as unverified with a header whose tag is made up, malformed, or another id’s', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const envelope = envelopeOf(record('sess_a', FORGED));
    const otherIdsTag = Buffer.from(
      sealer.tagAuthorship(Buffer.from(envelope), contextOf('sess_other')),
    ).toString('base64url');
    for (const header of [
      `robota-authorship/v1 ${Buffer.alloc(32, 7).toString('base64url')}\n`,
      'robota-authorship/v1 not-a-tag\n',
      `robota-authorship/v1 ${otherIdsTag}\n`,
    ]) {
      forge(dir, 'sess_a', sealer, header + envelope);
      expect(storeOf(dir, sealer).load('sess_a'), header).toMatchObject({
        status: 'valid',
        authorship: 'unverified',
      });
    }
  });

  it('cannot borrow a real tag by changing the envelope under it', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    storeOf(dir, sealer).save(record('sess_a'), { provenance: 'owner' });
    const [header] = HEADER.exec(plaintextOf(dir, 'sess_a', sealer)) as RegExpExecArray;
    forge(dir, 'sess_a', sealer, header + envelopeOf(record('sess_a', FORGED)));

    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('unverified');
  });
});

describe('every valid outcome of a store that seals', () => {
  it('carries authorship and the digest of the stored bytes, on every read path', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    store.save(record('sess_owner'), { provenance: 'owner' });
    writeFileSync(fileOf(dir, 'sess_plain'), envelopeOf(record('sess_plain')));
    const claim = store.claim('sess_claimed', { fresh: true });
    store.save(record('sess_claimed'), { claim, provenance: 'owner' });

    const outcomes = [
      store.load('sess_owner'),
      store.load('sess_owner', { hold: true }),
      store.loadHeld?.('sess_owner'),
      store.load('sess_plain'),
      store.load('sess_claimed'),
      ...store.list().map((entry) => entry.outcome),
    ];
    for (const outcome of outcomes) {
      expect(outcome?.status).toBe('valid');
      expect(outcome).toMatchObject({ authorship: expect.stringMatching(/^(un)?verified$/) });
      expect(outcome).toMatchObject({ digest: expect.stringMatching(/^[0-9a-f]{64}$/) });
    }
    expect(store.load('sess_owner')).toMatchObject({ authorship: 'verified' });
    expect(store.load('sess_plain')).toMatchObject({ authorship: 'unverified' });
  });

  it('names the stored bytes it came from', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    storeOf(dir, sealer).save(record('sess_a'), { provenance: 'owner' });
    const digest = createHash('sha256')
      .update(readFileSync(fileOf(dir, 'sess_a')))
      .digest('hex');

    expect(storeOf(dir, sealer).load('sess_a')).toMatchObject({ digest });
  });
});

describe('what a save tags', () => {
  it('keeps a record the store wrote as the owner’s through a writer’s read and save', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    store.save(record('sess_a'), { provenance: 'owner' });

    const outcome = loadSessionForUpdate(store, 'sess_a');
    expect(outcome).toMatchObject({ status: 'valid', authorship: 'verified' });
    store.save(record('sess_a', 'the next turn'));

    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('verified');
  });

  it('keeps an unverified record unverified through a writer’s read and save, whatever it says', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_a', sealer, envelopeOf(record('sess_a', FORGED)));
    const store = storeOf(dir, sealer);

    expect(loadSessionForUpdate(store, 'sess_a')).toMatchObject({ authorship: 'unverified' });
    store.save(record('sess_a', 'merged'), { provenance: 'owner' });

    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('unverified');
  });

  it('does not tag a probe-then-save of an id it handed unverified content out for', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_a', sealer, envelopeOf(record('sess_a', FORGED)));
    const store = storeOf(dir, sealer);

    expect(store.load('sess_a')).toMatchObject({ authorship: 'unverified' });
    store.save(record('sess_a', 'merged from the probe'), { provenance: 'owner' });

    expect(plaintextOf(dir, 'sess_a', sealer)).not.toMatch(HEADER);
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('unverified');
  });

  it('is not stopped by a listing, which no writer merges', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    forge(dir, 'sess_a', sealer, envelopeOf(record('sess_a', FORGED)));
    const store = storeOf(dir, sealer);

    expect(store.list()[0]?.outcome).toMatchObject({ authorship: 'unverified' });
    store.save(record('sess_a', 'a new session over it'), { provenance: 'owner' });

    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('verified');
  });

  it('lowers, and never raises, what the store holds', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer();
    const store = storeOf(dir, sealer);
    store.save(record('sess_a'), { provenance: 'owner' });
    store.save(record('sess_a'), { provenance: 'unverified' });
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('unverified');

    store.save(record('sess_a'), { provenance: 'owner' });
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('unverified');
  });

  it('writes an owner save while locked untagged, and tags it at the next unlock', () => {
    const dir = newStoreDir();
    const sealer = createTestArtifactSealer({ locked: true });
    const store = storeOf(dir, sealer);
    store.save(record('sess_a'), { provenance: 'owner' });
    const written = readFileSync(fileOf(dir, 'sess_a'));

    sealer.unlock();

    expect(readFileSync(fileOf(dir, 'sess_a')).equals(written)).toBe(false);
    expect(plaintextOf(dir, 'sess_a', sealer)).toMatch(HEADER);
    expect(authorshipSeenFresh(dir, 'sess_a', sealer)).toBe('verified');
    // The store goes on recognising the bytes it re-sealed, even once locked again.
    sealer.lock();
    expect(store.loadHeld?.('sess_a')).toMatchObject({ status: 'valid', authorship: 'verified' });
  });
});

describe('a store that seals nothing', () => {
  /** What a plain store writes for `record('sess_golden')`: the envelope alone, with no authorship header. */
  const GOLDEN = `{
  "schemaVersion": ${SESSION_RECORD_ENVELOPE_VERSION},
  "record": {
    "id": "sess_golden",
    "cwd": "/work",
    "createdAt": "2026-08-01T00:00:00.000Z",
    "updatedAt": "2026-08-01T01:00:00.000Z",
    "messages": [
      {
        "id": "m-0",
        "role": "user",
        "content": "${CANARY}",
        "timestamp": "2026-08-01T00:30:00.000Z",
        "state": "complete"
      }
    ]
  }
}`;

  it('writes the golden bytes whatever a save says about provenance', () => {
    for (const options of [
      undefined,
      { provenance: 'owner' as const },
      { provenance: 'unverified' as const },
    ]) {
      const dir = newStoreDir();
      new NodeSessionStore(dir, { sealing: 'plain' }).save(record('sess_golden'), options);
      expect(readFileSync(fileOf(dir, 'sess_golden'), 'utf8')).toBe(GOLDEN);
    }
  });

  it('reads records without authorship, and offers no authorship member', () => {
    const dir = newStoreDir();
    const store = new NodeSessionStore(dir, { sealing: 'plain' });
    store.save(record('sess_golden'));

    expect(store.load('sess_golden')).toEqual({ status: 'valid', record: record('sess_golden') });
    expect(store.list()).toEqual([
      { id: 'sess_golden', outcome: { status: 'valid', record: record('sess_golden') } },
    ]);
    expect(store.claim('sess_golden').outcome).toEqual({
      status: 'valid',
      record: record('sess_golden'),
    });
    expect(store.authorship).toBeUndefined();
    expect('authorship' in store).toBe(false);
  });
});
