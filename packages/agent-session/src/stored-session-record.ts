/**
 * The bytes a session store keeps for one record, and what it concludes from bytes it finds.
 *
 * Both stores (the user's directory and the trusted project's) write the same envelope and read it
 * back the same way; this is that one place, {@link StoredSessionRecords}. A record is stored in one
 * of two forms:
 *
 * - plain: the versioned JSON envelope, or
 * - sealed: the same JSON bytes sealed by an {@link IArtifactSealer}, bound to the record's own id.
 *
 * A store that seals WRITES sealed and reads both, so a directory part-way through a migration lists
 * correctly and a plain record turns sealed the next time its session is saved. A store that seals
 * nothing writes plain and meets a sealed file as `locked`: this process cannot read it, which is a
 * different fact from "damaged" and from "not there".
 *
 * Locking drops the ability to READ, not to keep saving what a process is already running: sealing
 * needs only the public key, and the process holds its session in memory. So a store remembers, per
 * session id, a digest of the sealed bytes it last wrote or was asked to hold ({@link
 * SealedSessionMemory}), and a save over a file it cannot open goes ahead only when the file is
 * provably exactly those bytes. Anything else on disk is a session this instance never held, or one
 * that changed since, and is not replaced.
 *
 * A file the same OS user can write is never a trust anchor. A sealed file that opens says it is
 * bound to this session's id and unaltered since it was sealed; it says nothing about who sealed it,
 * since anyone with the public key can.
 */

import { createHash } from 'node:crypto';

import {
  isArtifactLockedError,
  isCurrentSealedArtifactBytes,
  isSealedArtifactBytes,
} from '@robota-sdk/agent-core';

import {
  SESSION_RECORD_ENVELOPE_VERSION,
  decodeVersionedInteractiveSessionRecord,
} from './session-record-codec/index.js';

import type { IArtifactContext, IArtifactSealer, TArtifactSealing } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  ISessionExportOptions,
  ISessionLoadOptions,
  ISessionSaveOptions,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

/**
 * How a session store is built. `sealing` is required: every store states whether it keeps its
 * records sealed or plain, because a store that silently kept them plain beside sealed ones would
 * write plaintext next to them. A host that seals states it for every store it builds.
 */
export interface ISessionStoreOptions {
  readonly sealing: TArtifactSealing;
}

/** The sealing `options` state; one that is not a {@link TArtifactSealing} (a call that ignores the types) is refused. */
export function sessionSealingOf(options: ISessionStoreOptions): TArtifactSealing {
  if (typeof options !== 'object' || options === null) {
    throw new TypeError('Session store options must be an object, such as { sealing }.');
  }
  assertSessionSealing(options.sealing);
  return options.sealing;
}

/** Refuses anything that is not a {@link TArtifactSealing}. */
export function assertSessionSealing(value: unknown): asserts value is TArtifactSealing {
  if (value === 'plain') return;
  const sealer =
    typeof value === 'object' && value !== null
      ? (value as { readonly sealer?: unknown }).sealer
      : undefined;
  if (
    typeof sealer === 'object' &&
    sealer !== null &&
    typeof (sealer as Partial<IArtifactSealer>).sealBytes === 'function' &&
    typeof (sealer as Partial<IArtifactSealer>).openBytes === 'function'
  ) {
    return;
  }
  throw new TypeError("A session store states how it seals: { sealer }, or 'plain'.");
}

/** What a listing says about a sealed file that does not open; fixed, so it can carry no content. */
const DOES_NOT_OPEN_MESSAGE =
  'the sealed session file does not open for this session: it is damaged or sealed with other keys';

/** What a load says about a record whose own id is another session's; fixed, so it carries no content. */
const OTHER_ID_MESSAGE = 'the record belongs to another session id';

/** The id binds a sealed record to its own file, so a record copied to another session's path does not open. */
function recordContext(id: string): IArtifactContext {
  return { kind: 'session-record', id };
}

function utf8Text(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

/** A stored record: the bytes that go on disk and the plaintext envelope they were made from. */
export interface IEncodedSession {
  readonly stored: Uint8Array;
  readonly text: string;
}

/**
 * The bytes to store for `record`: the versioned envelope (TRANS-007 — without a version on disk
 * "written by a build this one does not read" cannot be told from "damaged"), sealed when a sealer
 * is given. Plain output is the same pretty-printed JSON the stores always wrote.
 */
export function encodeStoredSession(
  record: IInteractiveSessionRecord,
  sealer: IArtifactSealer | undefined,
): IEncodedSession {
  const text = JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record }, null, 2);
  const bytes = Buffer.from(text, 'utf8');
  return {
    stored: sealer === undefined ? bytes : sealer.sealBytes(bytes, recordContext(record.id)),
    text,
  };
}

