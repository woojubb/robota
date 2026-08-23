/**
 * SELFHOST-014 — the neutral export/import envelope for a session, over `IInteractiveSessionRecord`.
 *
 * This is a RECORD-TRANSPORT sibling of the file-backed `session-store.ts` (SRP: transport vs file persistence).
 * It is the async, durable COMPLEMENT to REMOTE-001's live P2P channel — export a thread to a portable artifact,
 * hand it off, import + resume it later on a second surface, with both peers possibly offline. No transport, no
 * pairing, no wire protocol.
 *
 * Two operations, specified separately and never conflated:
 *   1. Round-trip serialize (fidelity, local): `serializeSessionArtifact(record)` with no transform is
 *      full-fidelity — `deserializeSessionArtifact(serializeSessionArtifact(record))` deep-equals the record.
 *      (Precondition: `IInteractiveSessionRecord` is JSON-safe, as it is by construction — it is the on-disk file-store
 *      shape; a non-JSON value like a `Date`/`Map`/class instance nested in a payload would not round-trip.)
 *   2. Export-for-share: `serializeSessionArtifact(record, { redact })` applies a caller-supplied, policy-free
 *      `redact` transform BEFORE writing bytes. The envelope selects NO fields and owns NO field policy — the app
 *      builds `redact` (composing the opt-in `scrubSensitiveKeys`). The no-transform form stays full-fidelity.
 *
 * Neutrality (mechanically fenced — TC-05): this module is pure serialize/deserialize + a schema-version header +
 * the app-supplied `redact` seam. It carries NO link/cloud/upload/access-control and NO redaction FIELD policy.
 */

import {
  SESSION_ARTIFACT_SCHEMA_VERSION,
  decodeVersionedInteractiveSessionRecord,
} from './session-record-codec/index.js';

import type { IVersionedInteractiveSessionRecord } from './session-record-codec/index.js';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

/**
 * TRANS-006: the envelope type and its version constant are the codec's (`session-record-codec/`).
 * They used to be declared here as `ISessionArtifact` and a local constant, which was a second name
 * and a second number for one shape — the envelope the codec decodes and the envelope this module
 * writes were always the same `{ schemaVersion, record }`. Nothing on disk changed when they were
 * unified, because there was nothing to change.
 */

export interface ISerializeSessionArtifactOptions {
  /**
   * SHARE-PATH ONLY. An app-supplied, policy-free transform applied to the record before serialization — the app
   * decides which trust-boundary fields to strip (composing the opt-in `scrubSensitiveKeys`). Omit for the
   * full-fidelity local round-trip.
   */
  redact?: (record: IInteractiveSessionRecord) => IInteractiveSessionRecord;
}

/** How many decode issues an error message carries before it elides the rest. */
const MAX_REPORTED_ISSUES = 5;

/**
 * Parse the bytes, reporting a non-JSON body the same way a non-record body is reported.
 *
 * `JSON.parse` throwing and the decoder refusing are the same failure for a caller — the bytes are
 * not an artifact — so they are not two different exceptions to catch.
 */
function parseArtifactBytes(bytes: string): unknown {
  try {
    return JSON.parse(bytes) as unknown;
  } catch {
    throw new Error('Invalid session artifact: the bytes are not JSON.');
  }
}

/**
 * Serialize a session record into a portable, versioned artifact. With no `redact`, this is the full-fidelity
 * round-trip form; with `redact`, the caller's transform is applied first (the share path).
 */
export function serializeSessionArtifact(
  record: IInteractiveSessionRecord,
  options: ISerializeSessionArtifactOptions = {},
): string {
  const payload = options.redact ? options.redact(record) : record;
  const artifact: IVersionedInteractiveSessionRecord = {
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
    record: payload,
  };
  return JSON.stringify(artifact, null, 2);
}

/**
 * Parse a session artifact back into an `IInteractiveSessionRecord`, rejecting an artifact whose schema version this build
 * does not understand (so an incompatible artifact is never silently mis-imported).
 */
export function deserializeSessionArtifact(bytes: string): IInteractiveSessionRecord {
  const outcome = decodeVersionedInteractiveSessionRecord(parseArtifactBytes(bytes));
  if (outcome.status === 'unsupported') {
    throw new Error(
      `Unsupported session artifact schema version ${outcome.schemaVersion ?? '(absent or not a number)'} ` +
        `(this build reads ${SESSION_ARTIFACT_SCHEMA_VERSION}).`,
    );
  }
  if (outcome.status === 'corrupt') {
    // The paths are the point: an artifact that cannot be imported should tell its holder WHERE it
    // is wrong, not that it is wrong. Bounded, because a wholly unrelated payload produces an issue
    // per member and a thousand-line error informs nobody.
    const shown = outcome.issues.slice(0, MAX_REPORTED_ISSUES);
    const detail = shown
      .map((issue) => `${issue.path === '' ? '(root)' : issue.path}: ${issue.message}`)
      .join('; ');
    const elided =
      outcome.issues.length > shown.length
        ? ` (+${outcome.issues.length - shown.length} more)`
        : '';
    throw new Error(`Invalid session artifact: ${detail}${elided}`);
  }
  return outcome.record;
}
