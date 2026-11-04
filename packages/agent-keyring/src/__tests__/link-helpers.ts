/**
 * Shared pieces of the owner-link tests: entropy that hands out fixed values in order, so a whole
 * exchange or handshake reproduces byte for byte, and the known answers those fixed values give.
 * The answers were computed outside this package (`hashlib`/`hmac` in Python for SHA-256, HMAC and
 * HKDF; the openssl CLI for X25519 and Ed25519), never by the code under test.
 */
import { Buffer } from 'node:buffer';

import {
  LinkRefusedError,
  createRuntimeIdentity,
  startSpawnerExchange,
  type ILinkBinding,
  type IOwnerHandover,
  type IRuntimeIdentity,
  type SpawnerKey,
  type TLinkRefusalReason,
} from '../index.js';
import type { ILinkEntropy } from '../link-entropy.js';

/** 32 bytes counting up from `start`, wrapping at 0xff. */
export function sequence(start: number): Buffer {
  return Buffer.from(Array.from({ length: 32 }, (_, i) => (start + i) & 0xff));
}

/** Entropy that hands out `seeds` and `nonces` in order and fails loudly when one more is asked. */
export function fixedEntropy(
  seeds: readonly Uint8Array[],
  nonces: readonly Uint8Array[] = [],
): ILinkEntropy {
  const pendingSeeds = [...seeds];
  const pendingNonces = [...nonces];
  return {
    seed: () => {
      const next = pendingSeeds.shift();
      if (next === undefined) throw new Error('The test entropy has no seed left.');
      return Buffer.from(next);
    },
    nonce: () => {
      const next = pendingNonces.shift();
      if (next === undefined) throw new Error('The test entropy has no nonce left.');
      return Buffer.from(next);
    },
  };
}

/** The reason of the LinkRefusedError a call throws; anything else (or nothing) fails the test. */
export function refusalOf(call: () => unknown): TLinkRefusalReason {
  try {
    call();
  } catch (error) {
    if (error instanceof LinkRefusedError) return error.reason;
    throw error;
  }
  throw new Error('Expected a LinkRefusedError but nothing was thrown.');
}

export const KAT_SPAWNER_EPHEMERAL_SEED = sequence(0x60);
export const KAT_RUNTIME_EXCHANGE_SEED = sequence(0x80);
export const KAT_EXCHANGE = {
  spawnerEphemeral: '675dd574ed7789310b3d2e7681f3790b466c773b1521fecf36577958371ea52f',
  runtimeEphemeral: '493e82fc74464a59268817623d2053c5eb8e2cc4a988b4fee179ec6b010d531d',
  spawnerKey: 'e8d7dcca8e52899522ec48f0bd50f0734bc8627b140585247d9d1b91ba68c653',
} as const;

/** The handshake known answers: one spawner-mode link and one owner-mode link, from fixed values. */
export const KAT_SPAWNER_LINK = {
  initiatorSeed: sequence(0xa0),
  initiatorNonce: sequence(0xc0),
  responderSeed: sequence(0xe0),
  responderNonce: sequence(0x20),
  hello:
    '0101605a725d2a4adfeeb1a29e17edd621c1b7593ee8cdbc44ac6c4ab6e2f805d23c' +
    'c0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedf',
  challenge:
    '736845d54e87de09d6bb114aa7042c50a4a015bd9901d1a0026f5956533a1519' +
    '202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f' +
    '2543b92ff1095511476adc8369db6ddc933665a11978dda1404ee1066ca9559d' +
    '002436663163326433652d346235612d346336642d386539662d306131623263336434653566' +
    '001641414543417751464267634943516f4c4441304f4477' +
    '0000' +
    '5cd5b97e480b37dd79b6d9cf1d98de416062dd858b8920f264554b51d7481b74' +
    '5d22d0b218d98cf0a8f3e686ce72e0fd042ef84c54e1f89e11da385a5daf7b3d' +
    'ee8c83b2f8015e67bfb94d3e12814c3b005df22f176e33912e8aa035c17df70a',
  transcript: '06c80cc6fd3a098978bcb57586d9ba0966890a19703cf45a18cdb2388a296fbf',
  proof: '539839f64666e0b3b330be6249bbd8d59e599f05d96ac678df0c5f047593450f',
  sharedSecret: '51a02c31bd599b54edea2134e80353bfca478ae1f0fb1ba591fbf897b05c405f',
  initiatorToResponder: 'cb434544cffa05f05912c2e690a535309d8496af4cc4f0329818464c1de8830f',
  responderToInitiator: '1d6c37e831cbbb60301ed4e54b61f15e8218c34c626855ffa6003f262914cea5',
} as const;

