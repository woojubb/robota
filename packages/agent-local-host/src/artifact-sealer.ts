/**
 * The artifact sealers a host hands to its stores: `IArtifactSealer` over the keyring and the one
 * `KeyHolder` that holds this process's keys, a write-only sealer for a process that was handed
 * only a write grant, and a process-local sealer for what only the process that wrote it ever reads.
 *
 * Sealing uses only the sealing PUBLIC key (`KeyHolder.sealingPublicKey()`), so it works while the
 * keys are locked and never asks for an unlock. When that key cannot be read (no keyring, a refused
 * file), sealing fails with `SealingKeyUnavailableError`. Opening goes through the holder, which keeps
 * the private key to itself, and says why it could not: `ArtifactLockedError` when the holder is
 * locked, `ArtifactCorruptError` when the bytes are not sealed in the framing this build writes, are
 * damaged, or are bound to another owner or kind. No error carries plaintext, a key or a path.
 *
 * Whether two seals share a data key follows the kind's policy (`ARTIFACT_KEY_REUSE`). A `fresh` kind
 * seals every call under a new data key. A `writer-epoch` kind reuses one data key per context for a
 * writer epoch, sealed to the public key once, because one public-key operation per appended line was
 * measured too slow to read back; each line still carries the sealed key and opens on its own. An
 * epoch ends when the verified sealing key is not the one it was sealed to, so nothing written after
 * an unlock caught a swapped key goes on using a key sealed to the swapped one. Every epoch live when
 * the holder locks ends then, its data key wiped: a writer's data key reads every line of its epoch,
 * so it goes with the unlock like any other key material, even though nothing here ever decrypts with
 * it. Locking an already locked holder is no lock, so an epoch begun while locked lives on until the
 * first lock after the next unlock, a verified-key change, its record or context limit, or
 * `dispose()`, whichever comes first.
 *
 * The AAD that binds a sealed artifact to its owner is derived here from the kind and the id, under
 * a fixed versioned prefix, so a sealed file copied to another session's path does not open. It binds;
 * it does not say who sealed: anyone holding the public key can seal an artifact that opens. Who wrote
 * it is what an authorship tag says, and only the sealer over the key holder offers one, since only it
 * reaches unlocked keys; it also passes on the holder's unlocks, holding each listener weakly so a
 * store that subscribes is still collected when nothing else refers to it.
 */
import { Buffer } from 'node:buffer';

import {
  ARTIFACT_KEY_REUSE,
  ArtifactCorruptError,
  ArtifactLockedError,
  SEALED_ARTIFACT_LINE_PREFIX,
  SEALED_ARTIFACT_MAGIC,
  isCurrentSealedArtifactBytes,
  isCurrentSealedArtifactLine,
  isSealedArtifactBytes,
  isSealedArtifactLine,
} from '@robota-sdk/agent-core';
import {
  KeyringError,
  encryptRecord,
  generateArtifactKey,
  generateTransientSealingKeyPair,
  openBlob,
  sealArtifactKey,
  sealBlob,
  splitSealedBlob,
} from '@robota-sdk/agent-keyring';

import { KeyringStoreError, type TKeyringStoreErrorCode } from './keyring-store.js';

import type { IArtifactContext, IArtifactSealer, TArtifactKind } from '@robota-sdk/agent-core';
import type { IKeyPair } from '@robota-sdk/agent-keyring';
import type { KeyHolder } from './key-holder.js';

/** Versioned, so a later change to how the binding is derived cannot open an earlier artifact. */
const AAD_PREFIX = 'robota/artifact/v1';
const MAGIC = Buffer.from(SEALED_ARTIFACT_MAGIC, 'ascii');
/** Far inside the keyring's 65535-byte AAD limit, and far beyond any real owner id. */
const MAX_ID_LENGTH = 4096;
const SEALING_PUBLIC_KEY_BYTES = 32;
const WRITE_GRANT_PREFIX = 'rsg1.';
const WRITE_GRANT_ERROR = 'The write grant is not one this build issues.';

