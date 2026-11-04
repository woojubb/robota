/**
 * An `IArtifactSealer` for tests of the packages that WRITE sealed artifacts (the session stores,
 * the log sinks), which cannot depend on the host's keyring.
 *
 * It keeps the properties those tests assert and nothing more: the stored bytes are opaque
 * (AES-256-GCM under a key held only here), two seals of equal plaintext differ, the sealed content
 * is bound to the artifact's kind and id so a copy at another owner's path does not open, sealing
 * works while locked, and opening while locked throws `ArtifactLockedError`. Its authorship tags are
 * an HMAC under a key derived from its own, bound to the kind, id and bytes, made and checked only
 * while unlocked; `unlock()` calls the unlock listeners, which it holds weakly as the production sealer
 * does. Its write grant is a handle into this process, so a grant crossing a boundary in a test carries
 * no key. It is NOT the production sealer and its key is not protected by anything.
 *
 * Test-only: exported via `@robota-sdk/agent-core/testing`; never imported by runtime code.
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

import {
  ArtifactCorruptError,
  ArtifactLockedError,
  SEALED_ARTIFACT_LINE_PREFIX,
  SEALED_ARTIFACT_MAGIC,
  isCurrentSealedArtifactBytes,
  isCurrentSealedArtifactLine,
  isSealedArtifactBytes,
  isSealedArtifactLine,
} from '../index.js';

import type { IArtifactContext, IArtifactSealer } from '../index.js';

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAGIC_BYTES = Buffer.from(SEALED_ARTIFACT_MAGIC, 'ascii');
const GRANT_PREFIX = 'robota-test-grant/v1:';

/** Grant → the key of the double that issued it. A grant names an entry here; it never holds the key. */
const issuedGrants = new Map<string, Buffer>();

export interface IArtifactSealerDouble extends IArtifactSealer {
  /** From now on `openBytes`/`openLine` and the authorship tags throw `ArtifactLockedError`; sealing keeps working. */
  lock(): void;
  /** Opens again, then calls every live unlock listener. */
  unlock(): void;
  tagAuthorship(bytes: Uint8Array, context: IArtifactContext): Uint8Array;
  verifyAuthorship(bytes: Uint8Array, tag: Uint8Array, context: IArtifactContext): boolean;
  onUnlock(listener: () => void): () => void;
  readonly isLocked: boolean;
  /** `robota-test-grant/v1:<id>`, valid in this process only, for {@link openTestWriteGrant}. */
  writeGrant(): string;
}

export interface IArtifactSealerDoubleOptions {
  /** Start locked. Defaults to unlocked. */
  readonly locked?: boolean;
  /** Share a key between two doubles to model one keyring; omit for a key of its own. */
  readonly key?: Uint8Array;
}

function aadFor(context: IArtifactContext): Buffer {
  if (context.id.length === 0 || context.id.includes('|')) {
    throw new RangeError('The artifact id must be non-empty and must not contain "|".');
  }
  return Buffer.from(`robota-test-sealer/v1|${context.kind}|${context.id}`, 'utf8');
}

function sealWith(key: Buffer, plain: Uint8Array, context: IArtifactContext): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(context));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** What a double's authorship tag binds: the kind, the id and the SHA-256 of the bytes. */
function authorshipMessage(bytes: Uint8Array, context: IArtifactContext): string {
  aadFor(context);
  const digest = createHash('sha256').update(bytes).digest('hex');
  return `robota-test-authorship/v1|${context.kind}|${context.id}|${digest}`;
}

function blobOfBytes(stored: Uint8Array): Uint8Array {
  if (!isCurrentSealedArtifactBytes(stored)) throw new ArtifactCorruptError();
  return stored.subarray(MAGIC_BYTES.length);
}

function blobOfLine(stored: string): Buffer {
  if (!isCurrentSealedArtifactLine(stored)) throw new ArtifactCorruptError();
  return Buffer.from(stored.slice(SEALED_ARTIFACT_LINE_PREFIX.length), 'base64url');
}

