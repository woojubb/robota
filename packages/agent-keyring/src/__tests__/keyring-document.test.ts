import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  getSealingPublicKey,
  KeyringError,
  parseKeyring,
  serializeKeyring,
  type IKeyring,
} from '../index.js';
import { MAX_KEYRING_JSON_CHARS, MAX_KEYSLOTS } from '../keyring-document.js';
import { codeOf, KNOWN_SEALING_PUBLIC_KEY_HEX, hex } from './helpers.js';

// Read as stored: .gitattributes keeps this fixture on LF, which the byte-for-byte comparison relies on.
const fixtureText = readFileSync(
  fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)),
  'utf8',
);
// A loosely typed JSON view: these tests deliberately build documents that break the schema.
type TLooseDocument = Record<string, any>;
const fixture = JSON.parse(fixtureText) as TLooseDocument;

function documentWith(change: (copy: TLooseDocument) => void): string {
  const copy = structuredClone(fixture);
  change(copy);
  return JSON.stringify(copy);
}

describe('parseKeyring and serializeKeyring', () => {
  it('reads the fixed schema and writes it back identically', () => {
    const keyring = parseKeyring(fixtureText);
    expect(keyring.version).toBe(1);
    expect(keyring.slots).toHaveLength(2);
    expect(serializeKeyring(keyring)).toBe(fixtureText.trimEnd());
    expect(Object.keys(JSON.parse(serializeKeyring(keyring)))).toEqual([
      'version',
      'sealingPublicKey',
      'slots',
    ]);
    expect(hex(getSealingPublicKey(keyring))).toBe(KNOWN_SEALING_PUBLIC_KEY_HEX);
  });

  it('returns a frozen copy that shares nothing with its input', () => {
    const keyring = parseKeyring(fixtureText);
    expect(Object.isFrozen(keyring)).toBe(true);
    expect(Object.isFrozen(keyring.slots)).toBe(true);
    expect(Object.isFrozen(keyring.slots[0])).toBe(true);
  });

  it('reports a document of another version as unsupported-version, whatever else it contains', () => {
    expect(codeOf(() => parseKeyring(documentWith((copy) => (copy.version = 2))))).toBe(
      'unsupported-version',
    );
    expect(codeOf(() => parseKeyring(JSON.stringify({ version: 0 })))).toBe('unsupported-version');
    expect(codeOf(() => parseKeyring(JSON.stringify({ version: 2, somethingNew: [1, 2] })))).toBe(
      'unsupported-version',
    );
  });

  it('refuses a missing, mistyped or fractional version', () => {
    for (const version of [undefined, '1', 1.5, null, true, [], {}]) {
      const text = documentWith((copy) => {
        copy.version = version;
      });
      expect(codeOf(() => parseKeyring(text))).toBe('malformed-keyring');
    }
  });

  it('has no field for an attach public key, and refuses any extra field', () => {
    expect(
      codeOf(() => parseKeyring(documentWith((copy) => (copy.attachPublicKey = 'AAAA')))),
    ).toBe('malformed-keyring');
    expect(codeOf(() => parseKeyring(documentWith((copy) => (copy.slots[0].extra = 1))))).toBe(
      'malformed-keyring',
    );
    expect(codeOf(() => parseKeyring(documentWith((copy) => (copy.slots[0].kdf.extra = 1))))).toBe(
      'malformed-keyring',
    );
  });

  it('refuses missing fields at every level', () => {
    const removals: Array<(copy: TLooseDocument) => void> = [
      (copy) => delete copy.sealingPublicKey,
      (copy) => delete copy.slots,
      (copy) => delete copy.slots[0].id,
      (copy) => delete copy.slots[0].type,
      (copy) => delete copy.slots[0].iv,
      (copy) => delete copy.slots[0].wrappedKey,
      (copy) => delete copy.slots[0].kdf,
      (copy) => delete copy.slots[0].kdf.salt,
      (copy) => delete copy.slots[0].kdf.N,
      (copy) => delete copy.slots[1].wrappedKey,
    ];
    for (const remove of removals) {
      expect(codeOf(() => parseKeyring(documentWith(remove)))).toBe('malformed-keyring');
    }
  });

  it('refuses wrong types and wrong lengths', () => {
    const changes: Array<(copy: TLooseDocument) => void> = [
      (copy) => (copy.sealingPublicKey = 42),
      (copy) => (copy.sealingPublicKey = copy.sealingPublicKey.slice(0, -2)),
      (copy) => (copy.sealingPublicKey = `${copy.sealingPublicKey}AA`),
      (copy) => (copy.slots = {}),
      (copy) => (copy.slots = []),
      (copy) => (copy.slots = [null]),
      (copy) => (copy.slots = ['x']),
      (copy) => (copy.slots[0].id = 'short'),
      (copy) => (copy.slots[0].iv = copy.slots[0].iv.slice(2)),
      (copy) => (copy.slots[0].wrappedKey = copy.slots[0].wrappedKey.slice(2)),
      (copy) => (copy.slots[0].type = 'unknown'),
      (copy) => (copy.slots[0].type = 'recovery'), // carries a kdf, which a recovery slot has no field for
      (copy) => (copy.slots[1].type = 'passphrase'), // has no kdf
      (copy) => (copy.slots[0].kdf = 'scrypt'),
      (copy) => (copy.slots[0].kdf.algorithm = 'argon2id'),
      (copy) => (copy.slots[0].kdf.N = '131072'),
      (copy) => (copy.slots[0].kdf.N = 131072.5),
      (copy) => (copy.slots[0].kdf.r = 0),
      (copy) => (copy.slots[0].kdf.p = -1),
      (copy) => (copy.slots[0].kdf.N = Number.MAX_SAFE_INTEGER + 2),
      (copy) => (copy.slots[0].kdf.salt = copy.slots[0].kdf.salt.slice(1)),
    ];
    for (const change of changes) {
      expect(codeOf(() => parseKeyring(documentWith(change)))).toBe('malformed-keyring');
    }
  });

  it('accepts only canonical, unpadded base64url', () => {
    const publicKey: string = fixture.sealingPublicKey;
    const variants = [
      `${publicKey}=`, // padding
      publicKey.replace(/[-_]/, '+'), // standard alphabet (the fixture's key contains a - or _)
      `${publicKey.slice(0, -1)}${publicKey.endsWith('o') ? 'p' : 'o'}`, // different trailing bits
      ` ${publicKey}`,
      publicKey.replace(/./, 'é'),
    ];
    for (const variant of variants) {
      if (variant === publicKey) continue;
      expect(
        codeOf(() => parseKeyring(documentWith((copy) => (copy.sealingPublicKey = variant)))),
      ).toBe('malformed-keyring');
    }
  });

  it('refuses duplicate slot ids, too many slots and an oversized document', () => {
    expect(
      codeOf(() => parseKeyring(documentWith((copy) => (copy.slots[1].id = copy.slots[0].id)))),
    ).toBe('malformed-keyring');
    expect(
      codeOf(() =>
        parseKeyring(
          documentWith((copy) => {
            copy.slots = Array.from({ length: MAX_KEYSLOTS + 1 }, (_, index) => ({
              ...copy.slots[1],
              id: Buffer.alloc(16, index).toString('base64url'),
            }));
          }),
        ),
      ),
    ).toBe('malformed-keyring');
    const padded = `${fixtureText}${' '.repeat(MAX_KEYRING_JSON_CHARS)}`;
    expect(codeOf(() => parseKeyring(padded))).toBe('malformed-keyring');
  });

  it('refuses input that is not a JSON object document', () => {
    for (const text of ['', 'not json', 'null', '[]', '1', '"x"', '{', '[[[[[[[[[[', 'true']) {
      expect(codeOf(() => parseKeyring(text))).toBe('malformed-keyring');
    }
    expect(codeOf(() => parseKeyring(undefined as never))).toBe('malformed-keyring');
    expect(codeOf(() => parseKeyring(Buffer.from(fixtureText) as never))).toBe('malformed-keyring');
    expect(codeOf(() => parseKeyring(`[${'['.repeat(8000)}${']'.repeat(8000)}]`))).toBe(
      'malformed-keyring',
    );
  });

  it('is not steered by prototype-shaped keys', () => {
    const polluted = [
      `{"__proto__": {"polluted": true}, "version": 1, "sealingPublicKey": "${fixture.sealingPublicKey}", "slots": ${JSON.stringify(fixture.slots)}}`,
      `{"version": 1, "__proto__": {"version": 1}, "sealingPublicKey": "${fixture.sealingPublicKey}", "slots": ${JSON.stringify(fixture.slots)}}`,
      `{"constructor": {"prototype": {"polluted": true}}, "version": 1}`,
      `{"version": 1, "sealingPublicKey": "${fixture.sealingPublicKey}", "slots": [{"__proto__": {"type": "recovery"}}]}`,
      documentWith((copy) => (copy.slots[0].constructor = 'x')),
      // A plain assignment would set the prototype; defineProperty makes `__proto__` an own, enumerable key.
      documentWith((copy) =>
        Object.defineProperty(copy.slots[0].kdf, '__proto__', {
          value: { N: 1 },
          enumerable: true,
        }),
      ),
    ];
    for (const text of polluted) {
      expect(codeOf(() => parseKeyring(text))).toBe('malformed-keyring');
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('applies the same validation to hand-built objects', () => {
    const keyring = parseKeyring(fixtureText);
    expect(
      codeOf(() => serializeKeyring({ ...keyring, attachPublicKey: 'x' } as unknown as IKeyring)),
    ).toBe('malformed-keyring');
    expect(codeOf(() => serializeKeyring(Object.create(keyring) as IKeyring))).toBe(
      'malformed-keyring',
    );
    expect(codeOf(() => getSealingPublicKey({ ...keyring, slots: [] }))).toBe('malformed-keyring');
  });

  it('survives a seeded mutation fuzz: always a KeyringError or a document that round-trips', () => {
    // mulberry32: a small deterministic PRNG, so a failure reproduces.
    let state = 0x5eed1234;
    const random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (limit: number) => Math.floor(random() * limit);
    const alphabet = 'AZaz09-_+/=",:{}[] \né';
    let accepted = 0;
    let rejected = 0;
    for (let round = 0; round < 1500; round += 1) {
      let text = fixtureText;
      for (let edits = 1 + pick(3); edits > 0; edits -= 1) {
        const at = pick(text.length);
        const kind = pick(4);
        if (kind === 0)
          text = text.slice(0, at) + alphabet[pick(alphabet.length)] + text.slice(at + 1);
        else if (kind === 1) text = text.slice(0, at) + text.slice(at + 1 + pick(8));
        else if (kind === 2)
          text = text.slice(0, at) + alphabet[pick(alphabet.length)] + text.slice(at);
        else text = text.slice(0, at) + text.slice(at, at + 1 + pick(40)) + text.slice(at);
      }
      try {
        const keyring = parseKeyring(text);
        accepted += 1;
        expect(parseKeyring(serializeKeyring(keyring))).toEqual(keyring);
      } catch (error) {
        rejected += 1;
        expect(error).toBeInstanceOf(KeyringError);
        expect(['malformed-keyring', 'unsupported-version']).toContain(
          (error as KeyringError).code,
        );
      }
    }
    // The fuzz must exercise both outcomes, or it proves nothing.
    expect(rejected).toBeGreaterThan(500);
    expect(accepted).toBeGreaterThan(0);
  });
});
