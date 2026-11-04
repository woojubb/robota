/**
 * A read grant's secret bytes exist in the clear only for the length of one call on each end: the
 * buffer the initiator seals and the buffer the responder decrypts are zero-filled before the call
 * returns, and the read keys own copies of their own. Kept apart because it wraps the AEAD module
 * for the whole file to see those buffers.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const seen = vi.hoisted(() => ({ sealed: [] as Uint8Array[], opened: [] as Uint8Array[] }));

vi.mock('../aead.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../aead.js')>();
  return {
    ...actual,
    gcmEncrypt: (...args: Parameters<typeof actual.gcmEncrypt>) => {
      seen.sealed.push(args[2]);
      return actual.gcmEncrypt(...args);
    },
    gcmDecrypt: (...args: Parameters<typeof actual.gcmDecrypt>) => {
      const plaintext = actual.gcmDecrypt(...args);
      seen.opened.push(plaintext);
      return plaintext;
    },
  };
});

const { createLinkInitiator, createLinkResponder, openOwnerHandover, parseKeyring } =
  await import('../index.js');
const {
  FIXTURE_RECOVERY_KEY,
  KAT_BINDING,
  KNOWN_AUTHORSHIP_MESSAGE,
  KNOWN_AUTHORSHIP_TAG_HEX,
  bytesOf,
  hex,
} = await import('./helpers.js');
const { certifiedRuntime } = await import('./link-helpers.js');

const fixture = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);

describe('the read grant buffers', () => {
  it('are zero-filled on both ends once the grant is sealed and opened', async () => {
    const owner = await openOwnerHandover(fixture, {
      type: 'recoveryKey',
      recoveryKey: FIXTURE_RECOVERY_KEY,
    });
    const identity = certifiedRuntime(owner, KAT_BINDING);
    const initiator = createLinkInitiator({ mode: 'owner', handover: owner });
    const responder = createLinkResponder(identity, KAT_BINDING);
    const { proof, link } = initiator.answer(responder.challenge(initiator.hello()));
    const { link: runtimeSide } = responder.accept(proof);

    seen.sealed.length = 0;
    seen.opened.length = 0;
    const grant = link.sealReadGrant(owner);
    expect(seen.sealed).toHaveLength(1);
    expect(seen.sealed[0]).toHaveLength(65);
    expect(seen.sealed[0]!.every((byte) => byte === 0)).toBe(true);

    const keys = runtimeSide.openReadGrant(grant);
    expect(seen.opened).toHaveLength(1);
    expect(seen.opened[0]).toHaveLength(65);
    expect(seen.opened[0]!.every((byte) => byte === 0)).toBe(true);
    expect(hex(keys.tagAuthorship(bytesOf(KNOWN_AUTHORSHIP_MESSAGE)))).toBe(
      KNOWN_AUTHORSHIP_TAG_HEX,
    );
    keys.lock();
    owner.dispose();
  });
});
