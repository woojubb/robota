/**
 * The owner link against the programs it exists to refuse: a squatter on the control socket, a
 * runtime nobody certified or another keyring certified, a stolen certificate, a rewritten mode, a
 * replayed or spliced message and tampered frames. Challenges are built here by hand from the
 * protocol description (a positive control shows the builder is right when it holds every secret),
 * so each refusal is the one missing secret. In every case the initiator has sent only its hello,
 * which is checked to be nothing but fresh randomness, and it can never be made to send more.
 */
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createKeyring,
  createLinkResponder,
  openOwnerHandover,
  parseKeyring,
  type ILinkBinding,
  type IOwnerHandover,
  type IRuntimeIdentity,
  type SpawnerKey,
  type TLinkInitiatorAuth,
  type TLinkRefusalReason,
} from '../index.js';
import { createLinkInitiatorWith } from '../owner-link.js';
import { createRuntimeIdentityWith } from '../runtime-identity.js';
import { spawnerKeyBytes } from '../spawner-exchange.js';
import {
  FIXTURE_RECOVERY_KEY,
  KAT_BINDING,
  bytesOf,
  codeOf,
  hex,
  lengthPrefixed,
  tamper,
} from './helpers.js';
import {
  KAT_OWNER_LINK,
  certifiedRuntime,
  fixedEntropy,
  katOwnerLink,
  refusalOf,
  spawnedRuntime,
} from './link-helpers.js';

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
  const other = await createKeyring({ passphrase: 'a keyring another program made' });
  stranger = await openOwnerHandover(other.keyring, {
    type: 'recoveryKey',
    recoveryKey: other.recoveryKey,
  });
});

afterAll(() => {
  owner.dispose();
  stranger.dispose();
});

// ── The protocol, written out here from its description ─────────────────────────────────────────

const MODE_BYTE = { spawner: 1, owner: 2 } as const;
type TMode = keyof typeof MODE_BYTE;

function edPrivate(seed: Uint8Array) {
  return createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
}
function rawPublic(seed: Uint8Array, prefix: string): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from(prefix, 'hex'), seed]),
    format: 'der',
    type: 'pkcs8',
  });
  return createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(12);
}
const edPublic = (seed: Uint8Array): Buffer => rawPublic(seed, '302e020100300506032b657004220420');
const xPublic = (seed: Uint8Array): Buffer => rawPublic(seed, '302e020100300506032b656e04220420');

function transcript(
  mode: TMode,
  hello: Uint8Array,
  responderEphemeral: Uint8Array,
  responderNonce: Uint8Array,
  instance: Uint8Array,
  binding: ILinkBinding,
  certificate: Uint8Array,
): Buffer {
  return createHash('sha256')
    .update(
      lengthPrefixed(
        bytesOf('robota/link/v1/handshake'),
        Buffer.from([MODE_BYTE[mode]]),
        hello.subarray(2, 34),
        hello.subarray(34, 66),
        responderEphemeral,
        responderNonce,
        instance,
        bytesOf(binding.runtimeId),
        bytesOf(binding.generation),
        certificate,
      ),
    )
    .digest();
}

interface ISquatter {
  /** The mode the hello claims, which is the one the squatter answers in. */
  readonly mode: TMode;
  /** The instance key it presents. */
  readonly instance: Uint8Array;
  /** The seed it signs with: the real instance's only for a positive control. */
  readonly signingSeed: Uint8Array;
  /** The spawner key it believes in (spawner mode). */
  readonly spawnerKey?: Uint8Array;
  readonly binding?: ILinkBinding;
  readonly certificate?: Uint8Array;
  /** The mode its transcript hash names, when it differs from the one it answers in. */
  readonly transcriptMode?: TMode;
  /** The ephemeral it shows, when it is not a fresh key. */
  readonly responderEphemeral?: Uint8Array;
}

/** A challenge for `hello` built from whatever `squatter` holds. */
function squatterChallenge(hello: Uint8Array, squatter: ISquatter): Buffer {
  const responderEphemeral = squatter.responderEphemeral ?? xPublic(randomBytes(32));
  const responderNonce = randomBytes(32);
  const binding = squatter.binding ?? KAT_BINDING;
  const certificate = squatter.certificate ?? new Uint8Array(0);
  const th = transcript(
    squatter.transcriptMode ?? squatter.mode,
    hello,
    responderEphemeral,
    responderNonce,
    squatter.instance,
    binding,
    certificate,
  );
  const signature = sign(null, Buffer.concat([bytesOf('r'), th]), edPrivate(squatter.signingSeed));
  const authR =
    squatter.mode === 'spawner'
      ? Buffer.concat([
          createHmac('sha256', squatter.spawnerKey ?? randomBytes(32))
            .update(Buffer.concat([bytesOf('r'), th]))
            .digest(),
          signature,
        ])
      : signature;
  return Buffer.concat([
    responderEphemeral,
    responderNonce,
    squatter.instance,
    lengthPrefixed(bytesOf(binding.runtimeId), bytesOf(binding.generation), certificate),
    authR,
  ]);
}

