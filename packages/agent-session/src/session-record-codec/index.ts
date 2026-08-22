/**
 * TRANS-005 (#2081) — the persisted interactive-session record codec.
 *
 * The single runtime owner of "is this a valid session record?", living beside the contract it
 * decodes. Every store, artifact, handoff and replay ingress is meant to reach the record through
 * here rather than through a cast of its own.
 *
 * ## Why it lives in a contract package
 *
 * Three packages consume `IInteractiveSessionRecord` without depending on the session runtime, so a
 * decoder placed in that runtime would be a validator half the type's consumers cannot reach. This
 * package's own rule is what makes the placement affordable: the codec is pure — no classes, no I/O,
 * no dependency edge beyond the one this package already has — exactly like the type guards that
 * already ship from it.
 */

export {
  INTERACTIVE_SESSION_RECORD_KEYS,
  INTERACTIVE_SESSION_RECORD_VERSION,
  decodeInteractiveSessionRecord,
  decodeVersionedInteractiveSessionRecord,
} from './record-decoder.js';

export type { IVersionedInteractiveSessionRecord } from './record-decoder.js';
export type { ISessionRecordDecodeIssue, TSessionRecordDecodeOutcome } from './decode-outcome.js';
