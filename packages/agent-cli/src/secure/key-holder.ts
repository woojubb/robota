/**
 * The one place in this process where unlocked keys live.
 *
 * The holder offers operations on the keys, never the keys themselves: no caller can keep a private
 * `KeyObject`, so every way of locking (the user, inactivity, the last client leaving, a locked
 * screen, suspend) ends here and "are the keys still usable in this process" has exactly one answer.
 * Locking drops the holder's references; it cannot erase key material the runtime still holds (see
 * `IUnlockedKeys`).
 *
 * Unlocking is also where a swapped sealing public key is caught, because that check needs the keys.
 * From the first unlock in this process the holder keeps the key it verified and seals to it, locked
 * or not, whatever the file says afterwards. Before that first unlock a writer can only seal to the
 * key the file holds; that is the design's accepted weakness, caught at the next unlock and visible
 * meanwhile through the fingerprint. A mismatch never passes quietly: the holder repairs the stored
 * key and reports `repaired`, or, when the repair cannot be written, stays locked and throws
 * `SealingKeyMismatchError` with both fingerprints, so the owner hears that anything written while
 * locked may be sealed to a key they cannot open.
 *
 * The data keys it opens for writer epochs are unlocked key material too, so they live here, are
 * zero-filled when the keys are dropped, and locking still ends every way of reading. A sealer's own
 * writer epochs end on the same lock (`onLock`).
 */
import { Buffer } from 'node:buffer';

import {
  KeyringError,
  checkSealingPublicKey,
  decryptRecord,
  fingerprint,
  getSealingPublicKey,
  openArtifactKey,
  openBlob,
  repairSealingPublicKey,
  splitSealedBlob,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type IKeyring,
  type IUnlockedKeys,
  type TKeyringCredential,
} from '@robota-sdk/agent-keyring';

import { KeyringStoreError, type IKeyringStore } from './keyring-store.js';

export type TLockReason = 'explicit' | 'idle' | 'last-client-detached' | 'screen-lock' | 'suspend';

/** `verified`: the stored sealing public key was the one the keys derive. `repaired`: it was not, and the file now holds the right one. */
export type TSealingKeyOutcome = 'verified' | 'repaired';

export interface IKeyHolderPolicy {
  /** Lock after this many milliseconds without `touch()`; 0 disables the idle lock. */
  readonly idleMs: number;
}

/** A pending timer. `unref` lets the process exit while it is pending: a lock timer never keeps one alive. */
export interface IKeyHolderTimer {
  clear(): void;
  unref(): void;
}

/** The clock and timers the holder uses, injectable so a test controls time. */
export interface IKeyHolderTimers {
  now(): number;
  setTimer(callback: () => void, delayMs: number): IKeyHolderTimer;
}

export interface IKeyHolderOptions {
  readonly store: IKeyringStore;
  readonly timers?: IKeyHolderTimers;
  readonly policy?: Partial<IKeyHolderPolicy>;
}

export interface IOpenBlobOptions {
  /**
   * The blob's kind shares a data key across a writer epoch (`ARTIFACT_KEY_REUSE`): the opened key is
   * kept until the keys are dropped, so the epoch's other blobs cost one record decryption each.
   */
  readonly reuse?: boolean;
}

export const DEFAULT_IDLE_LOCK_MS = 15 * 60 * 1000;
/** The longest delay a timer honours; a longer one fires at once, which would re-arm in a loop. */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * Writer epochs whose opened keys are kept, a few MB at most. A year of terminal sessions is a couple
 * of thousand epochs in one history; beyond the cap a read pays one key opening per epoch again.
 */
export const OPENED_DATA_KEY_LIMIT = 16_384;

/** Refusals that describe the sealed key's bytes, so trying the same bytes again cannot succeed. */
const REFUSALS_OF_THE_BYTES: ReadonlySet<string> = new Set([
  'decryption-failed',
  'malformed-ciphertext',
  'unsupported-version',
]);

