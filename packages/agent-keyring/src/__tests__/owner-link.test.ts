/**
 * The owner link as its two ends use it: a spawner links with its spawner key and learns the
 * binding it then certifies; an owner links with its handover once the runtime is certified; frames
 * flow both ways under the link keys; and the read grant goes only over an owner link, from the
 * handover that opened it, into read keys on the runtime's side.
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createKeyring,
  createLinkInitiator,
  createLinkResponder,
  linkFrameKind,
  openOwnerHandover,
  parseKeyring,
  type IOwnerHandover,
  type IRuntimeIdentity,
  type ILinkBinding,
} from '../index.js';
import {
  FIXTURE_RECOVERY_KEY,
  KAT_BINDING,
  KNOWN_AUTHORSHIP_MESSAGE,
  KNOWN_AUTHORSHIP_TAG_HEX,
  KNOWN_SEALING_PUBLIC_KEY_HEX,
  bytesOf,
  codeOf,
  hex,
} from './helpers.js';
import { certifiedRuntime, refusalOf, spawnedRuntime } from './link-helpers.js';

const fixture = parseKeyring(
  readFileSync(fileURLToPath(new URL('./fixtures/keyring-v1.json', import.meta.url)), 'utf8'),
);
let owner: IOwnerHandover;
let stranger: IOwnerHandover;

beforeAll(async () => {
  owner = await openOwnerHandover(fixture, {
    type: 'recoveryKey',
    recoveryKey: FIXTURE_RECOVERY_KEY,
  });
  const other = await createKeyring({ passphrase: 'a keyring that is not the owner one' });
  stranger = await openOwnerHandover(other.keyring, {
    type: 'recoveryKey',
    recoveryKey: other.recoveryKey,
  });
});

afterAll(() => {
  owner.dispose();
  stranger.dispose();
});

function ownerLink(identity: IRuntimeIdentity, binding: ILinkBinding = KAT_BINDING) {
  const initiator = createLinkInitiator({ mode: 'owner', handover: owner });
  const responder = createLinkResponder(identity, binding);
  const { proof, link } = initiator.answer(responder.challenge(initiator.hello()));
  return { initiatorLink: link, ...responder.accept(proof) };
}

describe('a spawner link', () => {
  it('admits the spawner, teaches it the binding, and lets it certify the runtime', () => {
    const { identity, spawnerKey, instancePublicKey } = spawnedRuntime();
    const initiator = createLinkInitiator({ mode: 'spawner', spawnerKey, instancePublicKey });
    const responder = createLinkResponder(identity, KAT_BINDING);
    const { proof, link } = initiator.answer(responder.challenge(initiator.hello()));
    const accepted = responder.accept(proof);
    expect(accepted.standing).toBe('spawner');
    expect(link.standing).toBe('spawner');
    expect(link.binding).toEqual(KAT_BINDING);
    expect(hex(link.instancePublicKey)).toBe(hex(identity.instancePublicKey));

    // What the spawner learned is authentic, so it is what it certifies.
    identity.installTrustRoot(owner.certify(link.instancePublicKey, link.binding), link.binding);
    spawnerKey.wipe();
    expect(identity.certified).toBe(true);
    expect(ownerLink(identity).standing).toBe('owner');
  });
});

describe('an owner link', () => {
  it('refuses a different selected runtime or generation before producing proof', () => {
    for (const expected of [
      { ...KAT_BINDING, runtimeId: 'another-runtime' },
      { ...KAT_BINDING, generation: 'another-generation' },
    ]) {
      const initiator = createLinkInitiator({ mode: 'owner', handover: owner });
      const responder = createLinkResponder(certifiedRuntime(owner, KAT_BINDING), KAT_BINDING);
      const challenge = responder.challenge(initiator.hello());
      expect(refusalOf(() => initiator.answer(challenge, expected))).toBe('binding-mismatch');
    }
    const initiator = createLinkInitiator({ mode: 'owner', handover: owner });
    const responder = createLinkResponder(certifiedRuntime(owner, KAT_BINDING), KAT_BINDING);
    const { proof } = initiator.answer(responder.challenge(initiator.hello()), KAT_BINDING);
    expect(responder.accept(proof).standing).toBe('owner');
  });

  it('admits the owner of a certified runtime with owner standing', () => {
    const identity = certifiedRuntime(owner, KAT_BINDING);
    const { initiatorLink, link, standing } = ownerLink(identity);
    expect(standing).toBe('owner');
    expect(link.standing).toBe('owner');
    expect(initiatorLink.binding).toEqual(KAT_BINDING);
    expect(hex(initiatorLink.instancePublicKey)).toBe(hex(identity.instancePublicKey));
  });

  it('carries frames both ways, in order, with their kinds', () => {
    const { initiatorLink, link } = ownerLink(certifiedRuntime(owner, KAT_BINDING));
    for (let index = 0; index < 5; index += 1) {
      const up = initiatorLink.seal(index % 2 === 0 ? 'session' : 'owner', bytesOf(`up ${index}`));
      expect(linkFrameKind(up)).toBe(index % 2 === 0 ? 'session' : 'owner');
      const opened = link.open(up);
      expect(opened.kind).toBe(index % 2 === 0 ? 'session' : 'owner');
      expect(Buffer.from(opened.plaintext).toString()).toBe(`up ${index}`);
      const down = link.seal('session', bytesOf(`down ${index}`));
      expect(Buffer.from(initiatorLink.open(down).plaintext).toString()).toBe(`down ${index}`);
    }
    const empty = initiatorLink.seal('owner', new Uint8Array(0));
    expect(link.open(empty).plaintext).toHaveLength(0);
  });

  it('is closed by close(), which ends sealing and opening on that end', () => {
    const { initiatorLink, link } = ownerLink(certifiedRuntime(owner, KAT_BINDING));
    const frame = initiatorLink.seal('session', bytesOf('before'));
    initiatorLink.close();
    expect(initiatorLink.closed).toBe(true);
    expect(codeOf(() => initiatorLink.seal('session', bytesOf('after')))).toBe('link-closed');
    expect(codeOf(() => initiatorLink.open(link.seal('session', bytesOf('x'))))).toBe(
      'link-closed',
    );
    initiatorLink.close();
    expect(Buffer.from(link.open(frame).plaintext).toString()).toBe('before');
  });
});

describe('the read grant', () => {
  it('opens on the runtime into read keys of the owner, never the attach key', () => {
    const { initiatorLink, link } = ownerLink(certifiedRuntime(owner, KAT_BINDING));
    const keys = link.openReadGrant(initiatorLink.sealReadGrant(owner));
    expect(hex(keys.sealing.publicKey)).toBe(KNOWN_SEALING_PUBLIC_KEY_HEX);
    expect(keys.sealing.privateKey.asymmetricKeyType).toBe('x25519');
    expect(hex(keys.tagAuthorship(bytesOf(KNOWN_AUTHORSHIP_MESSAGE)))).toBe(
      KNOWN_AUTHORSHIP_TAG_HEX,
    );
    expect('attach' in keys).toBe(false);
    keys.lock();
    expect(codeOf(() => keys.sealing)).toBe('keys-locked');
  });

  it('is sealed only over an owner link, and only from the handover that opened it', () => {
    const { identity, spawnerKey, instancePublicKey } = spawnedRuntime();
    const initiator = createLinkInitiator({ mode: 'spawner', spawnerKey, instancePublicKey });
    const responder = createLinkResponder(identity, KAT_BINDING);
    const { link } = initiator.answer(responder.challenge(initiator.hello()));
    expect(codeOf(() => link.sealReadGrant(owner))).toBe('invalid-argument');

    const { initiatorLink } = ownerLink(certifiedRuntime(owner, KAT_BINDING));
    expect(codeOf(() => initiatorLink.sealReadGrant(stranger))).toBe('invalid-argument');
  });

  it('is refused by a spawner-standing link, which closes', () => {
    const { identity, spawnerKey, instancePublicKey } = spawnedRuntime();
    const initiator = createLinkInitiator({ mode: 'spawner', spawnerKey, instancePublicKey });
    const responder = createLinkResponder(identity, KAT_BINDING);
    const { proof, link: spawnerSide } = initiator.answer(responder.challenge(initiator.hello()));
    const { link } = responder.accept(proof);
    // A grant-kind frame sealed under the spawner link's own keys still opens nothing.
    const { initiatorLink } = ownerLink(certifiedRuntime(owner, KAT_BINDING));
    const grant = initiatorLink.sealReadGrant(owner);
    expect(codeOf(() => link.openReadGrant(grant))).toBe('invalid-argument');
    expect(link.closed).toBe(true);
    expect(spawnerSide.closed).toBe(false);
  });

  it('is opened only as a grant: open() refuses it, and openReadGrant refuses other kinds', () => {
    const first = ownerLink(certifiedRuntime(owner, KAT_BINDING));
    const grant = first.initiatorLink.sealReadGrant(owner);
    expect(linkFrameKind(grant)).toBe('grant');
    expect(codeOf(() => first.link.open(grant))).toBe('invalid-argument');
    expect(first.link.closed).toBe(true);

    const second = ownerLink(certifiedRuntime(owner, KAT_BINDING));
    expect(
      codeOf(() => second.link.openReadGrant(second.initiatorLink.seal('owner', bytesOf('x')))),
    ).toBe('invalid-argument');
    expect(second.link.closed).toBe(true);
  });
});

describe('steps out of turn', () => {
  it('are refused on both ends, and a spent end stays spent', () => {
    const identity = certifiedRuntime(owner, KAT_BINDING);
    const initiator = createLinkInitiator({ mode: 'owner', handover: owner });
    expect(refusalOf(() => initiator.answer(new Uint8Array(10)))).toBe('out-of-order');
    const hello = initiator.hello();
    expect(refusalOf(() => initiator.hello())).toBe('out-of-order');
    const responder = createLinkResponder(identity, KAT_BINDING);
    expect(refusalOf(() => responder.accept(new Uint8Array(64)))).toBe('out-of-order');
    const challenge = responder.challenge(hello);
    expect(refusalOf(() => responder.challenge(hello))).toBe('out-of-order');
    const { proof } = initiator.answer(challenge);
    expect(refusalOf(() => initiator.answer(challenge))).toBe('out-of-order');
    responder.accept(proof);
    expect(refusalOf(() => responder.accept(proof))).toBe('out-of-order');
  });

  it('refuse a disposed handover or a wiped spawner key before any message', async () => {
    const disposed = await openOwnerHandover(fixture, {
      type: 'recoveryKey',
      recoveryKey: FIXTURE_RECOVERY_KEY,
    });
    disposed.dispose();
    expect(codeOf(() => createLinkInitiator({ mode: 'owner', handover: disposed }))).toBe(
      'keys-locked',
    );
    const { identity, spawnerKey, instancePublicKey } = spawnedRuntime();
    spawnerKey.wipe();
    expect(
      codeOf(() => createLinkInitiator({ mode: 'spawner', spawnerKey, instancePublicKey })),
    ).toBe('keys-locked');
    expect(identity.spawnerKeyHeld).toBe(true);
    expect(codeOf(() => createLinkInitiator({ mode: 'other' } as never))).toBe('invalid-argument');
    expect(codeOf(() => createLinkResponder(identity, { runtimeId: '', generation: 'g' }))).toBe(
      'invalid-argument',
    );
  });
});

describe('linkFrameKind', () => {
  it('names the kind byte and refuses anything that is not a frame', () => {
    expect(refusalOf(() => linkFrameKind(new Uint8Array(0)))).toBe('malformed');
    expect(refusalOf(() => linkFrameKind(Buffer.from([4, ...new Uint8Array(16)])))).toBe(
      'malformed',
    );
    expect(refusalOf(() => linkFrameKind(Buffer.from([1, ...new Uint8Array(15)])))).toBe(
      'malformed',
    );
    expect(linkFrameKind(Buffer.from([3, ...new Uint8Array(16)]))).toBe('grant');
  });
});
