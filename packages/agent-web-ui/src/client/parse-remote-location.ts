import { parsePairingUrl } from '@robota-sdk/agent-remote-pairing';

/**
 * Parse the Stage-D page's own URL into its connection inputs (REMOTE-009).
 *
 * The pairing link is `clientUrl#r=<rendezvous>&s=<secret>` — the SECRET lives only in the **fragment**
 * (never sent to the page's host). The relay URL is NOT secret and is NOT in the fragment; the host operator
 * configures it into `clientUrl` as a `relay` query param (e.g. `https://page/?relay=wss://myrelay`), which
 * `toPairingUrl` preserves. So: relay ← `location.search`, rendezvous + secret ← `location.hash`.
 *
 * Pure + isomorphic (works on any href string) so it is unit-testable without a browser.
 */
export interface IRemoteClientLocation {
  readonly relayUrl: string;
  readonly rendezvous: string;
  readonly secret: string;
}

/** Parse `href`; throws a clear error when the relay query param or the pairing fragment is missing. */
export function parseRemoteClientLocation(href: string): IRemoteClientLocation {
  const relayUrl = new URL(href).searchParams.get('relay');
  if (!relayUrl) {
    throw new Error(
      'Missing `relay` query parameter — the pairing link must include the signaling relay URL.',
    );
  }
  const { rendezvous, secret } = parsePairingUrl(href); // throws if the fragment lacks r/s
  return { relayUrl, rendezvous, secret };
}
