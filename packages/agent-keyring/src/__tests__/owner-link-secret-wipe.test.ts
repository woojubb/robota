/**
 * Secrets that live only for part of a handshake are zero-filled when that part ends: the responder
 * wipes the frame keys it derived and the proof it expected when the proof it gets is refused (and
 * the expected proof once it is accepted), and the spawner wipes the shared secret of the exchange
 * once the spawner key is derived. Kept apart because it wraps the link primitives for the whole file
 * to see the buffers they hand out; the frame keys are copies made inside the derivation, so those
 * are found by their known values among what the derivation allocates.
 */
import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

type TSecret = { readonly before: Uint8Array; readonly live: Uint8Array };

const seen = vi.hoisted(() => ({ agreed: [] as TSecret[], macs: [] as TSecret[] }));

vi.mock('../link-primitives.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../link-primitives.js')>();
  return {
    ...actual,
    agree: (...args: Parameters<typeof actual.agree>) => {
      const shared = actual.agree(...args);
      seen.agreed.push({ before: Uint8Array.from(shared), live: shared });
      return shared;
    },
    hmac: (...args: Parameters<typeof actual.hmac>) => {
      const mac = actual.hmac(...args);
      seen.macs.push({ before: Uint8Array.from(mac), live: mac });
      return mac;
    },
  };
});

const { createLinkResponder, createRuntimeIdentity, startSpawnerExchange } =
  await import('../index.js');
const { createLinkInitiatorWith } = await import('../owner-link.js');
const { KAT_BINDING, hex } = await import('./helpers.js');
const { KAT_SPAWNER_LINK, fixedEntropy, katRuntime, refusalOf } = await import('./link-helpers.js');

const isZero = (bytes: Uint8Array): boolean => bytes.every((byte) => byte === 0);

/** Every buffer `Buffer.from` makes while `run` runs. */
function buffersMadeBy(run: () => void): Buffer[] {
  const original = Buffer.from.bind(Buffer) as (...args: unknown[]) => Buffer;
  const made: Buffer[] = [];
  const spy = vi.spyOn(Buffer, 'from').mockImplementation(((...args: unknown[]) => {
    const buffer = original(...args);
    made.push(buffer);
    return buffer;
  }) as typeof Buffer.from);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return made;
}

/** The KAT spawner-mode responder that has answered the KAT hello, and what it is holding for the proof. */
function answeredResponder() {
  const { identity, spawnerKey, instancePublicKey } = katRuntime(KAT_SPAWNER_LINK);
  const initiator = createLinkInitiatorWith(
    { mode: 'spawner', spawnerKey, instancePublicKey },
    fixedEntropy([KAT_SPAWNER_LINK.initiatorSeed], [KAT_SPAWNER_LINK.initiatorNonce]),
  );
  const responder = createLinkResponder(identity, KAT_BINDING);
  const hello = initiator.hello();
  const macsBefore = seen.macs.length;
  const made = buffersMadeBy(() => responder.challenge(hello));
  const frameKeys = [KAT_SPAWNER_LINK.initiatorToResponder, KAT_SPAWNER_LINK.responderToInitiator].map(
    (known) => made.find((buffer) => hex(buffer) === known),
  );
  const expectedProof = seen.macs
    .slice(macsBefore)
    .find((mac) => hex(mac.before) === KAT_SPAWNER_LINK.proof);
  return { responder, frameKeys, expectedProof: expectedProof?.live };
}

describe('the responder, once the proof it waited for has come', () => {
  it('wipes the frame keys and the expected proof when it refuses the proof', () => {
    const { responder, frameKeys, expectedProof } = answeredResponder();
    const held = [...frameKeys, expectedProof];
    expect(held.every((secret) => secret !== undefined && !isZero(secret))).toBe(true);

    expect(refusalOf(() => responder.accept(Buffer.alloc(32, 7)))).toBe('bad-proof');
    for (const secret of held) expect(isZero(secret!)).toBe(true);
  });

  it('wipes the expected proof, and not the frame keys the link now owns, when it accepts it', () => {
    const { responder, frameKeys, expectedProof } = answeredResponder();
    expect(expectedProof).toBeDefined();
    expect(isZero(expectedProof!)).toBe(false);

    const proof = Buffer.from(KAT_SPAWNER_LINK.proof, 'hex');
    const { link } = responder.accept(proof);
    expect(isZero(expectedProof!)).toBe(true);
    expect(frameKeys.every((key) => key !== undefined && !isZero(key))).toBe(true);
    link.close();
  });
});

describe('the spawner exchange', () => {
  it('wipes the shared secret once the spawner key is derived', () => {
    const identity = createRuntimeIdentity();
    const exchange = startSpawnerExchange();
    const reply = identity.answerSpawnerExchange(exchange.message);
    const agreedBefore = seen.agreed.length;

    const { spawnerKey } = exchange.complete(reply);
    const secrets = seen.agreed.slice(agreedBefore);
    expect(secrets).toHaveLength(1);
    expect(isZero(secrets[0]!.before)).toBe(false);
    expect(isZero(secrets[0]!.live)).toBe(true);
    spawnerKey.wipe();
  });
});