/** Whether the kind's artifacts share a writer epoch; a kind the policy does not name is a caller bug. */
function sharesWriterEpoch(kind: TArtifactKind): boolean {
  if (!Object.hasOwn(ARTIFACT_KEY_REUSE, kind)) {
    throw new RangeError('The artifact kind is not one this sealer knows.');
  }
  return ARTIFACT_KEY_REUSE[kind] === 'writer-epoch';
}

/**
 * `kind|id` under the prefix. `|` separates the parts, so an id containing one could be read as a
 * different kind and id; it is refused rather than escaped. A refused context is a caller bug, not a
 * damaged artifact, so it is a `RangeError` and never an `ArtifactCorruptError`.
 */
function artifactAad(context: IArtifactContext): Buffer {
  sharesWriterEpoch(context.kind);
  if (
    typeof context.id !== 'string' ||
    context.id.length === 0 ||
    context.id.length > MAX_ID_LENGTH ||
    context.id.includes('|')
  ) {
    throw new RangeError(
      `The artifact id must be 1-${MAX_ID_LENGTH} characters and must not contain "|".`,
    );
  }
  return Buffer.from(`${AAD_PREFIX}|${context.kind}|${context.id}`, 'utf8');
}

/**
 * The sealing public key could not be read, so nothing was sealed. Fixed text and the store's reason
 * only: the keyring path is the store's to report, not something every writer's error should carry.
 */
export class SealingKeyUnavailableError extends Error {
  readonly reason: TKeyringStoreErrorCode;

  constructor(reason: TKeyringStoreErrorCode) {
    super(`The sealing public key could not be read, so nothing was sealed (${reason}).`);
    this.name = 'SealingKeyUnavailableError';
    this.reason = reason;
  }
}

/**
 * The failure of `openBlob` as the port states it. Only the three codes that describe the BYTES
 * become `ArtifactCorruptError`; `invalid-argument` means this code handed the keyring something
 * wrong, which is a defect and must not read as a damaged file.
 */
function openFailure(error: unknown): unknown {
  if (!(error instanceof KeyringError)) return error;
  if (error.code === 'keys-locked') return new ArtifactLockedError();
  if (
    error.code === 'decryption-failed' ||
    error.code === 'malformed-ciphertext' ||
    error.code === 'unsupported-version'
  ) {
    return new ArtifactCorruptError();
  }
  return error;
}

/** Canonical unpadded base64url, or `undefined`; `Buffer` alone would accept several spellings of one value. */
function decodeCanonicalBase64url(encoded: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return undefined;
  const decoded = Buffer.from(encoded, 'base64url');
  return decoded.toString('base64url') === encoded ? decoded : undefined;
}

/** `rsg1.` and the canonical unpadded base64url of the 32-byte X25519 sealing public key. */
export function formatWriteGrant(sealingPublicKey: Uint8Array): string {
  if (sealingPublicKey.length !== SEALING_PUBLIC_KEY_BYTES) {
    throw new RangeError(`A sealing public key is ${SEALING_PUBLIC_KEY_BYTES} bytes.`);
  }
  return WRITE_GRANT_PREFIX + Buffer.from(sealingPublicKey).toString('base64url');
}

/** The key a grant names. Any other prefix, spelling or length is a `RangeError` with fixed text. */
export function parseWriteGrant(grant: string): Uint8Array {
  const key =
    typeof grant === 'string' && grant.startsWith(WRITE_GRANT_PREFIX)
      ? decodeCanonicalBase64url(grant.slice(WRITE_GRANT_PREFIX.length))
      : undefined;
  if (key === undefined || key.length !== SEALING_PUBLIC_KEY_BYTES) {
    throw new RangeError(WRITE_GRANT_ERROR);
  }
  return Uint8Array.from(key);
}

/** Where a writer gets the key a new epoch is sealed to, and the key it must follow once one is known. */
export interface IWriterEpochKeys {
  /** The key to seal a new epoch's data key to; read once per epoch. */
  sealingPublicKey(): Uint8Array;
  /** The key sealing must go to from now on, or `undefined` while none is verified. */
  verifiedSealingKey(): Uint8Array | undefined;
}

export interface IWriterEpochLimits {
  /** Contexts with a live epoch; the least recently used beyond this is retired. */
  readonly contexts: number;
  /** Records sealed under one data key before a new epoch starts. */
  readonly records: number;
}

