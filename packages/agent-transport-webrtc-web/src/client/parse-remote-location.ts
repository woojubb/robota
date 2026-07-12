import { parsePairingUrl } from '@robota-sdk/agent-remote-pairing';

import { iceHasTurn, parseIceServersParam } from './parse-ice-servers.js';

/**
 * Parse the Stage-D page's own URL into its connection inputs (REMOTE-009 + REMOTE-010).
 *
 * The pairing link is `clientUrl?relay=…&ice=…&forceTurn=1#r=<rendezvous>&s=<secret>`. The SECRET lives ONLY in
 * the **fragment** (never sent to the page's host). The relay URL, the optional TURN/ICE config (`ice`, a
 * base64url JSON `RTCIceServer[]`), and the `forceTurn` flag are NOT secret and ride the QUERY — the operator
 * bakes them into `clientUrl` and `toPairingUrl` preserves the query. (Query values reach the page's HTTP host +
 * QR/history — unlike the fragment-protected secret — acceptable for user-supplied TURN shared with a trusted
 * device.) So: relay/ice/forceTurn ← `location.search`, rendezvous + secret ← `location.hash`.
 *
 * Pure + isomorphic (works on any href string) so it is unit-testable without a browser.
 */
export interface IRemoteClientLocation {
  readonly relayUrl: string;
  readonly rendezvous: string;
  readonly secret: string;
  /** REMOTE-010: validated user-supplied ICE (STUN/TURN) servers, when the `ice` query param is present. */
  readonly iceServers?: RTCIceServer[];
  /** REMOTE-010: restrict ICE to relay candidates (`iceTransportPolicy: 'relay'`); requires a TURN server. */
  readonly forceTurn?: boolean;
}

/** Parse `href`; throws a clear error when the relay query param or the pairing fragment is missing, or the
 *  `ice`/`forceTurn` config is malformed (fail-closed — attacker-influenced input). */
export function parseRemoteClientLocation(href: string): IRemoteClientLocation {
  const query = new URL(href).searchParams;
  const relayUrl = query.get('relay');
  if (!relayUrl) {
    throw new Error(
      'Missing `relay` query parameter — the pairing link must include the signaling relay URL.',
    );
  }
  const { rendezvous, secret } = parsePairingUrl(href); // throws if the fragment lacks r/s

  const iceParam = query.get('ice');
  const iceServers = iceParam ? parseIceServersParam(iceParam) : undefined; // throws (fail-closed) on malformed
  const forceTurn = query.get('forceTurn') === '1' || query.get('forceTurn') === 'true';
  if (forceTurn && !iceHasTurn(iceServers)) {
    throw new Error(
      '`forceTurn` requires at least one TURN server in the `ice` param (a turn:/turns: url) — ' +
        'otherwise ICE gathers no candidates and never connects.',
    );
  }

  return {
    relayUrl,
    rendezvous,
    secret,
    ...(iceServers ? { iceServers } : {}),
    ...(forceTurn ? { forceTurn } : {}),
  };
}
