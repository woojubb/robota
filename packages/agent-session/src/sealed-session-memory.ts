/**
 * What one store instance that seals knows of each session id, and the token a held record crosses
 * to another process as.
 *
 * Locking drops the ability to READ, not to keep saving what a process is already running: sealing
 * needs only the public key, and the process holds its session in memory. So a store remembers, per
 * id, the digest of the sealed bytes it last wrote or was asked to hold, the plaintext envelope they
 * hold, and whose they are — the digest proves a file is exactly what this instance put there or
 * read, and the plaintext lets a locked process go on updating a session it could not read back. A
 * fork record written for another process is remembered apart, so a fork never pushes a running
 * session out. Beside them it keeps which ids it handed unverified content out for (never tagged
 * again until the owner adopts them) and which owner bytes wait for a tag. Memory only, never
 * persisted, and a fresh instance (a restart)
 * knows nothing; what it remembers is bounded except for the records a running session needs.
 */

import { Buffer } from 'node:buffer';

import { isSha256Hex } from './stored-session-codec.js';

/**
 * Whose a store holds remembered bytes to be. `owner`: bytes it wrote from the owner's content, bytes
 * it opened whose authorship tag verifies, or bytes the owner adopted. `pinned`: a record a write-only
 * child was handed (`importHeld`) and its own later writes of it, judged by exact bytes only, since it
 * holds no keys. `unverified`: anything else.
 */
export type THeldRecordKind = 'owner' | 'pinned' | 'unverified';

/** Stored bytes a store remembers for one id: their digest, the envelope they hold, and whose they are. */
export interface IRememberedRecord {
  readonly digest: string;
  readonly text: string;
  readonly kind: THeldRecordKind;
  /**
   * A `pinned` record the process that handed it over held as the owner's. That process holds the
   * keys and started this one, so its word is what a write-only child has for whose the record is.
   */
  readonly vouched?: true;
}

/** Everything one store instance knows of one id. */
export interface ISessionRecordState {
  /** The bytes it last wrote or read to hold, for a session it runs or may go on saving. */
  readonly held?: IRememberedRecord;
  /** A record a handoff save left for another process to run, until it is handed over or taken. */
  readonly handoff?: IRememberedRecord;
  /** A read handed a writer content of the id that nobody vouched for while nothing here ran it. */
  readonly tainted: boolean;
  /** Owner bytes the locked keys could not tag: tagged at the next unlock if still in place. */
  readonly pendingDigest?: string;
}

/** More sessions than one process runs at once; the oldest is forgotten past this, which only means it is refused while locked. */
const MAX_HELD_RECORDS = 32;
/**
 * Fork records written for a handoff and not yet handed over. A fork job is spawned right after its
 * record is written, so a few suffice; the oldest goes first, and its job then needs a fresh fork.
 */
const MAX_HANDOFF_RECORDS = 8;

type TMutableState = { -readonly [K in keyof ISessionRecordState]: ISessionRecordState[K] };

/** The per-id state of one store that seals; see the module documentation. */
export class SealedSessionMemory {
  readonly #states = new Map<string, TMutableState>();
  /** Held ids, oldest first, for the bound. */
  readonly #heldOrder = new Set<string>();
  readonly #handoffOrder = new Set<string>();
  readonly #keepsHeld: (id: string) => boolean;

  /** @param keepsHeld whether an id's held record must outlast the bound: a session here runs it. */
  constructor(keepsHeld: (id: string) => boolean = () => false) {
    this.#keepsHeld = keepsHeld;
  }

  /** How many held records it remembers now. */
  get size(): number {
    return this.#heldOrder.size;
  }

  state(id: string): ISessionRecordState | undefined {
    return this.#states.get(id);
  }