/** An initiator whose hello is checked to carry only the fresh ephemeral and nonce it drew. */
function observedInitiator(auth: TLinkInitiatorAuth) {
  const seed = randomBytes(32);
  const nonce = randomBytes(32);
  const initiator = createLinkInitiatorWith(auth, fixedEntropy([seed], [nonce]));
  const hello = initiator.hello();
  expect(hex(hello)).toBe(
    hex(Buffer.concat([Buffer.from([1, MODE_BYTE[auth.mode]]), xPublic(seed), nonce])),
  );
  return { initiator, hello };
}

/** Refused with `reason`, without a proof, and spent: nothing later makes it send one. */
function expectRefused(
  initiator: ReturnType<typeof observedInitiator>['initiator'],
  challenge: Uint8Array,
  reason: TLinkRefusalReason,
): void {
  expect(refusalOf(() => initiator.answer(challenge))).toBe(reason);
  expect(refusalOf(() => initiator.answer(challenge))).toBe('out-of-order');
}

/** A spawned runtime whose instance seed this test knows, for the positive controls. */
function knownRuntime() {
  const instanceSeed = randomBytes(32);
  const identity = createRuntimeIdentityWith(
    fixedEntropy(
      [instanceSeed, randomBytes(32), randomBytes(32), randomBytes(32)],
      [randomBytes(32), randomBytes(32)],
    ),
  );
  return { instanceSeed, ...spawnedRuntime(identity) };
}

function spawnerAuth(runtime: {
  readonly spawnerKey: SpawnerKey;
  readonly instancePublicKey: Uint8Array;
}): TLinkInitiatorAuth {
  return {
    mode: 'spawner',
    spawnerKey: runtime.spawnerKey,
    instancePublicKey: runtime.instancePublicKey,
  };
}

const OWNER_AUTH = (): TLinkInitiatorAuth => ({ mode: 'owner', handover: owner });

// ── Spawner mode ─────────────────────────────────────────────────────────────────────────────────

describe('a spawner-mode squatter', () => {
  it('positive control: a challenge built here with every secret is accepted', () => {
    const runtime = knownRuntime();
    const { initiator, hello } = observedInitiator(spawnerAuth(runtime));
    const challenge = squatterChallenge(hello, {
      mode: 'spawner',
      instance: runtime.instancePublicKey,
      signingSeed: runtime.instanceSeed,
      spawnerKey: spawnerKeyBytes(runtime.spawnerKey),
    });
    expect(initiator.answer(challenge).proof).toHaveLength(32);
  });

  it('without the spawner key is refused, whatever instance key it shows', () => {
    const runtime = knownRuntime();
    const ownSeed = randomBytes(32);
    const first = observedInitiator(spawnerAuth(runtime));
    expectRefused(
      first.initiator,
      squatterChallenge(first.hello, {
        mode: 'spawner',
        instance: edPublic(ownSeed),
        signingSeed: ownSeed,
      }),
      'instance-mismatch',
    );
    const second = observedInitiator(spawnerAuth(runtime));
    expectRefused(
      second.initiator,
      squatterChallenge(second.hello, {
        mode: 'spawner',
        instance: runtime.instancePublicKey,
        signingSeed: runtime.instanceSeed,
      }),
      'bad-runtime-proof',
    );
  });

  it('with the spawner key but not the instance key is refused', () => {
    const runtime = knownRuntime();
    const { initiator, hello } = observedInitiator(spawnerAuth(runtime));
    expectRefused(
      initiator,
      squatterChallenge(hello, {
        mode: 'spawner',
        instance: runtime.instancePublicKey,
        signingSeed: randomBytes(32),
        spawnerKey: spawnerKeyBytes(runtime.spawnerKey),
      }),
      'bad-runtime-proof',
    );
  });

  it('is refused at the responder too: a spawner hello without the spawner key gets no challenge', () => {
    const identity = createRuntimeIdentityWith(fixedEntropy([randomBytes(32)]));
    const runtime = spawnedRuntime();
    const { hello } = observedInitiator(spawnerAuth(runtime));
    expect(refusalOf(() => createLinkResponder(identity, KAT_BINDING).challenge(hello))).toBe(
      'spawner-unavailable',
    );
  });
});

