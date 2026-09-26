/**
 * Which public infrastructure the device mesh uses beyond the local network, from the
 * `transports.mesh.options` settings bag:
 *
 * - `dht` (default `true`): talk to the Mainline DHT directly for rendezvous records;
 * - `pkarrRelays`: pkarr relays (`https://…`), used for records when the DHT is off or cannot start;
 * - `nostrRelays`: Nostr relays (`wss://…`) for live signaling; `[]` turns Nostr signaling off.
 *
 * Absent lists take the defaults: well-known relays of several operators, replaceable here. A
 * malformed value fails closed with an error naming the setting, never a silent partial list.
 */
import { DEFAULT_NOSTR_RELAYS, DEFAULT_PKARR_RELAYS } from '@robota-sdk/agent-transport-webrtc';

export interface IMeshInternetSettings {
  readonly dht: boolean;
  readonly pkarrRelays: readonly string[];
  readonly nostrRelays: readonly string[];
}

const MAX_RELAYS = 16;

function relayList(
  value: unknown,
  setting: string,
  scheme: 'https:' | 'wss:',
  fallback: readonly string[],
): readonly string[] {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value) || value.length > MAX_RELAYS) {
    throw new Error(
      `Invalid mesh setting: \`${setting}\` must be a list of at most ${MAX_RELAYS} URLs.`,
    );
  }
  return value.map((entry, index) => {
    let url: URL;
    try {
      url = new URL(String(entry));
    } catch {
      throw new Error(`Invalid mesh setting: \`${setting}[${index}]\` is not a URL.`);
    }
    if (typeof entry !== 'string' || url.protocol !== scheme || url.username || url.password) {
      throw new Error(
        `Invalid mesh setting: \`${setting}[${index}]\` must be a ${scheme}// URL without credentials.`,
      );
    }
    return entry;
  });
}

/** The mesh's public-infrastructure settings from `transports.mesh.options`; throws on a malformed value. */
export function parseMeshInternetSettings(options: unknown): IMeshInternetSettings {
  if (options !== undefined && (typeof options !== 'object' || options === null)) {
    throw new Error('Invalid mesh setting: `transports.mesh.options` must be an object.');
  }
  const bag = (options ?? {}) as Record<string, unknown>;
  const dht = bag['dht'];
  if (dht !== undefined && typeof dht !== 'boolean') {
    throw new Error('Invalid mesh setting: `dht` must be true or false.');
  }
  return {
    dht: dht ?? true,
    pkarrRelays: relayList(bag['pkarrRelays'], 'pkarrRelays', 'https:', DEFAULT_PKARR_RELAYS),
    nostrRelays: relayList(bag['nostrRelays'], 'nostrRelays', 'wss:', DEFAULT_NOSTR_RELAYS),
  };
}
