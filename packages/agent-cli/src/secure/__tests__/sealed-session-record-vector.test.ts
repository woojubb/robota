/**
 * Known answer for the product's sealed session record: one record file sealed by
 * `KeyHolderArtifactSealer` through `NodeSessionStore`, to the sealing key of the fixed master key
 * the keyring's own known-answer vectors use (`fixtures/keyring-v1.json` is a copy of
 * `agent-keyring`'s fixture of that key). Sealing draws fresh randomness, so the file cannot be
 * recomputed; it was produced once from source and checked in. What it pins is that a record this
 * build's product wrote still opens to the same JSON: a change to the record framing, the binding
 * of a record to its id (prefix, separator, kind), the envelope or the keyring's sealing fails here
 * even though every round trip still passes.
 */
import { Buffer } from 'node:buffer';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KeyringError, getSealingPublicKey, parseKeyring } from '@robota-sdk/agent-keyring';
import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KeyHolderArtifactSealer } from '../artifact-sealer.js';
import { KeyHolder } from '../key-holder.js';
import { createMemoryKeyringStore } from './helpers.js';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** The sealing public key FIXED_MASTER_KEY derives, as the keyring's known answers pin it. */
const FIXED_MASTER_KEY_SEALING_PUBLIC_KEY =
  '4b73c35676631b6307fb28a3f70aaf47c331b86ada4996ce2f3c9f5c04cdba7a';
const FIXTURE_RECOVERY_KEY = 'M2GT-58X4-MPKA-FA59-NANT-SBDE-NYRB-3CNK';
const ID = 'session_kat_v1';

/** The record the checked-in file holds, as JSON. */
const KNOWN_RECORD = {
  id: ID,
  name: 'known answer',
  cwd: '/work/kat',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:05:00.000Z',
  messages: [
    {
      id: 'm-0',
      role: 'user',
      content: 'known-answer conversation, sealed record v1',
      timestamp: '2026-11-01T00:01:00.000Z',
      state: 'complete',
    },
    {
      id: 'm-1',
      role: 'assistant',
      content: 'it opens to exactly this',
      timestamp: '2026-11-01T00:02:00.000Z',
      state: 'complete',
    },
  ],
};

const sealed = readFileSync(fixture('session-record-v1.sealed'));
const keyring = parseKeyring(readFileSync(fixture('keyring-v1.json'), 'utf8'));

let dir: string;
let holder: KeyHolder;
let sealer: KeyHolderArtifactSealer;

beforeEach(async () => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'sealed-record-vector-')));
  holder = new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } });
  await holder.unlock({ type: 'recoveryKey', recoveryKey: FIXTURE_RECOVERY_KEY });
  sealer = new KeyHolderArtifactSealer(holder);
});

afterEach(() => {
  holder.lock('explicit');
  rmSync(dir, { recursive: true, force: true });
});

function storedAs(id: string, bytes: Uint8Array = sealed): NodeSessionStore {
  writeFileSync(join(dir, `${id}.json`), bytes);
  return new NodeSessionStore(dir, { sealing: { sealer } });
}

function decryptionCode(aad: string): string {
  try {
    holder.openBlob(sealed.subarray(4), Buffer.from(aad, 'utf8'));
  } catch (error) {
    if (error instanceof KeyringError) return error.code;
    throw error;
  }
  return 'opened';
}

describe('sealed session record version 1 — known answer', () => {
  it('is sealed to the key of the fixed master key', () => {
    expect(Buffer.from(getSealingPublicKey(keyring)).toString('hex')).toBe(
      FIXED_MASTER_KEY_SEALING_PUBLIC_KEY,
    );
    expect(sealed.subarray(0, 4).toString('latin1')).toBe('RSL1');
  });

  it('opens through the sealer and the store to the known record', () => {
    copyFileSync(fixture('session-record-v1.sealed'), join(dir, `${ID}.json`));
    const outcome = new NodeSessionStore(dir, { sealing: { sealer } }).load(ID);
    if (outcome.status !== 'valid') throw new Error(`expected valid, got ${outcome.status}`);
    expect(JSON.parse(JSON.stringify(outcome.record))).toEqual(KNOWN_RECORD);
    expect(
      Buffer.from(sealer.openBytes(sealed, { kind: 'session-record', id: ID })).toString('utf8'),
    ).toBe(JSON.stringify({ schemaVersion: 2, record: KNOWN_RECORD }, null, 2));
  });

  it('is bound by exactly `robota/artifact/v1|session-record|<id>`: one byte off does not open', () => {
    expect(decryptionCode(`robota/artifact/v1|session-record|${ID}`)).toBe('opened');
    for (const aad of [
      `robota/artifact/v2|session-record|${ID}`, // prefix
      `robota/artifact/v1/session-record|${ID}`, // separator
      `robota/artifact/v1|session-recorD|${ID}`, // kind
      `robota/artifact/v1|session-record|${ID.slice(0, -1)}2`, // id
    ]) {
      expect(decryptionCode(aad), aad).toBe('decryption-failed');
    }
    // The same binding seen from the store: the file copied under another id does not open there.
    expect(storedAs('session_kat_v2').load('session_kat_v2').status).toBe('corrupt');
  });

  it('does not open with one byte of the magic changed', () => {
    for (const [index, value] of [
      [0, 0x53], // `SSL1`: not sealed framing at all
      [3, 0x32], // `RSL2`: a framing version this build does not open
    ] as const) {
      const changed = Buffer.from(sealed);
      changed[index] = value;
      expect(storedAs(ID, changed).load(ID).status, String(index)).not.toBe('valid');
    }
  });
});
