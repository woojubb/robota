/**
 * Default public infrastructure for finding and signaling a peer device beyond the local network.
 *
 * These are well-known relays run by different operators, chosen so that no single operator sees
 * every record or every signal. None of them is trusted: they carry signed ciphertext under
 * one-time keys, and a peer is admitted by the device handshake alone. They are defaults only —
 * settings replace them, and a self-hosted relay remains an option.
 */

/** Nostr relays for live signaling, one per operator. */
export const DEFAULT_NOSTR_RELAYS: readonly string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

/**
 * pkarr relays, for a client that cannot reach the Mainline DHT directly (a browser, or a network
 * that blocks UDP). Two operators.
 */
export const DEFAULT_PKARR_RELAYS: readonly string[] = [
  'https://pkarr.pubky.app',
  'https://pkarr.pubky.org',
  'https://dns.iroh.link/pkarr',
];