/** What a record's stored bytes are to a migration that seals what is still plain (#3679). */
export type TStoredSessionMigrationState =
  /** Not sealed framing: whatever it holds — a valid, corrupt, unsupported or bare record. */
  | 'plain'
  /** Sealed in this build's framing, and it opens for this id. */
  | 'sealed'
  /** Sealed in this build's framing and it does not open for this id: damaged, or other keys. */
  | 'does-not-open'
  /** Sealed in a framing a newer build writes. */
  | 'newer-format';

/**
 * Where the bytes of session `id` stand for a migration: decided by whether they open for this id,
 * never by framing alone. Opening needs the keys unlocked; with them locked it throws
 * `ArtifactLockedError`, since "intact but locked" decides nothing.
 */
export function storedSessionMigrationState(
  id: string,
  stored: Uint8Array,
  sealer: IArtifactSealer,
): TStoredSessionMigrationState {
  if (!isSealedArtifactBytes(stored)) return 'plain';
  if (!isCurrentSealedArtifactBytes(stored)) return 'newer-format';
  let plain: Uint8Array;
  try {
    plain = sealer.openBytes(stored, recordContext(id));
  } catch (error) {
    if (isArtifactLockedError(error)) throw error;
    return 'does-not-open';
  }
  plain.fill(0);
  return 'sealed';
}

/**
 * `raw` — a plain record's bytes exactly as stored, whatever they hold — sealed to session `id`, so a
 * store that opens it reports the same status the plain bytes gave: a corrupt or unsupported record
 * stays one, only no longer readable without the keys.
 */
export function sealStoredSessionBytes(
  id: string,
  raw: Uint8Array,
  sealer: IArtifactSealer,
): Uint8Array {
  return sealer.sealBytes(raw, recordContext(id));
}

/** More sessions than one process runs at once; the oldest is forgotten past this, which only means it is refused while locked. */
const MAX_REMEMBERED_SESSIONS = 32;

/**
 * Fork records written for a handoff and not yet handed over. A fork job is spawned right after its
 * record is written, so a few suffice; the oldest goes first, and its job then needs a fresh fork.
 */
const MAX_HANDOFF_RECORDS = 8;

/** Whether the bytes on disk are the ones a store remembers for an id. */
export type TSealedSessionMatch = 'same' | 'different' | 'unknown';

/**
 * What one store instance last WROTE or was asked to HOLD sealed, per session id: a SHA-256 of the
 * sealed bytes, and the plaintext envelope they hold. The digest is the proof that a file is exactly
 * what this instance put there or read; the plaintext lets a locked process go on updating a session
 * it holds, since it could not read it back from disk. Memory only, never persisted, bounded (by
 * {@link MAX_REMEMBERED_SESSIONS} unless a store keeps a second, smaller one), and a fresh instance
 * (a restart) remembers nothing.
 */
export class SealedSessionMemory {
  readonly #limit: number;
  readonly #entries = new Map<string, { readonly digest: string; readonly text: string }>();

  constructor(limit = MAX_REMEMBERED_SESSIONS) {
    this.#limit = limit;
  }

  get size(): number {
    return this.#entries.size;
  }

  remember(id: string, stored: Uint8Array, text: string): void {
    this.rememberDigest(id, digestOf(stored), text);
  }