/** The sealing half shared by a double and its write-only twin. */
function sealingWith(
  key: Buffer,
): Pick<IArtifactSealer, 'sealBytes' | 'isSealedBytes' | 'sealLine' | 'isSealedLine'> {
  return {
    sealBytes: (plain, context) => Buffer.concat([MAGIC_BYTES, sealWith(key, plain, context)]),
    isSealedBytes: isSealedArtifactBytes,
    sealLine: (plain, context) =>
      SEALED_ARTIFACT_LINE_PREFIX +
      sealWith(key, Buffer.from(plain, 'utf8'), context).toString('base64url'),
    isSealedLine: isSealedArtifactLine,
  };
}

export function createTestArtifactSealer(
  options: IArtifactSealerDoubleOptions = {},
): IArtifactSealerDouble {
  const key = options.key === undefined ? randomBytes(KEY_BYTES) : Buffer.from(options.key);
  const authorshipKey = createHmac('sha256', key).update('robota-test-authorship-key/v1').digest();
  let locked = options.locked === true;
  let grant: string | undefined;
  const unlockListeners = new Set<WeakRef<() => void>>();

  const tag = (bytes: Uint8Array, context: IArtifactContext): Buffer => {
    if (locked) throw new ArtifactLockedError();
    return createHmac('sha256', authorshipKey).update(authorshipMessage(bytes, context)).digest();
  };

  const open = (blob: Uint8Array, context: IArtifactContext): Buffer => {
    if (locked) throw new ArtifactLockedError();
    if (blob.length < IV_BYTES + TAG_BYTES) throw new ArtifactCorruptError();
    const buffer = Buffer.from(blob);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, IV_BYTES));
      decipher.setAAD(aadFor(context));
      decipher.setAuthTag(buffer.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(buffer.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]);
    } catch {
      throw new ArtifactCorruptError();
    }
  };

  return {
    get isLocked() {
      return locked;
    },
    lock() {
      locked = true;
    },
    unlock() {
      locked = false;
      for (const reference of [...unlockListeners]) {
        const listener = reference.deref();
        if (listener === undefined) unlockListeners.delete(reference);
        else listener();
      }
    },
    tagAuthorship: tag,
    verifyAuthorship(bytes, candidate, context) {
      const expected = tag(bytes, context);
      return candidate.length === expected.length && timingSafeEqual(expected, candidate);
    },
    onUnlock(listener) {
      const reference = new WeakRef(listener);
      unlockListeners.add(reference);
      return () => {
        unlockListeners.delete(reference);
      };
    },
    ...sealingWith(key),
    openBytes: (stored, context) => open(blobOfBytes(stored), context),
    openLine: (stored, context) => open(blobOfLine(stored), context).toString('utf8'),
    writeGrant() {
      if (grant === undefined) {
        grant = `${GRANT_PREFIX}${randomUUID()}`;
        issuedGrants.set(grant, key);
      }
      return grant;
    },
  };
}

/**
 * The write-only twin of the double that issued `grant`: it seals as that double does, and every
 * open of a sealed artifact throws `ArtifactLockedError` with reason `no-keys`. A grant this process
 * did not issue is a `RangeError`.
 */
export function openTestWriteGrant(grant: string): IArtifactSealer {
  const key = issuedGrants.get(grant);
  if (key === undefined) {
    throw new RangeError('The grant was not issued by a test sealer in this process.');
  }
  const refuse = (context: IArtifactContext): never => {
    aadFor(context);
    throw new ArtifactLockedError('no-keys');
  };
  return {
    ...sealingWith(key),
    openBytes: (stored, context) => {
      blobOfBytes(stored);
      return refuse(context);
    },
    openLine: (stored, context) => {
      blobOfLine(stored);
      return refuse(context);
    },
    writeGrant: () => grant,
  };
}