describe('spawner mode after installTrustRoot', () => {
  it('is refused: the spawner key is gone, even for a handshake already under way', () => {
    const runtime = spawnedRuntime();
    const pending = observedInitiator(spawnerAuth(runtime));
    const pendingResponder = createLinkResponder(runtime.identity, KAT_BINDING);
    const { proof } = pending.initiator.answer(pendingResponder.challenge(pending.hello));

    runtime.identity.installTrustRoot(
      owner.certify(runtime.identity.instancePublicKey, KAT_BINDING),
      KAT_BINDING,
    );
    expect(refusalOf(() => pendingResponder.accept(proof))).toBe('spawner-unavailable');
    const later = observedInitiator(spawnerAuth(runtime));
    expect(
      refusalOf(() => createLinkResponder(runtime.identity, KAT_BINDING).challenge(later.hello)),
    ).toBe('spawner-unavailable');
  });
});

// ── Owner mode ───────────────────────────────────────────────────────────────────────────────────

describe('an owner-mode runtime that is not the owner’s', () => {
  it('positive control: a challenge built here with the instance key and its certificate is accepted', () => {
    const runtime = knownRuntime();
    const { initiator, hello } = observedInitiator(OWNER_AUTH());
    const challenge = squatterChallenge(hello, {
      mode: 'owner',
      instance: runtime.instancePublicKey,
      signingSeed: runtime.instanceSeed,
      certificate: owner.certify(runtime.instancePublicKey, KAT_BINDING).certificate,
    });
    expect(initiator.answer(challenge).proof).toHaveLength(64);
  });

  it('is refused when uncertified: the runtime gives an owner hello no challenge', () => {
    const runtime = spawnedRuntime();
    const { hello } = observedInitiator(OWNER_AUTH());
    expect(
      refusalOf(() => createLinkResponder(runtime.identity, KAT_BINDING).challenge(hello)),
    ).toBe('not-certified');
  });

  it('is refused when it shows no certificate the owner made', () => {
    const ownSeed = randomBytes(32);
    const { initiator, hello } = observedInitiator(OWNER_AUTH());
    expectRefused(
      initiator,
      squatterChallenge(hello, {
        mode: 'owner',
        instance: edPublic(ownSeed),
        signingSeed: ownSeed,
        certificate: randomBytes(64),
      }),
      'certificate-mismatch',
    );
  });

  it('is refused when another keyring certified it', () => {
    const identity = certifiedRuntime(stranger, KAT_BINDING);
    const { initiator, hello } = observedInitiator(OWNER_AUTH());
    expectRefused(
      initiator,
      createLinkResponder(identity, KAT_BINDING).challenge(hello),
      'certificate-mismatch',
    );
  });

  it('is refused when it shows the owner’s certificate of another instance or another start', () => {
    const runtime = knownRuntime();
    const stolen = owner.certify(runtime.instancePublicKey, KAT_BINDING).certificate;
    const ownSeed = randomBytes(32);
    const otherInstance = observedInitiator(OWNER_AUTH());
    expectRefused(
      otherInstance.initiator,
      squatterChallenge(otherInstance.hello, {
        mode: 'owner',
        instance: edPublic(ownSeed),
        signingSeed: ownSeed,
        certificate: stolen,
      }),
      'certificate-mismatch',
    );
    const otherStart = observedInitiator(OWNER_AUTH());
    expectRefused(
      otherStart.initiator,
      squatterChallenge(otherStart.hello, {
        mode: 'owner',
        instance: runtime.instancePublicKey,
        signingSeed: runtime.instanceSeed,
        certificate: stolen,
        binding: { ...KAT_BINDING, generation: 'a-later-start' },
      }),
      'certificate-mismatch',
    );
  });

  it('is refused when it shows a valid certificate without the instance key', () => {
    const runtime = knownRuntime();
    const { initiator, hello } = observedInitiator(OWNER_AUTH());
    expectRefused(
      initiator,
      squatterChallenge(hello, {
        mode: 'owner',
        instance: runtime.instancePublicKey,
        signingSeed: randomBytes(32),
        certificate: owner.certify(runtime.instancePublicKey, KAT_BINDING).certificate,
      }),
      'bad-runtime-proof',
    );
  });

  it('is refused by the runtime itself for a binding it was not certified for', () => {
    const identity = certifiedRuntime(owner, KAT_BINDING);
    const { hello } = observedInitiator(OWNER_AUTH());
    expect(
      refusalOf(() =>
        createLinkResponder(identity, { ...KAT_BINDING, generation: 'other' }).challenge(hello),
      ),
    ).toBe('not-certified');
  });
});