  /** {@link remember} for sealed bytes known only by their digest (a record handed over from another process). */
  rememberDigest(id: string, digest: string, text: string): void {
    this.#entries.delete(id);
    this.#entries.set(id, { digest, text });
    for (const oldest of this.#entries.keys()) {
      if (this.#entries.size <= this.#limit) break;
      this.#entries.delete(oldest);
    }
  }

  forget(id: string): void {
    this.#entries.delete(id);
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  compare(id: string, stored: Uint8Array): TSealedSessionMatch {
    const entry = this.#entries.get(id);
    if (entry === undefined) return 'unknown';
    return entry.digest === digestOf(stored) ? 'same' : 'different';
  }

  /** The plaintext envelope remembered for `id`, only when `stored` is exactly the bytes it came from. */
  textIfSame(id: string, stored: Uint8Array): string | undefined {
    return this.compare(id, stored) === 'same' ? this.#entries.get(id)?.text : undefined;
  }
}

function digestOf(stored: Uint8Array): string {
  return createHash('sha256').update(stored).digest('hex');
}

/**
 * A held record as it crosses to another process: `rsh1.`, the SHA-256 of the sealed bytes it came
 * from, and the canonical unpadded base64url of the plaintext envelope. The digest is what the
 * receiving store compares the file with before it trusts the record over it.
 */
const HELD_TOKEN_PREFIX = 'rsh1.';
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

function formatHeldToken(digest: string, text: string): string {
  return `${HELD_TOKEN_PREFIX}${digest}.${Buffer.from(text, 'utf8').toString('base64url')}`;
}

/** The digest and envelope a token names, or `undefined` for anything this build does not issue. */
function parseHeldToken(
  token: unknown,
): { readonly digest: string; readonly text: string } | undefined {
  if (typeof token !== 'string' || !token.startsWith(HELD_TOKEN_PREFIX)) return undefined;
  const rest = token.slice(HELD_TOKEN_PREFIX.length);
  const separator = rest.indexOf('.');
  const digest = rest.slice(0, separator);
  const encoded = rest.slice(separator + 1);
  if (separator < 0 || !DIGEST_PATTERN.test(digest) || !BASE64URL_PATTERN.test(encoded)) {
    return undefined;
  }
  const bytes = Buffer.from(encoded, 'base64url');
  if (bytes.toString('base64url') !== encoded) return undefined;
  try {
    return { digest, text: STRICT_UTF8.decode(bytes) };
  } catch {
    return undefined;
  }
}

/** Decode envelope text into an outcome, keeping "not JSON" and "not a record" the same answer. */
export function decodeStoredSessionText(raw: string): TSessionLoadOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      status: 'corrupt',
      issues: [{ path: '', message: 'the session file is not JSON' }],
    };
  }
  const outcome = decodeVersionedInteractiveSessionRecord(parsed);
  if (outcome.status === 'valid') return { status: 'valid', record: outcome.record };
  if (outcome.status === 'unsupported') {
    return {
      status: 'unsupported',
      schemaVersion: outcome.schemaVersion,
      ...(outcome.cwd !== undefined ? { cwd: outcome.cwd } : {}),
    };
  }
  return {
    status: 'corrupt',
    issues: outcome.issues,
    ...(outcome.cwd !== undefined ? { cwd: outcome.cwd } : {}),
  };
}

/**
 * {@link decodeStoredSessionText} for the record stored under `id`. A record that names another
 * session is not this session's, wherever it was copied from, so it is `corrupt` — the same for a
 * plain file, which anyone can copy, and a sealed one, which opens here only when sealed to this id.
 */
function decodeRecordText(id: string, raw: string): TSessionLoadOutcome {
  const outcome = decodeStoredSessionText(raw);
  if (outcome.status !== 'valid' || outcome.record.id === id) return outcome;
  return { status: 'corrupt', issues: [{ path: 'id', message: OTHER_ID_MESSAGE }] };
}

/** What a store found at a record's path before it writes over it. */
export type TStoredSessionFile =
  /** Nothing is there: "no such file" and nothing else. */
  | { readonly kind: 'absent' }
  /** Something is there and it is not sealed framing. */
  | { readonly kind: 'plain' }
  /** A sealed file, read whole. */
  | { readonly kind: 'sealed'; readonly bytes: Uint8Array }
  /** Something is there and it could not be read: it may be sealed, so it is protected like one. */
  | { readonly kind: 'unreadable' }
  /** Something is there, too large for this store to read back at all. */
  | { readonly kind: 'oversized' };

/** What `bytes` (or their absence) are, for a store that read the whole file. */
export function classifyStoredSessionBytes(bytes: Uint8Array | undefined): TStoredSessionFile {
  if (bytes === undefined) return { kind: 'absent' };
  return isSealedArtifactBytes(bytes) ? { kind: 'sealed', bytes } : { kind: 'plain' };
}

/** Why a save was refused; each one is something the store saw, not a guess about who wrote what. */
export type TSealedSessionRefusal =
  /** A sealed file it cannot open while the keys are locked, and has no proof it wrote or holds. */
  | 'locked'
  /** A sealed file that does not open here: damaged, or sealed with other keys that may still open it. */
  | 'does-not-open'
  /** A sealed file it cannot open, and different from the bytes it last wrote or held. */
  | 'changed'
  /** A file it could not read, or one too large for it to read back. */
  | 'unreadable'
  /** A file sealed in a framing version this build does not open, so written by a newer one. */
  | 'newer-format'
  /** A sealed file, and this store seals nothing, so this process has no keys for it at all. */
  | 'no-keys';

