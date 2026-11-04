/**
 * The owner link byte for byte: from fixed keys, ephemerals and nonces, both handshake modes give
 * the pinned hello, challenge, transcript hash, proofs and frame keys, and every frame kind seals to
 * the pinned bytes. The answers were computed outside this package (see `link-helpers.ts`), so a
 * change to any label, field order, length prefix or nonce layout fails here.
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  createLinkResponder,
  openOwnerHandover,
  parseKeyring,
  type IOwnerHandover,
} from '../index.js';
import { createLinkInitiatorWith, deriveFrameKeys, transcriptHash } from '../owner-link.js';
import { createRuntimeIdentityWith } from '../runtime-identity.js';
import { startSpawnerExchangeWith } from '../spawner-exchange.js';
import {
  FIXTURE_RECOVERY_KEY,
  KAT_BINDING,
  KAT_CERTIFICATE_HEX,
  KAT_INSTANCE_PUBLIC_KEY_HEX,
  KAT_INSTANCE_SEED,
  KNOWN_AUTHORSHIP_MESSAGE,
  KNOWN_AUTHORSHIP_TAG_HEX,
  KNOWN_SEALING_PUBLIC_KEY_HEX,
  bytesOf,
  hex,
} from './helpers.js';
import {
  KAT_FRAMES,
  KAT_OWNER_LINK,
  KAT_RUNTIME_EXCHANGE_SEED,
  KAT_SPAWNER_EPHEMERAL_SEED,
  KAT_SPAWNER_LINK,
  fixedEntropy,
} from './link-helpers.js';

const fixture = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);
let owner: IOwnerHandover;

beforeAll(async () => {
  owner = await openOwnerHandover(fixture, {
    type: 'recoveryKey',
    recoveryKey: FIXTURE_RECOVERY_KEY,
  });
});

/** The KAT runtime: fixed instance key, exchange and handshake ephemerals, and handshake nonce. */
function katRuntime(link: typeof KAT_SPAWNER_LINK | typeof KAT_OWNER_LINK) {
  const identity = createRuntimeIdentityWith(
    fixedEntropy(
      [KAT_INSTANCE_SEED, KAT_RUNTIME_EXCHANGE_SEED, link.responderSeed],
      [link.responderNonce],
    ),
  );
  const exchange = startSpawnerExchangeWith(fixedEntropy([KAT_SPAWNER_EPHEMERAL_SEED]));
  const result = exchange.complete(identity.answerSpawnerExchange(exchange.message));
  return { identity, ...result };
}

function spawnerLink() {
  const { identity, spawnerKey, instancePublicKey } = katRuntime(KAT_SPAWNER_LINK);
  const initiator = createLinkInitiatorWith(
    { mode: 'spawner', spawnerKey, instancePublicKey },
    fixedEntropy([KAT_SPAWNER_LINK.initiatorSeed], [KAT_SPAWNER_LINK.initiatorNonce]),
  );
  const responder = createLinkResponder(identity, KAT_BINDING);
  const hello = initiator.hello();
  const challenge = responder.challenge(hello);
  const { proof, link } = initiator.answer(challenge);
  const accepted = responder.accept(proof);
  return { hello, challenge, proof, initiatorLink: link, ...accepted };
}

function ownerLink() {
  const { identity, spawnerKey } = katRuntime(KAT_OWNER_LINK);
  identity.installTrustRoot(owner.certify(identity.instancePublicKey, KAT_BINDING), KAT_BINDING);
  spawnerKey.wipe();
  const initiator = createLinkInitiatorWith(
    { mode: 'owner', handover: owner },
    fixedEntropy([KAT_OWNER_LINK.initiatorSeed], [KAT_OWNER_LINK.initiatorNonce]),
  );
  const responder = createLinkResponder(identity, KAT_BINDING);
  const hello = initiator.hello();
  const challenge = responder.challenge(hello);
  const { proof, link } = initiator.answer(challenge);
  const accepted = responder.accept(proof);
  return { hello, challenge, proof, initiatorLink: link, ...accepted };
}