/**
 * Opened writer-epoch data keys by the exact sealed key and the binding it authenticated under, so a
 * hit hands back what a full opening would. A sealed key whose opening was refused is remembered as
 * refused, so a damaged or forged key costs one attempt however often its lines are read; a record
 * that fails under a key that opened never reaches this cache. Least recently used entries go first,
 * zero-filled.
 */
export class OpenedDataKeys {
  readonly #limit: number;
  /** In use order, least recent first. */
  readonly #entries = new Map<string, Buffer | KeyringError>();

  constructor(limit = OPENED_DATA_KEY_LIMIT) {
    this.#limit = limit;
  }

  /** The data key `sealedKey` holds under `aad`: remembered, or from `openKey` and remembered. */
  open(aad: Uint8Array, sealedKey: Uint8Array, openKey: () => Buffer): Buffer {
    // The sealed key has a fixed length, so putting it first keeps the pair unambiguous.
    const id = latin1(sealedKey) + latin1(aad);
    const known = this.#entries.get(id);
    if (known !== undefined) {
      this.#entries.delete(id);
      this.#entries.set(id, known);
      if (known instanceof KeyringError) throw known;
      return known;
    }
    let opened: Buffer | KeyringError;
    try {
      opened = openKey();
    } catch (error) {
      if (!(error instanceof KeyringError) || !REFUSALS_OF_THE_BYTES.has(error.code)) throw error;
      opened = error;
    }
    this.#entries.set(id, opened);
    while (this.#entries.size > this.#limit) {
      const [oldest, entry] = this.#entries.entries().next().value as [
        string,
        Buffer | KeyringError,
      ];
      this.#entries.delete(oldest);
      if (!(entry instanceof KeyringError)) entry.fill(0);
    }
    if (opened instanceof KeyringError) throw opened;
    return opened;
  }

  /** Zero-fills every kept key and forgets them all. */
  wipe(): void {
    for (const entry of this.#entries.values()) {
      if (!(entry instanceof KeyringError)) entry.fill(0);
    }
    this.#entries.clear();
  }
}

function latin1(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
}

/**
 * The stored sealing public key is not the one the keyring derives, and the repair could not be
 * confirmed: the holder stayed locked. Both fingerprints are public values; `repairFailure` is the
 * store's reason (`changed`, `committed-unconfirmed`, `write-failed`, ...) for the caller to word.
 */
export class SealingKeyMismatchError extends Error {
  readonly storedFingerprint: string;
  readonly derivedFingerprint: string;
  readonly repairFailure: string;

  constructor(storedFingerprint: string, derivedFingerprint: string, cause: unknown) {
    super(
      'The sealing public key in the keyring file is not the one the keyring derives, and the repair was not confirmed.',
      { cause },
    );
    this.name = 'SealingKeyMismatchError';
    this.storedFingerprint = storedFingerprint;
    this.derivedFingerprint = derivedFingerprint;
    this.repairFailure = cause instanceof KeyringStoreError ? cause.code : 'unknown';
  }
}

export function createNodeTimers(): IKeyHolderTimers {
  return {
    now: () => Date.now(),
    setTimer(callback, delayMs) {
      const timer = setTimeout(callback, delayMs);
      return {
        clear: () => clearTimeout(timer),
        unref: () => {
          timer.unref();
        },
      };
    },
  };
}

function unlockWith(keyring: IKeyring, credential: TKeyringCredential): Promise<IUnlockedKeys> {
  switch (credential.type) {
    case 'passphrase':
      return unlockWithPassphrase(keyring, credential.passphrase);
    case 'recoveryKey':
      return unlockWithRecoveryKey(keyring, credential.recoveryKey);
    default:
      return Promise.reject(
        new KeyringError('invalid-argument', 'The credential type is not recognised.'),
      );
  }
}

export class KeyHolder {
  readonly #store: IKeyringStore;
  readonly #timers: IKeyHolderTimers;
  readonly #idleMs: number;
  readonly #listeners = new Set<(reason: TLockReason) => void>();
  readonly #sealingKeyListeners = new Set<() => void>();
  readonly #openedDataKeys = new OpenedDataKeys();
  #keys: IUnlockedKeys | undefined;
  /** The public key the last unlock derived; kept for good, since a public key is not secret. */
  #verifiedSealingKey: Uint8Array | undefined;
  #idleTimer: IKeyHolderTimer | undefined;
  #lastActivity = 0;
  /** Bumped by every lock, so an unlock still deriving when the lock arrives cannot hand out keys afterwards. */
  #lockGeneration = 0;