function refusalMessage(sessionId: string, reason: TSealedSessionRefusal): string {
  switch (reason) {
    case 'locked':
      return `Session ${sessionId} is sealed and locked, so it was not overwritten; unlock to open it.`;
    case 'does-not-open':
      return `Session ${sessionId} holds a sealed record that does not open for this session, so it was not overwritten.`;
    case 'changed':
      return `Session ${sessionId} changed on disk since this process last wrote or read it, so it was not overwritten.`;
    case 'unreadable':
      return `Session ${sessionId} could not be read, so it was not overwritten.`;
    case 'newer-format':
      return `Session ${sessionId} was sealed by a newer build, so it was not overwritten.`;
    case 'no-keys':
      return `Session ${sessionId} is sealed and this process has no keys that open it, so it was not overwritten.`;
  }
}

/**
 * Thrown by a store's `save` when the file already at that id may be a session nobody here can
 * read: sealed and not openable by this store, not provably what this store wrote or holds, not
 * readable at all, or sealed by a newer build. Overwriting would destroy what may be the only copy
 * of a session — `locked` is intact and a later unlock reads it, and a sealed file that does not open
 * here may open under other keys — so the save is refused and the file is left exactly as it was.
 */
export class SealedSessionUnreadableError extends Error {
  readonly code = 'SESSION_SEALED_UNREADABLE' as const;
  readonly sessionId: string;
  readonly reason: TSealedSessionRefusal;

  constructor(sessionId: string, reason: TSealedSessionRefusal) {
    super(refusalMessage(sessionId, reason));
    this.name = 'SealedSessionUnreadableError';
    this.sessionId = sessionId;
    this.reason = reason;
  }
}

/** Whether `error` is a {@link SealedSessionUnreadableError}, by `code` so a second bundle's copy still matches. */
export function isSealedSessionUnreadableError(
  error: unknown,
): error is SealedSessionUnreadableError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === 'SESSION_SEALED_UNREADABLE'
  );
}

/** The text a sealed file holds, or why this process cannot get it. */
type TOpened =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'locked' }
  | { readonly kind: 'no-keys' }
  | { readonly kind: 'does-not-open' };

/** A sealed file a store that seals nothing meets: intact, and no key in this process opens it. */
const NO_KEYS_OUTCOME: TSessionLoadOutcome = Object.freeze({ status: 'locked', reason: 'no-keys' });
/** A session this instance holds whose file is no longer the bytes it wrote or read. */
const CHANGED_OUTCOME: TSessionLoadOutcome = Object.freeze({ status: 'locked', reason: 'changed' });

/**
 * One store's stored form of its records: how it encodes, decodes, guards a replace and remembers
 * what it holds. Both stores route every read and write of a record through one of these, so the
 * user's directory and the trusted project's cannot disagree about what a file means.
 */
export class StoredSessionRecords {
  readonly #sealer: IArtifactSealer | undefined;
  readonly #memory = new SealedSessionMemory();
  /**
   * Records written for a handoff (a fork another process will run), apart from {@link #memory}
   * so a fork never pushes out a session this process is running. Each is handed over once.
   */
  readonly #handoffs = new SealedSessionMemory(MAX_HANDOFF_RECORDS);

  constructor(sealing: TArtifactSealing) {
    assertSessionSealing(sealing);
    this.#sealer = sealing === 'plain' ? undefined : sealing.sealer;
  }

  /** Whether this store writes its records sealed. */
  get seals(): boolean {
    return this.#sealer !== undefined;
  }

