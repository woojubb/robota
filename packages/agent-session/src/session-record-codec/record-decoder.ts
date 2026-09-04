/**
 * TRANS-005 (#2081) — the total decoder for a persisted interactive-session record, and the
 * versioned envelope that carries one.
 *
 * ## Why the version is in an envelope and not in the record
 *
 * `IInteractiveSessionRecord` has no version member, and this codec does not add one. A REQUIRED
 * member would oblige every producer to set it, and migrating producers is another leaf's work; an
 * OPTIONAL one would mean absent-is-acceptable, which is the permissive reader this codec exists to
 * remove. An envelope keeps the version mandatory exactly where it is checked, and leaves every
 * producer untouched until the leaf that migrates it.
 */

import { atKey } from './decode-outcome.js';
import { decodeMessage } from './message-decoders.js';
import { applyOptionalRecordMembers } from './record-optional-members.js';
import {
  decodeArray,
  decodeDeclaredObject,
  decodeString,
  decodeTimestampString,
} from './scalars.js';

import type { TDecodeIssues, TSessionRecordDecodeOutcome } from './decode-outcome.js';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

/**
 * The version of the persisted record envelope this build reads and writes.
 *
 * Bump it when the shape changes in a way an older reader would decode WRONGLY rather than not at
 * all. A reader that meets a version it does not implement reports `unsupported` and stops — it does
 * not decode the members it recognises, because a partially decoded session is the silent
 * field-loss this codec replaces.
 *
 * ONE concept, not two (issue #2185): the envelope `{ schemaVersion, record }` and the record it
 * wraps version together — a change to either shape bumps this number, and every consumer of the
 * envelope reads it: the portable session artifact (`serializeSessionArtifact`) and the session
 * store (`NodeSessionStore.save`, `WorkspaceSessionStore`). Two constants would let an envelope-only
 * change reject records that are fine, and the two shapes have never moved apart. The constant is
 * therefore named for the pair it versions, not for its first consumer: TRANS-006 kept the
 * incumbent `SESSION_ARTIFACT_SCHEMA_VERSION` (published, written by the producing path) over the
 * duplicate TRANS-005 introduced, and #2185 renamed it here — prerelease, so no alias.
 *
 * Its DECLARATION lives here rather than beside the artifact functions because `session-artifact.ts`
 * imports this module; declaring it there and importing it back would be a module cycle. The export
 * from the package barrel is unchanged.
 */
export const SESSION_RECORD_ENVELOPE_VERSION = 1;

/** A persisted record with the version of the shape it was written in. */
export interface IVersionedInteractiveSessionRecord {
  schemaVersion: number;
  record: IInteractiveSessionRecord;
}

/**
 * Every key the record contract declares.
 *
 * Exported so a test can compare it against `keyof IInteractiveSessionRecord`: a member added to the
 * contract without a branch below then fails that comparison rather than being silently dropped by
 * a decoder that never heard of it.
 */
export const INTERACTIVE_SESSION_RECORD_KEYS: readonly string[] = [
  'id',
  'name',
  'cwd',
  'createdAt',
  'updatedAt',
  'messages',
  'history',
  'systemPrompt',
  'toolSchemas',
  'backgroundTasks',
  'backgroundTaskEvents',
  'backgroundJobGroups',
  'backgroundJobGroupEvents',
  'skillActivationEvents',
  'memoryEvents',
  'usedMemoryReferences',
  'contextReferences',
  'sandboxSnapshotId',
  'goal',
  'plan',
  'activeBranch',
];

/**
 * Decode a bare persisted record.
 *
 * The value is decoded, never cast: what comes back is either a record every member of which was
 * checked, or the list of every place it failed — not the first place.
 */
export function decodeInteractiveSessionRecord(value: unknown): TSessionRecordDecodeOutcome {
  const issues: TDecodeIssues = [];
  const record = decodeRecordInto(value, '', issues);
  if (record === undefined || issues.length > 0) {
    return { status: 'corrupt', issues };
  }
  return { status: 'valid', record };
}

/**
 * Decode a versioned envelope.
 *
 * The version is read BEFORE the record, and a version this build does not implement returns
 * `unsupported` WITHOUT nested issues: reporting field defects against a shape from another version
 * describes the reader's expectations, not the data's condition, and a caller cannot act on it.
 */
export function decodeVersionedInteractiveSessionRecord(
  value: unknown,
): TSessionRecordDecodeOutcome {
  const issues: TDecodeIssues = [];
  const envelope = decodeDeclaredObject(value, '', issues, ['schemaVersion', 'record']);
  if (envelope === undefined) return { status: 'corrupt', issues };

  const declaredVersion = envelope['schemaVersion'];
  if (typeof declaredVersion !== 'number' || !Number.isFinite(declaredVersion)) {
    return { status: 'unsupported', schemaVersion: undefined };
  }
  if (declaredVersion !== SESSION_RECORD_ENVELOPE_VERSION) {
    return { status: 'unsupported', schemaVersion: declaredVersion };
  }

  const record = decodeRecordInto(envelope['record'], 'record', issues);
  if (record === undefined || issues.length > 0) {
    return { status: 'corrupt', issues };
  }
  return { status: 'valid', record };
}

/** The record decode itself, at whatever path it sits (the root, or `record` inside an envelope). */
function decodeRecordInto(
  value: unknown,
  path: string,
  issues: TDecodeIssues,
): IInteractiveSessionRecord | undefined {
  const raw = decodeDeclaredObject(value, path, issues, INTERACTIVE_SESSION_RECORD_KEYS);
  if (raw === undefined) return undefined;

  const id = decodeString(raw['id'], atKey(path, 'id'), issues);
  const cwd = decodeString(raw['cwd'], atKey(path, 'cwd'), issues);
  const createdAt = decodeTimestampString(raw['createdAt'], atKey(path, 'createdAt'), issues);
  const updatedAt = decodeTimestampString(raw['updatedAt'], atKey(path, 'updatedAt'), issues);
  // `messages` is the one required array. An absent one reaches `decodeArray` as `undefined` and is
  // reported there like any other non-array, so it needs no case of its own.
  const messages = decodeArray(raw['messages'], atKey(path, 'messages'), issues, decodeMessage);

  if (
    id === undefined ||
    cwd === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    messages === undefined
  ) {
    return undefined;
  }

  const record: IInteractiveSessionRecord = { id, cwd, createdAt, updatedAt, messages };
  applyOptionalRecordMembers(record, raw, path, issues);
  return record;
}
