/**
 * SELFHOST-014 — the neutral export/import envelope for a session, over the storage-neutral `ISessionRecord`.
 *
 * This is a RECORD-TRANSPORT sibling of the file-backed `session-store.ts` (SRP: transport vs file persistence).
 * It is the async, durable COMPLEMENT to REMOTE-001's live P2P channel — export a thread to a portable artifact,
 * hand it off, import + resume it later on a second surface, with both peers possibly offline. No transport, no
 * pairing, no wire protocol.
 *
 * Two operations, specified separately and never conflated:
 *   1. Round-trip serialize (fidelity, local): `serializeSessionArtifact(record)` with no transform is
 *      full-fidelity — `deserializeSessionArtifact(serializeSessionArtifact(record))` deep-equals the record.
 *   2. Export-for-share: `serializeSessionArtifact(record, { redact })` applies a caller-supplied, policy-free
 *      `redact` transform BEFORE writing bytes. The envelope selects NO fields and owns NO field policy — the app
 *      builds `redact` (composing the opt-in `scrubSensitiveKeys`). The no-transform form stays full-fidelity.
 *
 * Neutrality (mechanically fenced — TC-05): this module is pure serialize/deserialize + a schema-version header +
 * the app-supplied `redact` seam. It carries NO link/cloud/upload/access-control and NO redaction FIELD policy.
 */

import type { ISessionRecord } from './session-store.js';

/** Bump when the envelope shape changes incompatibly; `deserialize` rejects a version it does not understand. */
export const SESSION_ARTIFACT_SCHEMA_VERSION = 1;

/** The on-the-wire envelope: a schema-version header + the storage-neutral session record. */
export interface ISessionArtifact {
  schemaVersion: number;
  record: ISessionRecord;
}

export interface ISerializeSessionArtifactOptions {
  /**
   * SHARE-PATH ONLY. An app-supplied, policy-free transform applied to the record before serialization — the app
   * decides which trust-boundary fields to strip (composing the opt-in `scrubSensitiveKeys`). Omit for the
   * full-fidelity local round-trip.
   */
  redact?: (record: ISessionRecord) => ISessionRecord;
}

/**
 * Serialize a session record into a portable, versioned artifact. With no `redact`, this is the full-fidelity
 * round-trip form; with `redact`, the caller's transform is applied first (the share path).
 */
export function serializeSessionArtifact(
  record: ISessionRecord,
  options: ISerializeSessionArtifactOptions = {},
): string {
  const payload = options.redact ? options.redact(record) : record;
  const artifact: ISessionArtifact = {
    schemaVersion: SESSION_ARTIFACT_SCHEMA_VERSION,
    record: payload,
  };
  return JSON.stringify(artifact, null, 2);
}

/**
 * Parse a session artifact back into an `ISessionRecord`, rejecting an artifact whose schema version this build
 * does not understand (so an incompatible artifact is never silently mis-imported).
 */
export function deserializeSessionArtifact(bytes: string): ISessionRecord {
  const artifact = JSON.parse(bytes) as ISessionArtifact;
  if (!artifact || typeof artifact.schemaVersion !== 'number') {
    throw new Error('Invalid session artifact: missing schema version header.');
  }
  if (artifact.schemaVersion !== SESSION_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported session artifact schema version ${artifact.schemaVersion} (this build reads ${SESSION_ARTIFACT_SCHEMA_VERSION}).`,
    );
  }
  if (!artifact.record || typeof artifact.record !== 'object') {
    throw new Error('Invalid session artifact: missing session record.');
  }
  return artifact.record;
}