describe('a rewritten mode', () => {
  it('owner to spawner: the spawner-shaped answer is refused before any proof', () => {
    const runtime = spawnedRuntime();
    const { initiator, hello } = observedInitiator(OWNER_AUTH());
    const rewritten = Buffer.from(hello);
    rewritten[1] = MODE_BYTE.spawner;
    expectRefused(
      initiator,
      createLinkResponder(runtime.identity, KAT_BINDING).challenge(rewritten),
      'malformed',
    );
  });

  it('spawner to owner: the owner-shaped answer is refused before any proof', () => {
    const runtime = spawnedRuntime();
    const certified = certifiedRuntime(owner, KAT_BINDING);
    const { initiator, hello } = observedInitiator(spawnerAuth(runtime));
    const rewritten = Buffer.from(hello);
    rewritten[1] = MODE_BYTE.owner;
    expectRefused(
      initiator,
      createLinkResponder(certified, KAT_BINDING).challenge(rewritten),
      'malformed',
    );
  });

  it('is bound into the transcript: a well-shaped answer proving the other mode is refused', () => {
    const runtime = knownRuntime();
    const { initiator, hello } = observedInitiator(OWNER_AUTH());
    expectRefused(
      initiator,
      squatterChallenge(hello, {
        mode: 'owner',
        transcriptMode: 'spawner',
        instance: runtime.instancePublicKey,
        signingSeed: runtime.instanceSeed,
        certificate: owner.certify(runtime.instancePublicKey, KAT_BINDING).certificate,
      }),
      'bad-runtime-proof',
    );
  });
});

describe('replay and splicing', () => {
  function runtimes(): Array<{ auth: () => TLinkInitiatorAuth; identity: IRuntimeIdentity }> {
    const spawned = spawnedRuntime();
    return [
      { auth: () => spawnerAuth(spawned), identity: spawned.identity },
      { auth: OWNER_AUTH, identity: certifiedRuntime(owner, KAT_BINDING) },
    ];
  }

  it('refuses a challenge replayed into another link', () => {
    for (const { auth, identity } of runtimes()) {
      const first = observedInitiator(auth());
      const recorded = createLinkResponder(identity, KAT_BINDING).challenge(first.hello);
      first.initiator.answer(recorded);
      const second = observedInitiator(auth());
      expectRefused(second.initiator, recorded, 'bad-runtime-proof');
    }
  });

  it('refuses a proof replayed into another link, even for the same hello', () => {
    for (const { auth, identity } of runtimes()) {
      const first = observedInitiator(auth());
      const { proof } = first.initiator.answer(
        createLinkResponder(identity, KAT_BINDING).challenge(first.hello),
      );
      const replayed = createLinkResponder(identity, KAT_BINDING);
      replayed.challenge(first.hello);
      expect(refusalOf(() => replayed.accept(proof))).toBe('bad-proof');
    }
  });

  it('refuses messages spliced between two links under way at once', () => {
    for (const { auth, identity } of runtimes()) {
      const a = observedInitiator(auth());
      const b = observedInitiator(auth());
      const responderA = createLinkResponder(identity, KAT_BINDING);
      const responderB = createLinkResponder(identity, KAT_BINDING);
      const challengeA = responderA.challenge(a.hello);
      const challengeB = responderB.challenge(b.hello);
      expectRefused(a.initiator, challengeB, 'bad-runtime-proof');
      const { proof } = b.initiator.answer(challengeB);
      expect(refusalOf(() => responderA.accept(proof))).toBe('bad-proof');
      expect(challengeA).not.toEqual(challengeB);
    }
  });
});

// ── Malformed and oversized messages ─────────────────────────────────────────────────────────────