  encode(record: IInteractiveSessionRecord): IEncodedSession {
    return encodeStoredSession(record, this.#sealer);
  }

  /**
   * What the stored bytes of session `id` say. A sealed file in a framing version this build does
   * not open is `unsupported`; one the keys cannot open is `locked`; one that does not open is
   * `corrupt`; an opened file is decoded exactly like a plain one, and either is `corrupt` when its
   * record names another session. Never throws.
   *
   * Only a load that asks to `hold` remembers a sealed record it opened, so that this instance can go
   * on saving the session after the keys lock; a probe remembers nothing, and so can never push a
   * held session out of the bounded memory or keep plaintext it was only looking at.
   */
  decode(id: string, stored: Uint8Array, options: ISessionLoadOptions = {}): TSessionLoadOutcome {
    if (!isSealedArtifactBytes(stored)) return decodeRecordText(id, utf8Text(stored));
    if (!isCurrentSealedArtifactBytes(stored)) {
      return { status: 'unsupported', schemaVersion: undefined };
    }
    const opened = this.#open(id, stored);
    if (opened.kind === 'locked') return { status: 'locked' };
    if (opened.kind === 'no-keys') return NO_KEYS_OUTCOME;
    if (opened.kind === 'does-not-open') {
      return { status: 'corrupt', issues: [{ path: '', message: DOES_NOT_OPEN_MESSAGE }] };
    }
    const outcome = decodeRecordText(id, opened.text);
    if (options.hold === true && outcome.status === 'valid') {
      this.#memory.remember(id, stored, opened.text);
    }
    return outcome;
  }

  /**
   * Throws {@link SealedSessionUnreadableError} unless `existing` (what is at session `id`'s path now)
   * may be replaced by a save. Absence and a plain file may. A sealed file may when it is provably
   * exactly the bytes this instance last wrote or holds — checked first, since it needs no keys and
   * no decryption — or when this store can open it. Anything it could not read, anything sealed by a
   * newer build, and anything sealed it can neither open nor recognise is refused.
   *
   * The check and the write are two steps, so two writers saving one session at the same moment can
   * still replace each other, as plain records always could; what the check stops is a store
   * replacing a sealed session that nobody in this process can read.
   */
  assertReplaceable(id: string, existing: TStoredSessionFile): void {
    switch (existing.kind) {
      case 'absent':
      case 'plain':
        return;
      case 'unreadable':
        throw new SealedSessionUnreadableError(id, 'unreadable');
      case 'oversized':
        // Nothing past the read limit can be shown to be anything. A store that seals protects it,
        // since it may be a sealed session; one that seals nothing replaces it.
        if (this.seals) throw new SealedSessionUnreadableError(id, 'unreadable');
        return;
      case 'sealed':
        break;
    }
    const bytes = existing.bytes;
    if (!isCurrentSealedArtifactBytes(bytes)) {
      throw new SealedSessionUnreadableError(id, 'newer-format');
    }
    const match = this.#memory.compare(id, bytes);
    if (match === 'same') return;
    const opened = this.#open(id, bytes);
    if (opened.kind === 'text') return;
    throw new SealedSessionUnreadableError(
      id,
      match === 'different'
        ? 'changed'
        : opened.kind === 'locked' || opened.kind === 'no-keys'
          ? opened.kind
          : 'does-not-open',
    );
  }

  /**
   * Records that `encoded` is now at session `id`'s path — after a write that completed, or one whose
   * bytes reached the path before a later step failed — so the next save recognises them as its own.
   * A `handoff` write is kept for one {@link exportHeld} instead of among the sessions this instance
   * runs: the record is another process's to run.
   */
  wrote(id: string, encoded: IEncodedSession, options: ISessionSaveOptions = {}): void {
    if (this.#sealer === undefined) {
      this.forget(id);
      return;
    }
    const [keep, drop] =
      options.handoff === true ? [this.#handoffs, this.#memory] : [this.#memory, this.#handoffs];
    drop.forget(id);
    keep.remember(id, encoded.stored, encoded.text);
  }

  /**
   * {@link wrote} after a write that threw: remembers `encoded` only when `existing` (what is at the
   * path now) is exactly its sealed bytes, since a write can fail before or after putting them there.
   */
  wroteIfPresent(
    id: string,
    encoded: IEncodedSession,
    existing: TStoredSessionFile,
    options: ISessionSaveOptions = {},
  ): void {
    if (
      this.#sealer !== undefined &&
      existing.kind === 'sealed' &&
      Buffer.from(existing.bytes).equals(Buffer.from(encoded.stored))
    ) {
      this.wrote(id, encoded, options);
    }
  }

  /**
   * The record this instance itself last wrote or holds, for a writer whose `load` said `locked`:
   * offered only while `existing` is exactly the bytes it remembers. `undefined` when it holds
   * nothing for `id`; `locked` with the reason `changed` when it does and the file is no longer those
   * bytes, so the writer can say which of the two stopped it.
   *
   * A handoff record is offered too (a fork job run in this very process), and from then on it is a
   * session this instance runs, since the writer asking is about to save it.
   */
  held(id: string, existing: TStoredSessionFile): TSessionLoadOutcome | undefined {
    if (!this.#memory.has(id)) return this.#takeHandoff(id, existing);
    if (existing.kind !== 'sealed') return CHANGED_OUTCOME;
    const text = this.#memory.textIfSame(id, existing.bytes);
    return text === undefined ? CHANGED_OUTCOME : decodeRecordText(id, text);
  }

  /**
   * The sealed record of session `id` as a token another store over the same files can take with
   * {@link importHeld}: a handoff record while `existing` is still its bytes (handed over once, or
   * left in place with `keep`), or else the record opened from `existing` — a probe that holds
   * nothing. `undefined` when this store seals nothing (anyone with the store reads its records from
   * disk), when `existing` is not a sealed file this build opens, or when the keys are locked and no
   * handoff record matches.
   */
  exportHeld(
    id: string,
    existing: TStoredSessionFile,
    options: ISessionExportOptions = {},
  ): string | undefined {
    if (this.#sealer === undefined || existing.kind !== 'sealed') return undefined;
    if (!isCurrentSealedArtifactBytes(existing.bytes)) return undefined;
    const digest = digestOf(existing.bytes);
    const handedOff = this.#handoffs.textIfSame(id, existing.bytes);
    if (options.keep !== true) this.#handoffs.forget(id);
    if (handedOff !== undefined) return formatHeldToken(digest, handedOff);
    const opened = this.#open(id, existing.bytes);
    if (opened.kind !== 'text' || decodeRecordText(id, opened.text).status !== 'valid') {
      return undefined;
    }
    return formatHeldToken(digest, opened.text);
  }

  /**
   * Holds the record a token from {@link exportHeld} carries, as though this instance had read it:
   * {@link held} offers it, and {@link assertReplaceable} lets a save replace exactly the sealed bytes
   * the token names — so a store that cannot open the file (a write-only subagent process) can go on
   * with the session. Throws `TypeError` (fixed text) for a token this build does not issue, one that
   * does not hold a valid record of session `id`, and in a store that seals nothing: it would write
   * the record in plaintext over the sealed one.
   */
  importHeld(id: string, token: string): void {
    if (this.#sealer === undefined) {
      throw new TypeError(
        'A store that seals nothing does not take a held record: it would write it in plaintext.',
      );
    }
    const parsed = parseHeldToken(token);
    if (parsed === undefined)
      throw new TypeError('The held record is not a token this build issues.');
    if (decodeRecordText(id, parsed.text).status !== 'valid') {
      throw new TypeError('The held record is not a valid record of this session.');
    }
    this.#handoffs.forget(id);
    this.#memory.rememberDigest(id, parsed.digest, parsed.text);
  }

  forget(id: string): void {
    this.#memory.forget(id);
    this.#handoffs.forget(id);
  }

  /** A handoff record of `id` for a writer in this process, held from now on; consumed either way. */
  #takeHandoff(id: string, existing: TStoredSessionFile): TSessionLoadOutcome | undefined {
    if (!this.#handoffs.has(id)) return undefined;
    const text =
      existing.kind === 'sealed' ? this.#handoffs.textIfSame(id, existing.bytes) : undefined;
    this.#handoffs.forget(id);
    if (text === undefined || existing.kind !== 'sealed') return CHANGED_OUTCOME;
    this.#memory.remember(id, existing.bytes, text);
    return decodeRecordText(id, text);
  }

  /** Opens a current-framing sealed file, wiping the plaintext buffer once it is turned into text. */
  #open(id: string, stored: Uint8Array): TOpened {
    // A sealed file and no sealer: there are no keys in this process at all. Like locked keys, the
    // file is intact and not readable from here — but no unlock in this process would open it.
    if (this.#sealer === undefined) return { kind: 'no-keys' };
    let plain: Uint8Array;
    try {
      plain = this.#sealer.openBytes(stored, recordContext(id));
    } catch (error) {
      // A write-only sealer (a process handed only a write grant) holds no keys either.
      if (isArtifactLockedError(error)) {
        return (error as { readonly reason?: unknown }).reason === 'no-keys'
          ? { kind: 'no-keys' }
          : { kind: 'locked' };
      }
      // Any other failure of the sealer is no evidence the file is fine, and it must neither take a
      // listing down nor read as an absent file: it is reported as a file that does not open.
      return { kind: 'does-not-open' };
    }
    try {
      return { kind: 'text', text: utf8Text(plain) };
    } finally {
      plain.fill(0);
    }
  }
}