/** 2^24 records per key stays far below the 2^32 bound for random 96-bit nonces. */
export const WRITER_EPOCH_LIMITS: IWriterEpochLimits = Object.freeze({
  contexts: 64,
  records: 2 ** 24,
});

interface IWriterEpoch {
  readonly dataKey: Buffer;
  /** `dataKey` sealed to `sealedTo` under the context's AAD: what every blob of the epoch starts with. */
  readonly sealedKey: Buffer;
  readonly sealedTo: Uint8Array;
  records: number;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(right);
}

/**
 * The writer epochs of one sealer, by the exact AAD bytes they seal under, so a sealed data key is
 * never reused under another context. A writer's data key opens nothing for anyone here; it is wiped
 * when its epoch is retired.
 */
export class WriterEpochs {
  readonly #keys: IWriterEpochKeys;
  readonly #limits: IWriterEpochLimits;
  /** In use order, least recent first. */
  readonly #epochs = new Map<string, IWriterEpoch>();

  constructor(keys: IWriterEpochKeys, limits: IWriterEpochLimits = WRITER_EPOCH_LIMITS) {
    this.#keys = keys;
    this.#limits = limits;
  }

  /** Ends every epoch and wipes its data key, so the next seal of any context starts a new one. */
  retireAll(): void {
    for (const epoch of this.#epochs.values()) epoch.dataKey.fill(0);
    this.#epochs.clear();
  }

  /** The bytes `sealBlob` would produce for `plain` under `aad`, with this epoch's data key. */
  seal(plain: Uint8Array, aad: Buffer): Buffer {
    const id = aad.toString('latin1');
    let epoch = this.#epochs.get(id);
    if (epoch !== undefined) {
      this.#epochs.delete(id);
      if (this.#hasEnded(epoch)) {
        epoch.dataKey.fill(0);
        epoch = undefined;
      }
    }
    epoch ??= this.#begin(aad);
    this.#epochs.set(id, epoch);
    while (this.#epochs.size > this.#limits.contexts) {
      const [oldest, retired] = this.#epochs.entries().next().value as [string, IWriterEpoch];
      this.#epochs.delete(oldest);
      retired.dataKey.fill(0);
    }
    epoch.records += 1;
    return Buffer.concat([epoch.sealedKey, encryptRecord(epoch.dataKey, plain, aad)]);
  }

  #hasEnded(epoch: IWriterEpoch): boolean {
    if (epoch.records >= this.#limits.records) return true;
    const verified = this.#keys.verifiedSealingKey();
    return verified !== undefined && !sameBytes(verified, epoch.sealedTo);
  }

  #begin(aad: Buffer): IWriterEpoch {
    const sealedTo = this.#keys.sealingPublicKey();
    const dataKey = generateArtifactKey();
    try {
      return { dataKey, sealedKey: sealArtifactKey(sealedTo, dataKey, aad), sealedTo, records: 0 };
    } catch (error) {
      dataKey.fill(0);
      throw error;
    }
  }
}

function sealedBytes(blob: Buffer): Buffer {
  return Buffer.concat([MAGIC, blob]);
}

function blobOfSealedBytes(stored: Uint8Array): Uint8Array {
  if (!isCurrentSealedArtifactBytes(stored)) throw new ArtifactCorruptError();
  return stored.subarray(MAGIC.length);
}

/** Seals `plain` as UTF-8 to one line with `seal`, wiping the encoded copy afterwards. */
function sealedLine(plain: string, seal: (bytes: Buffer) => Buffer): string {
  const bytes = Buffer.from(plain, 'utf8');
  try {
    return SEALED_ARTIFACT_LINE_PREFIX + seal(bytes).toString('base64url');
  } finally {
    bytes.fill(0);
  }
}

function blobOfSealedLine(stored: string): Buffer {
  if (!isCurrentSealedArtifactLine(stored)) throw new ArtifactCorruptError();
  const blob = decodeCanonicalBase64url(stored.slice(SEALED_ARTIFACT_LINE_PREFIX.length));
  if (blob === undefined) throw new ArtifactCorruptError();
  return blob;
}

