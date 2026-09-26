/**
 * What every issuer of this device's lists shares: how the next sequence number is chosen, and the
 * check a new identity state passes before it is saved.
 */
import { verifyDeviceChain, type IListHighWaterMarks } from '@robota-sdk/agent-remote-pairing';

import { DeviceIdentityError } from './device-identity-error.js';

import type { IDeviceIdentityState } from './identity-state.js';

/**
 * The next `seq` for a list. Wall-clock based, never below the last one plus one: two issuers that
 * share no state (a recovery on another device) still number forward, and a clock that steps back
 * cannot make a list look older than its predecessor.
 */
export function nextSeq(previous: number | undefined, now: number): number {
  return Math.max((previous ?? 0) + 1, now);
}

/** Verify the state for this device before it is saved, and fold the accepted `seq`s into its marks. */
export async function checked(
  state: IDeviceIdentityState,
  now: number,
): Promise<IDeviceIdentityState> {
  const verdict = await verifyDeviceChain({
    masterPublicKey: state.masterPublicKey,
    signingKeyCert: state.signingKeyCertificate,
    deviceCert: state.deviceCertificate,
    roster: state.roster,
    revocation: state.revocation,
    signingKeyRevocation: state.signingKeyRevocation,
    now,
    lastSeen: state.marks,
    required: { roster: true, revocation: true, signingKeyRevocation: true },
  });
  if (!verdict.ok) {
    throw new DeviceIdentityError(
      `the new identity state did not verify (${verdict.subject}: ${verdict.reason}); nothing was saved`,
    );
  }
  const marks: IListHighWaterMarks = {
    ...(verdict.accepted.signingKeyRevocationSeq !== undefined
      ? { signingKeyRevocationSeq: verdict.accepted.signingKeyRevocationSeq }
      : {}),
    bySigningKey: {
      ...state.marks.bySigningKey,
      [verdict.signingKeyId]: {
        ...(verdict.accepted.rosterSeq !== undefined
          ? { rosterSeq: verdict.accepted.rosterSeq }
          : {}),
        ...(verdict.accepted.revocationSeq !== undefined
          ? { revocationSeq: verdict.accepted.revocationSeq }
          : {}),
      },
    },
  };
  return { ...state, marks };
}
