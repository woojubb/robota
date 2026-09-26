/**
 * The consent at the DESTINATION: before a session is taken onto this machine, its operator is asked.
 *
 * The source's operator is asked whether to give the session away (`/handoff`). This is the other
 * question: whether to take on another session's work here, with this machine's provider credential,
 * files and shell. A grant proves the same user authorised the transfer; it does not establish that
 * the person is here now, or that they meant this machine.
 *
 * It is the connection's `handoff` authority that asks, for every transfer, through the operator
 * approver — the terminal of this machine, which no connected surface can answer for. Without an
 * operator to ask, the answer is no.
 */

import type {
  ConnectionAuthority,
  IHandoffManifest,
  IPeerAdmission,
} from '@robota-sdk/agent-interface-session-mobility';

/** What the question names: the session and what taking it means here. Untrusted fields are the manifest's. */
function summary(manifest: IHandoffManifest, deviceLabel: string): string {
  return (
    `session ${manifest.sessionId} (${manifest.integrity.byteLength} bytes) onto ${deviceLabel}. ` +
    "It is saved here, not started; resumed, it runs with this machine's provider credential, " +
    'files and shell, and the other machine gives it up once this one has saved it.'
  );
}

/**
 * The consent the channel gate calls after a grant verifies. Takes the verified admission so it is
 * never asked before the proof.
 */
export function createHandoffConsent(options: {
  readonly authority: ConnectionAuthority;
  /** This machine's name, so the question says where the session would land. */
  readonly deviceLabel: string;
  /** Aborted when the connection goes away: the question is withdrawn and the answer is no. */
  readonly signal?: AbortSignal;
}): (admission: IPeerAdmission, manifest: IHandoffManifest) => Promise<boolean> {
  return async (admission, manifest) => {
    if (!admission.admitted) return false;
    const decision = await options.authority.authorize('handoff', {
      summary: summary(manifest, options.deviceLabel),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    });
    return decision.allowed;
  };
}