/** An opened line as text, wiping the opened bytes afterwards. */
function textOfOpenedLine(plain: Buffer): string {
  try {
    return plain.toString('utf8');
  } finally {
    plain.fill(0);
  }
}

/** The key `holder` seals new artifacts to; fails as sealing does when it cannot be read. */
function sealingPublicKeyOf(holder: KeyHolder): Uint8Array {
  try {
    return holder.sealingPublicKey();
  } catch (error) {
    throw error instanceof KeyringStoreError ? new SealingKeyUnavailableError(error.code) : error;
  }
}

/**
 * Releases a sealer that was dropped without `dispose()` the way `dispose()` would, so it leaves
 * neither a listener in its holder nor a data key behind.
 */
const releaseCollectedSealer = new FinalizationRegistry<() => void>((release) => {
  release();
});

/** Stops hearing the holder's locks and unlocks and wipes every epoch, the first time it is called only. */
function releaseOnce(stopHearing: readonly (() => void)[], epochs: WriterEpochs): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const stop of stopHearing) stop();
    epochs.retireAll();
  };
}

/**
 * Unlock listeners held weakly: a listener whose subscriber was collected is dropped, here when it
 * is found gone or when the registry reports it, so subscribing keeps nothing alive.
 */
class WeakUnlockListeners {
  readonly #references = new Set<WeakRef<() => void>>();
  readonly #collected = new FinalizationRegistry<WeakRef<() => void>>((reference) => {
    this.#references.delete(reference);
  });

  add(listener: () => void): () => void {
    const reference = new WeakRef(listener);
    this.#references.add(reference);
    this.#collected.register(listener, reference, reference);
    return () => {
      this.#references.delete(reference);
      this.#collected.unregister(reference);
    };
  }

  /** Calls every live listener; one listener's failure stops none of the others. */
  announce(): void {
    for (const reference of [...this.#references]) {
      const listener = reference.deref();
      if (listener === undefined) {
        this.#references.delete(reference);
        continue;
      }
      try {
        listener();
      } catch {
        // allow-fallback: the keys are unlocked; one listener's failure must not stop the others.
      }
    }
  }
}

export class KeyHolderArtifactSealer implements IArtifactSealer {
  readonly #holder: KeyHolder;
  readonly #epochs: WriterEpochs;
  readonly #unlockListeners = new WeakUnlockListeners();
  readonly #release: () => void;
  #disposed = false;

