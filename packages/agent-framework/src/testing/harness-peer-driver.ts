/**
 * PEER-002 (#1809): how the harness addresses a turn as coming from another session.
 *
 * A separate file because the reasoning is longer than the code, and because the harness is at its
 * size ratchet where the rule is to split rather than extend.
 */

import type { ISubmitOptions } from '@robota-sdk/agent-interface-session';

/**
 * Submission options for a message that arrived from a peer session.
 *
 * The driver id is DERIVED from the peer's session id rather than passed through from the peer's
 * own `IPeerOrigin.driverId`. That field is optional and peer-supplied, and a name the transcript's
 * reader trusts must not be chosen by the party being named — a peer that could pick its own
 * display name could pick the operator's.
 *
 * Admission is not decided here. Whether this peer may speak to this session at all is settled
 * before anything reaches a submission, by whoever holds the admission port; a test harness that
 * also gated admission would be able to pass a test the product would fail.
 */
export function peerTurnOptions(peerSessionId: string): ISubmitOptions {
  return { turnSource: 'peer', driverId: `peer:${peerSessionId}` };
}
