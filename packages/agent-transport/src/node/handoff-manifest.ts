/**
 * HANDOFF-001 (#1811): what actually gets built and sent, and how the destination knows it arrived
 * whole.
 *
 * Session mobility decides whether a source can offer a session and what its inventory says.
 * This Node-only module seals and verifies the exact payload bytes.
 *
 * ## Integrity is checked in a specific order
 *
 * Length first, then digest. A truncated transfer is the common failure and the cheap one to
 * detect; hashing a short buffer to discover it was short wastes the work and, worse, reports it as
 * a digest mismatch — which reads as corruption or tampering rather than a dropped connection.
 */

import { createHash } from 'node:crypto';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import type { IHandoffIntegrity } from '@robota-sdk/agent-interface-session-mobility';

/**
 * Serialize a record and describe what was serialized.
 *
 * The string is returned alongside the integrity data because the digest is only meaningful for
 * these exact bytes. A caller that re-serialized the record before sending could produce a
 * different key order and a digest mismatch on a payload that is perfectly correct — a corruption
 * report caused by the corruption check.
 */
export function sealHandoffRecord(record: IInteractiveSessionRecord): {
  serialized: string;
  integrity: IHandoffIntegrity;
} {
  const serialized = JSON.stringify(record);
  const bytes = Buffer.from(serialized, 'utf8');
  return {
    serialized,
    integrity: {
      digest: createHash('sha256').update(bytes).digest('base64url'),
      byteLength: bytes.byteLength,
    },
  };
}

/** Why a received payload was not accepted. */
export type TIntegrityFailure = 'truncated' | 'digest-mismatch';

export interface IIntegrityVerdict {
  readonly intact: boolean;
  readonly failure?: TIntegrityFailure;
  /** What the manifest promised and what arrived, so a report can say more than "it failed". */
  readonly expectedBytes?: number;
  readonly actualBytes?: number;
}

/**
 * Check a received payload against the manifest's integrity metadata.
 *
 * Nothing is parsed here. Parsing a payload to check it is well-formed would mean building the
 * object graph before knowing whether the bytes are the ones that were sent, and a destination that
 * has already parsed a corrupt payload has already spent the effort this check exists to avoid.
 */
export function verifyHandoffPayload(
  serialized: string,
  integrity: IHandoffIntegrity,
): IIntegrityVerdict {
  const bytes = Buffer.from(serialized, 'utf8');
  if (bytes.byteLength !== integrity.byteLength) {
    return {
      intact: false,
      failure: 'truncated',
      expectedBytes: integrity.byteLength,
      actualBytes: bytes.byteLength,
    };
  }
  const digest = createHash('sha256').update(bytes).digest('base64url');
  if (digest !== integrity.digest) return { intact: false, failure: 'digest-mismatch' };
  return { intact: true };
}