  constructor(options: IKeyHolderOptions) {
    const idleMs = options.policy?.idleMs ?? DEFAULT_IDLE_LOCK_MS;
    if (!Number.isSafeInteger(idleMs) || idleMs < 0 || idleMs > MAX_TIMER_DELAY_MS) {
      throw new RangeError(
        `idleMs must be a whole number of milliseconds from 0 to ${MAX_TIMER_DELAY_MS}.`,
      );
    }
    this.#store = options.store;
    this.#timers = options.timers ?? createNodeTimers();
    this.#idleMs = idleMs;
  }

  get isUnlocked(): boolean {
    return this.#keys !== undefined;
  }

  /**
   * Opens the keyring in the store with `credential`. A wrong credential and a tampered slot fail
   * the same way and leave the holder locked. The derived sealing public key is kept as soon as it
   * exists. A stored key that differs is replaced through the store, built on the file as it was read
   * so a concurrent change is never undone, and reported as `repaired`; if the replacement is not
   * confirmed the holder stays locked and throws `SealingKeyMismatchError`, because unlocking on top
   * of a key that could not be put right would hide the problem.
   */
  async unlock(
    credential: TKeyringCredential,
  ): Promise<{ readonly sealingKey: TSealingKeyOutcome }> {
    const generation = this.#lockGeneration;
    const loaded = this.#store.load();
    if (loaded.status === 'missing') throw new KeyringStoreError('missing', this.#store.path);
    const unlocked = await unlockWith(loaded.keyring, credential);
    try {
      // Sealing goes to the verified key from here on, whatever happens next in this call.
      this.#verifySealingKey(unlocked.sealing.publicKey);
      if (generation !== this.#lockGeneration) {
        throw new KeyringError('keys-locked', 'The keys were locked while unlocking.');
      }
      const matches = checkSealingPublicKey(loaded.keyring, unlocked).matches;
      if (!matches) {
        try {
          this.#store.save(repairSealingPublicKey(loaded.keyring, unlocked), loaded.keyring);
        } catch (error) {
          throw new SealingKeyMismatchError(
            fingerprint(getSealingPublicKey(loaded.keyring)),
            fingerprint(unlocked.sealing.publicKey),
            error,
          );
        }
      }
      this.#install(unlocked);
      return { sealingKey: matches ? 'verified' : 'repaired' };
    } catch (error) {
      if (this.#keys !== unlocked) unlocked.lock();
      throw error;
    }
  }

  /** Drops the keys and cancels the idle timer. A no-op, and silent, when already locked. */
  lock(reason: TLockReason): void {
    this.#lockGeneration += 1;
    const keys = this.#keys;
    if (keys === undefined) return;
    this.#openedDataKeys.wipe();
    this.#keys = undefined;
    this.#idleTimer?.clear();
    this.#idleTimer = undefined;
    keys.lock();
    for (const listener of [...this.#listeners]) {
      try {
        listener(reason);
      } catch {
        // allow-fallback: the keys are already gone; one listener's failure must not stop the others.
      }
    }
  }

  /** Marks user activity, so the idle lock counts from now. Not key use: reading with the keys is not activity. */
  touch(): void {
    if (this.#keys !== undefined) this.#lastActivity = this.#timers.now();
  }

  /**
   * Opens a blob sealed to this keyring (`sealBlob`) under `aad`. Throws the keyring's own errors
   * when the blob does not open (damaged, or bound to other data), and `keys-locked` when locked and
   * the blob has the layout a sealed blob has: a torn or foreign fragment is not an intact artifact a
   * later unlock reads, so it never reads as locked. With `reuse`, one key opening serves every blob
   * of a writer epoch until the keys are dropped.
   */
  openBlob(blob: Uint8Array, aad: Uint8Array, options: IOpenBlobOptions = {}): Buffer {
    const { sealedKey, record } = splitSealedBlob(blob);
    const privateKey = this.#requireKeys().sealing.privateKey;
    if (options.reuse !== true) return openBlob(privateKey, blob, aad);
    const dataKey = this.#openedDataKeys.open(aad, sealedKey, () =>
      openArtifactKey(privateKey, sealedKey, aad),
    );
    return decryptRecord(dataKey, record, aad);
  }

  /**
   * `keyring` carrying the verified sealing public key, for a document built while unlocked (a
   * passphrase change), so it never carries forward a key the file was given by someone else.
   * Throws `keys-locked` when locked.
   */
  withVerifiedSealingKey(keyring: IKeyring): IKeyring {
    return repairSealingPublicKey(keyring, this.#requireKeys());
  }

  /** Called with the reason each time the keys go from unlocked to locked. Returns the unsubscribe. */
  onLock(listener: (reason: TLockReason) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Called each time an unlock sets the verified sealing key to a different key than before — the
   * first unlock in this process, or one that verifies another keyring — so whatever seals elsewhere
   * on this process's behalf (a subagent child holding a write grant) can follow it. Called whether or
   * not that unlock then succeeds, since sealing follows the verified key from that moment. Returns
   * the unsubscribe.
   */
  onSealingKeyChange(listener: () => void): () => void {
    this.#sealingKeyListeners.add(listener);
    return () => {
      this.#sealingKeyListeners.delete(listener);
    };
  }

  /**
   * The public key to seal new artifacts to. From the first unlock in this process it is the key that
   * unlock derived, for the life of the holder, even when locked. Before any unlock it is what the
   * file holds, which is all an unverified writer can have.
   */
  sealingPublicKey(): Uint8Array {
    if (this.#verifiedSealingKey !== undefined) return Uint8Array.from(this.#verifiedSealingKey);
    const loaded = this.#store.load();
    if (loaded.status === 'missing') throw new KeyringStoreError('missing', this.#store.path);
    return Uint8Array.from(getSealingPublicKey(loaded.keyring));
  }

  /**
   * The key an unlock in this process verified, or `undefined` before any: what a writer compares its
   * epoch's key with, since sealing must follow the verified key from the moment it exists. Never
   * reads the file.
   */
  verifiedSealingKey(): Uint8Array | undefined {
    return this.#verifiedSealingKey === undefined
      ? undefined
      : Uint8Array.from(this.#verifiedSealingKey);
  }

  #verifySealingKey(publicKey: Uint8Array): void {
    const previous = this.#verifiedSealingKey;
    this.#verifiedSealingKey = Uint8Array.from(publicKey);
    if (previous !== undefined && Buffer.from(previous).equals(this.#verifiedSealingKey)) return;
    for (const listener of [...this.#sealingKeyListeners]) {
      try {
        listener();
      } catch {
        // allow-fallback: the key is already verified; one listener's failure must not stop the unlock or the others.
      }
    }
  }

  #requireKeys(): IUnlockedKeys {
    if (this.#keys === undefined) throw new KeyringError('keys-locked', 'The keys are locked.');
    return this.#keys;
  }

  #install(unlocked: IUnlockedKeys): void {
    this.#openedDataKeys.wipe();
    this.#keys?.lock();
    this.#idleTimer?.clear();
    this.#idleTimer = undefined;
    this.#keys = unlocked;
    this.#lastActivity = this.#timers.now();
    if (this.#idleMs > 0) this.#armIdleTimer(this.#idleMs);
  }

  #armIdleTimer(delayMs: number): void {
    const timer = this.#timers.setTimer(() => this.#onIdleTimer(), delayMs);
    timer.unref();
    this.#idleTimer = timer;
  }

  #onIdleTimer(): void {
    this.#idleTimer = undefined;
    if (this.#keys === undefined) return;
    const idleFor = this.#timers.now() - this.#lastActivity;
    // A clock that went backwards locks too: not knowing how long it has been is not a reason to stay open.
    if (idleFor < 0 || idleFor >= this.#idleMs) this.lock('idle');
    else this.#armIdleTimer(this.#idleMs - idleFor);
  }
}