describe('malformed messages', () => {
  it('are refused as hellos', () => {
    const runtime = spawnedRuntime();
    const { hello } = observedInitiator(spawnerAuth(runtime));
    const withByte = (index: number, value: number): Buffer => {
      const copy = Buffer.from(hello);
      copy[index] = value;
      return copy;
    };
    for (const bad of [
      new Uint8Array(0),
      hello.subarray(0, 65),
      Buffer.concat([hello, Buffer.from([0])]),
      withByte(0, 2),
      withByte(0, 0),
      withByte(1, 0),
      withByte(1, 3),
      Buffer.concat([hello.subarray(0, 2), Buffer.alloc(32), hello.subarray(34)]),
      'hello' as never,
    ]) {
      expect(
        refusalOf(() => createLinkResponder(runtime.identity, KAT_BINDING).challenge(bad)),
      ).toBe('malformed');
    }
  });

  it('are refused as challenges, before any proof', () => {
    const runtime = knownRuntime();
    const good = (hello: Uint8Array, patch: Partial<ISquatter> = {}): Buffer =>
      squatterChallenge(hello, {
        mode: 'spawner',
        instance: runtime.instancePublicKey,
        signingSeed: runtime.instanceSeed,
        spawnerKey: spawnerKeyBytes(runtime.spawnerKey),
        ...patch,
      });
    const variants: Array<(hello: Uint8Array) => Uint8Array> = [
      (hello) => good(hello).subarray(0, good(hello).length - 1),
      (hello) => Buffer.concat([good(hello), Buffer.from([0])]),
      (hello) => good(hello, { binding: { runtimeId: 'r'.repeat(129), generation: 'g' } }),
      (hello) => good(hello, { binding: { runtimeId: 'a b', generation: 'g' } }),
      (hello) => good(hello, { binding: { runtimeId: 'ré', generation: 'g' } }),
      (hello) => good(hello, { binding: { runtimeId: 'r', generation: '' } }),
      (hello) => good(hello, { certificate: randomBytes(64) }),
      (hello) => {
        const challenge = good(hello);
        challenge.writeUInt16BE(0xffff, 96);
        return challenge;
      },
      (hello) => good(hello, { responderEphemeral: Buffer.alloc(32) }),
      () => new Uint8Array(0),
      () => 'challenge' as never,
    ];
    for (const variant of variants) {
      const { initiator, hello } = observedInitiator(spawnerAuth(runtime));
      expectRefused(initiator, variant(hello), 'malformed');
    }
    for (const certificate of [new Uint8Array(0), randomBytes(63), randomBytes(65)]) {
      const { initiator, hello } = observedInitiator(OWNER_AUTH());
      const challenge = squatterChallenge(hello, {
        mode: 'owner',
        instance: runtime.instancePublicKey,
        signingSeed: runtime.instanceSeed,
        certificate,
      });
      expectRefused(initiator, challenge, 'malformed');
    }
  });

  it('are refused as proofs', () => {
    for (const length of [0, 31, 33]) {
      const runtime = spawnedRuntime();
      const { hello } = observedInitiator(spawnerAuth(runtime));
      const responder = createLinkResponder(runtime.identity, KAT_BINDING);
      responder.challenge(hello);
      expect(refusalOf(() => responder.accept(randomBytes(length)))).toBe('malformed');
    }
    for (const length of [32, 63, 65]) {
      const identity = certifiedRuntime(owner, KAT_BINDING);
      const { hello } = observedInitiator(OWNER_AUTH());
      const responder = createLinkResponder(identity, KAT_BINDING);
      responder.challenge(hello);
      expect(refusalOf(() => responder.accept(randomBytes(length)))).toBe('malformed');
    }
  });
});

// ── Frames ───────────────────────────────────────────────────────────────────────────────────────

function establishedPair() {
  const identity = certifiedRuntime(owner, KAT_BINDING);
  const { initiator, hello } = observedInitiator(OWNER_AUTH());
  const responder = createLinkResponder(identity, KAT_BINDING);
  const { proof, link } = initiator.answer(responder.challenge(hello));
  return { initiatorLink: link, responderLink: responder.accept(proof).link };
}