export const KAT_OWNER_LINK = {
  initiatorSeed: sequence(0xa1),
  initiatorNonce: sequence(0xc1),
  responderSeed: sequence(0xe1),
  responderNonce: sequence(0x21),
  hello:
    '0102ad438bfae31f6c093d61d4339255ea798092c9fadd07b97827f4b0ae9dee7c1c' +
    'c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0',
  challenge:
    '489cebba7a166c619835fe12eedc581dbfc1b36de10c830e4f0bc1c48734864b' +
    '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40' +
    '2543b92ff1095511476adc8369db6ddc933665a11978dda1404ee1066ca9559d' +
    '002436663163326433652d346235612d346336642d386539662d306131623263336434653566' +
    '001641414543417751464267634943516f4c4441304f4477' +
    '0040' +
    '9d76a228a4824881c96050ff31eaa9287dc99efe238c592aab67189ef16fe5b6' +
    'ad90e67b84f5334e771534ec0496d9a5edeae8568c0f92d73a3ae252638e1302' +
    '595382521207ed1d43178e1b95191cb8676dc5bbaaed2453326c7df7cba87b88' +
    'de84006bbb2d1121519dbeba596f20ac2bb8fbf4dd063196174c22d613ce0103',
  transcript: 'b9d0be57c48f0cfeeba4c004672f324e5e2083f3b504bd1d44ab5495cae97f81',
  proof:
    '66cd836dcf12769b9f8004fe3ba3c5a3fdfd63e1cc2706fb95bc5b4dbfbd38b2' +
    'c61b2cd152139e17f3a83cefc666dfbf6ba442ffd77d288d76853fe1996c4e03',
  sharedSecret: '0eb805a3d105741c8625a1f551ba6b02071b0dacf60ada2af52f437afc4c454b',
  initiatorToResponder: '1e49410e7705745b120eb65fc7675e7f2a3b6176eb13bb6e8be0aa9fab1b77f4',
  responderToInitiator: '6115ebe525f12f555191035f1ee5dbe1c46640d2fae6970268449dd0efe7dcb8',
} as const;

/**
 * Sealed frames under the links above, at the counters given, computed with raw `node:crypto` under
 * both Node (OpenSSL) and Bun (BoringSSL), which agree byte for byte.
 */
export const KAT_FRAMES = {
  /** Spawner link, initiator to responder, counter 0. */
  session: {
    plaintext: 'robota/link known-answer session frame',
    sealed:
      '01fc58f7ba9cc8b2cb80becfc868e2ead7e47f01bcc7dc33456bb63489e1ec3b5bbed14e99ab1c00e23e9360be228a55cd3ef7d57f453a',
  },
  /** Spawner link, initiator to responder, counter 1. */
  owner: {
    plaintext: 'robota/link known-answer owner frame',
    sealed:
      '021eef447be2054082373721097e4c4e19fa759dea43806cda8bd33cd7b3839fca4c04e1777e85abed456627fb222805debbba501b',
  },
  /** Spawner link, responder to initiator, counter 0. */
  ownerReply: {
    plaintext: 'robota/link known-answer reply',
    sealed:
      '0290ecb3b79642a2f4645e6e2bae50f0bf0bf54d951f4588f77ce85e672a171dd845754e42ea8615740dec5253e0e0',
  },
  /** Owner link, initiator to responder, counter 0: the fixture keyring's read grant. */
  grant: {
    sealed:
      '03eb5c10891695ed702816ead24afe1b6f2feb114b1a146adb8b0f32304e2b289bba493055e01e173516c2912e527b1d148d7d11ba240792e1b5d042dd010a169677552aa2a64e6f8d51c256d3ed4d90406b',
  },
} as const;

/** The fixture keyring's sealing seed, the grant's first secret (HKDF in Python). */
export const KAT_FIXTURE_SEALING_SEED_HEX =
  'f5ae2510a79efe891ac6c38c9fc81f27059ed1f73ebef34fd76afb6671830fad';

/** A runtime after its spawner exchange, and what its spawner holds from it. */
export interface ISpawnedRuntime {
  readonly identity: IRuntimeIdentity;
  readonly spawnerKey: SpawnerKey;
  readonly instancePublicKey: Uint8Array;
}

/** A fresh runtime whose exchange with its spawner ran, as at a real start. */
export function spawnedRuntime(
  identity: IRuntimeIdentity = createRuntimeIdentity(),
): ISpawnedRuntime {
  const exchange = startSpawnerExchange();
  const { spawnerKey, instancePublicKey } = exchange.complete(
    identity.answerSpawnerExchange(exchange.message),
  );
  return { identity, spawnerKey, instancePublicKey };
}

/** A fresh runtime certified by `owner` for `binding`, as after its first unlock. */
export function certifiedRuntime(owner: IOwnerHandover, binding: ILinkBinding): IRuntimeIdentity {
  const { identity, spawnerKey } = spawnedRuntime();
  identity.installTrustRoot(owner.certify(identity.instancePublicKey, binding), binding);
  spawnerKey.wipe();
  return identity;
}