  /** Remembers `record` as what it holds for `id`, the newest; the oldest it may forget goes past the bound. */
  hold(id: string, record: IRememberedRecord): void {
    this.#edit(id).held = record;
    this.#heldOrder.delete(id);
    this.#heldOrder.add(id);
    for (const oldest of this.#heldOrder) {
      if (this.#heldOrder.size <= MAX_HELD_RECORDS) break;
      if (this.#states.get(oldest)?.held?.kind === 'pinned' || this.#keepsHeld(oldest)) continue;
      this.dropHeld(oldest);
    }
  }

  /** Remembers `record` as the record a handoff save left for `id`. */
  holdHandoff(id: string, record: IRememberedRecord): void {
    this.#edit(id).handoff = record;
    this.#handoffOrder.delete(id);
    this.#handoffOrder.add(id);
    for (const oldest of this.#handoffOrder) {
      if (this.#handoffOrder.size <= MAX_HANDOFF_RECORDS) break;
      this.dropHandoff(oldest);
    }
  }

  dropHeld(id: string): void {
    this.#heldOrder.delete(id);
    this.#settle(id, (state) => delete state.held);
  }

  dropHandoff(id: string): void {
    this.#handoffOrder.delete(id);
    this.#settle(id, (state) => delete state.handoff);
  }

  taint(id: string): void {
    this.#edit(id).tainted = true;
  }

  untaint(id: string): void {
    this.#settle(id, (state) => (state.tainted = false));
  }

  setPending(id: string, digest: string): void {
    this.#edit(id).pendingDigest = digest;
  }

  clearPending(id: string): void {
    this.#settle(id, (state) => delete state.pendingDigest);
  }

  /** Every id with owner bytes that wait for a tag, and those bytes' digest. */
  pending(): readonly (readonly [string, string])[] {
    const pending: [string, string][] = [];
    for (const [id, state] of this.#states) {
      if (state.pendingDigest !== undefined) pending.push([id, state.pendingDigest]);
    }
    return pending;
  }

  /** Forgets the id's records and pending tag: the session is deleted. A taint outlives it. */
  forget(id: string): void {
    this.#heldOrder.delete(id);
    this.#handoffOrder.delete(id);
    this.#settle(id, (state) => {
      delete state.held;
      delete state.handoff;
      delete state.pendingDigest;
    });
  }

  #edit(id: string): TMutableState {
    let state = this.#states.get(id);
    if (state === undefined) {
      state = { tainted: false };
      this.#states.set(id, state);
    }
    return state;
  }

  /** Applies `change` to the id's state, and drops a state that is left knowing nothing. */
  #settle(id: string, change: (state: TMutableState) => unknown): void {
    const state = this.#states.get(id);
    if (state === undefined) return;
    change(state);
    if (
      state.held === undefined &&
      state.handoff === undefined &&
      state.pendingDigest === undefined &&
      !state.tainted
    ) {
      this.#states.delete(id);
    }
  }
}

/**
 * A held record as it crosses to another process: `rsh2.`, whose the record was to the store that
 * handed it over (`owner` or `unverified`), the SHA-256 of the sealed bytes it came from, and the
 * canonical unpadded base64url of the plaintext envelope. The digest is what the receiving store
 * compares the file with before it trusts the record over it; whose it was is the only word a
 * receiver without keys has for it.
 */
const HELD_TOKEN_PREFIX = 'rsh2.';
/** Whose the handed record was to the store that handed it over, as the token says it. */
const HELD_TOKEN_KINDS = { owner: true, unverified: false } as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

export function formatHeldToken(digest: string, text: string, owner: boolean): string {
  const kind = owner ? 'owner' : 'unverified';
  return `${HELD_TOKEN_PREFIX}${kind}.${digest}.${Buffer.from(text, 'utf8').toString('base64url')}`;
}

/**
 * The digest and envelope a token names, and whether the store that issued it held the record as the
 * owner's; `undefined` for anything this build does not issue.
 */
export function parseHeldToken(
  token: unknown,
): { readonly digest: string; readonly text: string; readonly owner: boolean } | undefined {
  if (typeof token !== 'string' || !token.startsWith(HELD_TOKEN_PREFIX)) return undefined;
  const [kind, digest, encoded, ...extra] = token.slice(HELD_TOKEN_PREFIX.length).split('.');
  if (kind !== 'owner' && kind !== 'unverified') return undefined;
  if (extra.length > 0 || digest === undefined || encoded === undefined) return undefined;
  if (!isSha256Hex(digest) || !BASE64URL_PATTERN.test(encoded)) return undefined;
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) return undefined;
  try {
    return { digest, text: STRICT_UTF8.decode(bytes), owner: HELD_TOKEN_KINDS[kind] };
  } catch {
    return undefined;
  }
}