describe('frames', () => {
  it('refuse any changed byte, and the link closes', () => {
    const { initiatorLink } = establishedPair();
    const frame = initiatorLink.seal('session', bytesOf('{"type":"submit","text":"hi"}'));
    for (let index = 0; index < frame.length; index += 1) {
      const { initiatorLink: sender, responderLink } = establishedPair();
      const sealed = sender.seal('session', bytesOf('{"type":"submit","text":"hi"}'));
      expect(['decryption-failed', 'link-refused']).toContain(
        codeOf(() => responderLink.open(tamper(sealed, index))),
      );
      expect(responderLink.closed).toBe(true);
      expect(codeOf(() => responderLink.open(sealed))).toBe('link-closed');
    }
    // A changed kind byte to another valid kind is still refused: the kind is in the AAD.
    const { initiatorLink: sender, responderLink } = establishedPair();
    const sealed = sender.seal('session', bytesOf('x'));
    const relabelled = Buffer.from(sealed);
    relabelled[0] = 2;
    expect(codeOf(() => responderLink.open(relabelled))).toBe('decryption-failed');
  });

  it('refuse a replayed frame', () => {
    const { initiatorLink, responderLink } = establishedPair();
    const frame = initiatorLink.seal('owner', bytesOf('once'));
    responderLink.open(frame);
    expect(codeOf(() => responderLink.open(frame))).toBe('decryption-failed');
    expect(responderLink.closed).toBe(true);
  });

  it('refuse frames out of order', () => {
    const { initiatorLink, responderLink } = establishedPair();
    initiatorLink.seal('session', bytesOf('first'));
    const second = initiatorLink.seal('session', bytesOf('second'));
    expect(codeOf(() => responderLink.open(second))).toBe('decryption-failed');
  });

  it('refuse a frame sent back the way it came', () => {
    const { initiatorLink, responderLink } = establishedPair();
    const up = initiatorLink.seal('session', bytesOf('up'));
    expect(codeOf(() => initiatorLink.open(up))).toBe('decryption-failed');
    const down = responderLink.seal('session', bytesOf('down'));
    expect(codeOf(() => responderLink.open(down))).toBe('decryption-failed');
  });

  it('refuse a frame from another link', () => {
    const first = establishedPair();
    const second = establishedPair();
    expect(
      codeOf(() => second.responderLink.open(first.initiatorLink.seal('session', bytesOf('x')))),
    ).toBe('decryption-failed');
  });

  it('refuse to seal more than the frame bound, or a kind that is not one', () => {
    const { initiatorLink } = establishedPair();
    expect(codeOf(() => initiatorLink.seal('session', new Uint8Array(16 * 1024 * 1024 + 1)))).toBe(
      'invalid-argument',
    );
    expect(codeOf(() => initiatorLink.seal('grant' as never, bytesOf('x')))).toBe(
      'invalid-argument',
    );
    expect(codeOf(() => initiatorLink.seal('session', 'text' as never))).toBe('invalid-argument');
    expect(initiatorLink.closed).toBe(false);
  });
});

describe('a read grant', () => {
  it('opens once: the same grant again is refused and closes the link', () => {
    const { initiatorLink, responderLink } = establishedPair();
    const grant = initiatorLink.sealReadGrant(owner);
    responderLink.openReadGrant(grant).lock();
    expect(codeOf(() => responderLink.openReadGrant(grant))).toBe('decryption-failed');
    expect(responderLink.closed).toBe(true);
  });

  it('refuses a grant cut short: it does not authenticate', () => {
    const { initiatorLink, responderLink } = establishedPair();
    const grant = initiatorLink.sealReadGrant(owner);
    expect(codeOf(() => responderLink.openReadGrant(grant.subarray(0, grant.length - 1)))).toBe(
      'decryption-failed',
    );
  });

  describe('sealed by hand under the key of a known link', () => {
    /** A grant-kind frame as the initiator would seal it (counter 0), but around any content. */
    const sealGrantContent = (content: Uint8Array): Buffer => {
      const key = Buffer.from(KAT_OWNER_LINK.initiatorToResponder, 'hex');
      const cipher = createCipheriv('aes-256-gcm', key, Buffer.alloc(12), { authTagLength: 16 });
      cipher.setAAD(Buffer.from([1, 3]));
      const body = Buffer.concat([cipher.update(content), cipher.final()]);
      return Buffer.concat([Buffer.from([3]), body, cipher.getAuthTag()]);
    };
    const content = (version: number, length: number): Buffer =>
      Buffer.concat([Buffer.from([version]), randomBytes(length - 1)]);

    it('opens content of exactly the right shape, so the builder is right', () => {
      const { link } = katOwnerLink(owner);
      link.openReadGrant(sealGrantContent(content(1, 65))).lock();
      expect(link.closed).toBe(false);
    });

    it('refuses authentic content that is not a grant: the wrong length or the wrong version', () => {
      for (const wrong of [content(1, 64), content(1, 66), content(2, 65)]) {
        const { link } = katOwnerLink(owner);
        expect(refusalOf(() => link.openReadGrant(sealGrantContent(wrong)))).toBe('malformed');
        expect(link.closed).toBe(true);
      }
    });
  });
});