describe('owner link known answers', () => {
  it('runs the spawner-mode handshake to the pinned bytes', () => {
    const { hello, challenge, proof, standing, initiatorLink } = spawnerLink();
    expect(hex(hello)).toBe(KAT_SPAWNER_LINK.hello);
    expect(hex(challenge)).toBe(KAT_SPAWNER_LINK.challenge);
    expect(hex(proof)).toBe(KAT_SPAWNER_LINK.proof);
    expect(standing).toBe('spawner');
    expect(initiatorLink.binding).toEqual(KAT_BINDING);
    expect(hex(initiatorLink.instancePublicKey)).toBe(KAT_INSTANCE_PUBLIC_KEY_HEX);
  });

  it('runs the owner-mode handshake to the pinned bytes, with the pinned certificate', () => {
    const { hello, challenge, proof, standing, initiatorLink } = ownerLink();
    expect(hex(hello)).toBe(KAT_OWNER_LINK.hello);
    expect(hex(challenge)).toBe(KAT_OWNER_LINK.challenge);
    expect(hex(challenge)).toContain(KAT_CERTIFICATE_HEX);
    expect(hex(proof)).toBe(KAT_OWNER_LINK.proof);
    expect(standing).toBe('owner');
    expect(initiatorLink.binding).toEqual(KAT_BINDING);
  });

  it('hashes the transcript and derives the frame keys as pinned', () => {
    for (const [link, mode, certificate] of [
      [KAT_SPAWNER_LINK, 'spawner', ''],
      [KAT_OWNER_LINK, 'owner', KAT_CERTIFICATE_HEX],
    ] as const) {
      const challenge = Buffer.from(link.challenge, 'hex');
      const hello = Buffer.from(link.hello, 'hex');
      const th = transcriptHash({
        mode,
        initiatorEphemeral: hello.subarray(2, 34),
        initiatorNonce: hello.subarray(34, 66),
        responderEphemeral: challenge.subarray(0, 32),
        responderNonce: challenge.subarray(32, 64),
        instancePublicKey: challenge.subarray(64, 96),
        binding: KAT_BINDING,
        certificate: Buffer.from(certificate, 'hex'),
      });
      expect(hex(th)).toBe(link.transcript);
      const keys = deriveFrameKeys(Buffer.from(link.sharedSecret, 'hex'), th);
      expect(hex(keys.initiatorToResponder)).toBe(link.initiatorToResponder);
      expect(hex(keys.responderToInitiator)).toBe(link.responderToInitiator);
    }
  });

  it('seals one frame of each kind to the pinned bytes, and opens them on the other end', () => {
    const spawner = spawnerLink();
    const session = spawner.initiatorLink.seal('session', bytesOf(KAT_FRAMES.session.plaintext));
    const ownerFrame = spawner.initiatorLink.seal('owner', bytesOf(KAT_FRAMES.owner.plaintext));
    const reply = spawner.link.seal('owner', bytesOf(KAT_FRAMES.ownerReply.plaintext));
    expect(hex(session)).toBe(KAT_FRAMES.session.sealed);
    expect(hex(ownerFrame)).toBe(KAT_FRAMES.owner.sealed);
    expect(hex(reply)).toBe(KAT_FRAMES.ownerReply.sealed);
    expect(spawner.link.open(session)).toMatchObject({ kind: 'session' });
    expect(Buffer.from(spawner.link.open(ownerFrame).plaintext).toString()).toBe(
      KAT_FRAMES.owner.plaintext,
    );
    expect(Buffer.from(spawner.initiatorLink.open(reply).plaintext).toString()).toBe(
      KAT_FRAMES.ownerReply.plaintext,
    );

    const ownerSide = ownerLink();
    const grant = ownerSide.initiatorLink.sealReadGrant(owner);
    expect(hex(grant)).toBe(KAT_FRAMES.grant.sealed);
    const keys = ownerSide.link.openReadGrant(grant);
    expect(hex(keys.sealing.publicKey)).toBe(KNOWN_SEALING_PUBLIC_KEY_HEX);
    expect(hex(keys.tagAuthorship(bytesOf(KNOWN_AUTHORSHIP_MESSAGE)))).toBe(
      KNOWN_AUTHORSHIP_TAG_HEX,
    );
    keys.lock();
  });
});