  constructor(holder: KeyHolder) {
    this.#holder = holder;
    // Neither the epochs nor the release refer back to this sealer, so it can still be collected.
    const epochs = new WriterEpochs({
      sealingPublicKey: () => sealingPublicKeyOf(holder),
      verifiedSealingKey: () => holder.verifiedSealingKey(),
    });
    this.#epochs = epochs;
    const stopHearingLocks = holder.onLock(() => {
      epochs.retireAll();
    });
    const unlockListeners = this.#unlockListeners;
    const stopHearingUnlocks = holder.onUnlock(() => {
      unlockListeners.announce();
    });
    this.#release = releaseOnce([stopHearingLocks, stopHearingUnlocks], epochs);
    releaseCollectedSealer.register(this, this.#release, this);
  }

  /**
   * Stops hearing the holder's locks and unlocks and wipes every epoch's data key. Idempotent. The
   * sealer still seals afterwards, keeping no data key: each artifact of a writer-epoch kind is sealed
   * as a fresh kind's is, so nothing outlives a lock this sealer no longer hears. Its unlock listeners
   * hear nothing more.
   */
  dispose(): void {
    this.#disposed = true;
    releaseCollectedSealer.unregister(this);
    this.#release();
  }

  sealBytes(plain: Uint8Array, context: IArtifactContext): Uint8Array {
    return sealedBytes(this.#seal(plain, context));
  }

  openBytes(stored: Uint8Array, context: IArtifactContext): Uint8Array {
    return this.#open(blobOfSealedBytes(stored), context);
  }

  isSealedBytes(stored: Uint8Array): boolean {
    return isSealedArtifactBytes(stored);
  }

  sealLine(plain: string, context: IArtifactContext): string {
    return sealedLine(plain, (bytes) => this.#seal(bytes, context));
  }

  openLine(stored: string, context: IArtifactContext): string {
    return textOfOpenedLine(this.#open(blobOfSealedLine(stored), context));
  }

  isSealedLine(stored: string): boolean {
    return isSealedArtifactLine(stored);
  }

  /** The key this sealer seals new epochs to now, as a grant; fails as sealing does when it cannot be read. */
  writeGrant(): string {
    return formatWriteGrant(sealingPublicKeyOf(this.#holder));
  }

  /** The holder's authorship tag of `bytes` for `context`; `ArtifactLockedError` while locked. */
  tagAuthorship(bytes: Uint8Array, context: IArtifactContext): Uint8Array {
    artifactAad(context);
    try {
      return this.#holder.tagAuthorship(context, bytes);
    } catch (error) {
      throw openFailure(error);
    }
  }

  /** Whether `tag` is the holder's authorship tag of `bytes` for `context`; `ArtifactLockedError` while locked. */
  verifyAuthorship(bytes: Uint8Array, tag: Uint8Array, context: IArtifactContext): boolean {
    artifactAad(context);
    try {
      return this.#holder.verifyAuthorship(context, bytes, tag);
    } catch (error) {
      throw openFailure(error);
    }
  }

  /** Calls `listener` after each unlock of the holder, holding it weakly; returns the unsubscribe. */
  onUnlock(listener: () => void): () => void {
    return this.#unlockListeners.add(listener);
  }

  #seal(plain: Uint8Array, context: IArtifactContext): Buffer {
    const aad = artifactAad(context);
    if (sharesWriterEpoch(context.kind) && !this.#disposed) return this.#epochs.seal(plain, aad);
    return sealBlob(sealingPublicKeyOf(this.#holder), plain, aad);
  }

  #open(blob: Uint8Array, context: IArtifactContext): Buffer {
    const aad = artifactAad(context);
    try {
      return this.#holder.openBlob(blob, aad, { reuse: sharesWriterEpoch(context.kind) });
    } catch (error) {
      throw openFailure(error);
    }
  }
}

/**
 * The sealer of a process that was handed only a write grant (a subagent child): it seals exactly as
 * the grant's issuer does, to the grant's key, with writer epochs of its own, and never touches the
 * keyring file. It opens nothing: a sealed artifact is intact, and the owner's process reads it, so
 * every open of one says `no-keys`. Its verified key is its current grant's, so replacing the grant
 * with another key rolls its epochs over.
 */
export class WriteOnlyArtifactSealer implements IArtifactSealer {
  #sealingKey: Uint8Array;
  readonly #epochs: WriterEpochs;

  constructor(grant: string) {
    this.#sealingKey = parseWriteGrant(grant);
    this.#epochs = new WriterEpochs({
      sealingPublicKey: () => Uint8Array.from(this.#sealingKey),
      verifiedSealingKey: () => this.#sealingKey,
    });
  }

  /** Seals to the key `grant` names from now on. A malformed grant changes nothing. */
  replaceGrant(grant: string): void {
    this.#sealingKey = parseWriteGrant(grant);
  }

  sealBytes(plain: Uint8Array, context: IArtifactContext): Uint8Array {
    return sealedBytes(this.#seal(plain, context));
  }

  openBytes(stored: Uint8Array, context: IArtifactContext): Uint8Array {
    return this.#refuse(blobOfSealedBytes(stored), context);
  }

  isSealedBytes(stored: Uint8Array): boolean {
    return isSealedArtifactBytes(stored);
  }

  sealLine(plain: string, context: IArtifactContext): string {
    return sealedLine(plain, (bytes) => this.#seal(bytes, context));
  }

  openLine(stored: string, context: IArtifactContext): string {
    return this.#refuse(blobOfSealedLine(stored), context);
  }

  isSealedLine(stored: string): boolean {
    return isSealedArtifactLine(stored);
  }

  writeGrant(): string {
    return formatWriteGrant(this.#sealingKey);
  }

  #seal(plain: Uint8Array, context: IArtifactContext): Buffer {
    const aad = artifactAad(context);
    if (sharesWriterEpoch(context.kind)) return this.#epochs.seal(plain, aad);
    return sealBlob(this.#sealingKey, plain, aad);
  }

  /** A blob laid out as a sealed one is intact as far as this process can tell: the owner's to open. */
  #refuse(blob: Uint8Array, context: IArtifactContext): never {
    artifactAad(context);
    try {
      splitSealedBlob(blob);
    } catch (error) {
      throw openFailure(error);
    }
    throw new ArtifactLockedError('no-keys');
  }
}

/**
 * The process-local sealer was disposed: its key is gone, so nothing it sealed opens and it seals
 * nothing more. A reader takes it as an artifact that does not open (its code is `ARTIFACT_CORRUPT`),
 * which is what such an artifact now is; no key is ever made again in its place.
 */
export class ProcessLocalSealerDisposedError extends ArtifactCorruptError {
  constructor() {
    super();
    this.name = 'ProcessLocalSealerDisposedError';
    this.message =
      'The process-local sealer was disposed; nothing it sealed opens, and it seals nothing more.';
  }
}

/** What only the process that wrote it reads back: the one thing the process-local sealer seals. */
const PROCESS_LOCAL_KINDS: ReadonlySet<string> = new Set<TArtifactKind>([
  'tool-result-spill',
  'checkpoint-manifest',
  'checkpoint-preimage',
]);

/**
 * The binding of a process-local artifact. A kind another process reads — a session record, a log or
 * history line — is refused as a caller bug: sealed to this key, it would not open once this process
 * ends.
 */
function processLocalAad(context: IArtifactContext): Buffer {
  if (!PROCESS_LOCAL_KINDS.has(context.kind)) {
    throw new RangeError('The process-local sealer seals only what its own process reads back.');
  }
  return artifactAad(context);
}

/**
 * The sealer for what only the process that wrote it ever reads — its spilled tool results, its
 * ephemeral edit checkpoints — and for nothing else. It seals exactly as
 * {@link KeyHolderArtifactSealer} seals those kinds (the same framing and binding, a data key per
 * artifact), to an X25519 key made in this process's memory when the sealer is made. The private key
 * never leaves it: no file, log or error carries it, and nothing else derives it, so an artifact it
 * sealed opens here whatever the keyring's lock state and nowhere else — not in another process, not
 * for the keyring, not for another instance.
 *
 * It offers no write grant: a child sealing to this key would write what no process can open once
 * this one ends, so a host that needs a grant refuses to start the child instead.
 */
export class ProcessLocalArtifactSealer implements IArtifactSealer {
  #pair: IKeyPair | undefined;

  constructor() {
    this.#pair = generateTransientSealingKeyPair();
  }

  /**
   * For tests only; production never calls it, since the process's exit ends the key. Drops the key
   * for good: afterwards every seal and open throws {@link ProcessLocalSealerDisposedError}.
   * Idempotent.
   */
  dispose(): void {
    this.#pair = undefined;
  }

  sealBytes(plain: Uint8Array, context: IArtifactContext): Uint8Array {
    return sealedBytes(this.#seal(plain, context));
  }

  openBytes(stored: Uint8Array, context: IArtifactContext): Uint8Array {
    return this.#open(blobOfSealedBytes(stored), context);
  }

  isSealedBytes(stored: Uint8Array): boolean {
    return isSealedArtifactBytes(stored);
  }

  sealLine(plain: string, context: IArtifactContext): string {
    return sealedLine(plain, (bytes) => this.#seal(bytes, context));
  }

  openLine(stored: string, context: IArtifactContext): string {
    return textOfOpenedLine(this.#open(blobOfSealedLine(stored), context));
  }

  isSealedLine(stored: string): boolean {
    return isSealedArtifactLine(stored);
  }

  #requirePair(): IKeyPair {
    if (this.#pair === undefined) throw new ProcessLocalSealerDisposedError();
    return this.#pair;
  }

  #seal(plain: Uint8Array, context: IArtifactContext): Buffer {
    const aad = processLocalAad(context);
    return sealBlob(this.#requirePair().publicKey, plain, aad);
  }

  #open(blob: Uint8Array, context: IArtifactContext): Buffer {
    const aad = processLocalAad(context);
    const { privateKey } = this.#requirePair();
    try {
      return openBlob(privateKey, blob, aad);
    } catch (error) {
      throw openFailure(error);
    }
  }
}
