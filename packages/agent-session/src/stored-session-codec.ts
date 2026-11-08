/**
 * The stored form of one session record, apart from who wrote it and what a store holds of it: the
 * versioned envelope, plain or sealed to the record's own id, what a store finds at a record's path,
 * and the conversions a migration makes. Stateless; {@link StoredSessionRecords} keeps the rest.
 */

import { Buffer } from 'node:buffer';
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

import type { IArtifactContext, IArtifactSealer } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionRecord,
  TSessionLoadOutcome,
} from '@robota-sdk/agent-interface-session';

/** What a listing says about a sealed file that does not open; fixed, so it can carry no content. */
export const DOES_NOT_OPEN_MESSAGE =
  'the sealed session file does not open for this session: it is damaged or sealed with other keys';

/** What a load says about a record whose own id is another session's; fixed, so it carries no content. */
const OTHER_ID_MESSAGE = 'the record belongs to another session id';

/** How every store names stored bytes: the SHA-256, lowercase hex. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Whether `value` names stored bytes the way the stores do. */
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX.test(value);
}

export function digestOf(stored: Uint8Array): string {
  return createHash('sha256').update(stored).digest('hex');
}

export function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left.buffer, left.byteOffset, left.byteLength).equals(right);
}

/** The id binds a sealed record to its own file, so a record copied to another session's path does not open. */
export function recordContext(id: string): IArtifactContext {
  return { kind: 'session-record', id };
}

export function utf8Text(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
}

/**
 * The versioned envelope of `record` (without a version on disk "written by a build this
 * one does not read" cannot be told from "damaged"), the same pretty-printed JSON the stores always wrote.
 */
export function envelopeText(record: IInteractiveSessionRecord): string {
  return JSON.stringify({ schemaVersion: SESSION_RECORD_ENVELOPE_VERSION, record }, null, 2);
}

/** A stored record: the bytes that go on disk and the plaintext envelope they were made from. */
export interface IEncodedSession {
  readonly stored: Uint8Array;
  readonly text: string;
}

/** The bytes to store for `record`: its envelope, sealed when a sealer is given. */
export function encodeStoredSession(
  record: IInteractiveSessionRecord,
  sealer: IArtifactSealer | undefined,
): IEncodedSession {
  const text = envelopeText(record);
  const bytes = Buffer.from(text, 'utf8');
  return {
    stored: sealer === undefined ? bytes : sealer.sealBytes(bytes, recordContext(record.id)),
    text,
  };
}

/** What a record's stored bytes are to a migration that seals what is still plain. */
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
export function decodeRecordText(id: string, raw: string): TSessionLoadOutcome {
  const outcome = decodeStoredSessionText(raw);
  if (outcome.status !== 'valid' || outcome.record.id === id) return outcome;
  return { status: 'corrupt', issues: [{ path: 'id', message: OTHER_ID_MESSAGE }] };
}

/** Whether plain `bytes` hold a valid record of session `id`: what a migration may offer to mark as the owner's. */
export function isPlainSessionRecordOf(id: string, bytes: Uint8Array): boolean {
  return decodeRecordText(id, utf8Text(bytes)).status === 'valid';
}

/** What a store found at a record's path before it writes over it. */
export type TStoredSessionFile =
  /** Nothing is there: "no such file" and nothing else. */
  | { readonly kind: 'absent' }
  /**
   * Something is there and it is not sealed framing; its bytes when the store read them whole (a store
   * that seals does, so it can tell whether they are exactly what it holds).
   */
  | { readonly kind: 'plain'; readonly bytes?: Uint8Array }
  /** A sealed file, read whole. */
  | { readonly kind: 'sealed'; readonly bytes: Uint8Array }
  /** Something is there and it could not be read: it may be sealed, so it is protected like one. */
  | { readonly kind: 'unreadable' }
  /** Something is there, too large for this store to read back at all. */
  | { readonly kind: 'oversized' };

/** What `bytes` (or their absence) are, for a store that read the whole file. */
export function classifyStoredSessionBytes(bytes: Uint8Array | undefined): TStoredSessionFile {
  if (bytes === undefined) return { kind: 'absent' };
  return isSealedArtifactBytes(bytes) ? { kind: 'sealed', bytes } : { kind: 'plain', bytes };
}

/** The bytes a file was read with, when it was read whole. */
export function bytesOf(file: TStoredSessionFile): Uint8Array | undefined {
  return file.kind === 'sealed' || file.kind === 'plain' ? file.bytes : undefined;
}
