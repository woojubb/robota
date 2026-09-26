/**
 * Which public infrastructure the device mesh uses beyond the local network, from the
 * `transports.mesh.options` settings bag:
 *
 * - `dht` (default `true`): talk to the Mainline DHT directly for rendezvous records;
 * - `pkarrRelays`: pkarr relays (`https://…`), used for records when the DHT is off or cannot start;
 * - `nostrRelays`: Nostr relays (`wss://…`) for live signaling; `[]` turns Nostr signaling off;
 * - `relay`: the TURN relay this device runs for its paired devices (`serve`, default off; `port`,
 *   default 3478; `host`, the IPv4 address it binds; `publicAddress`, where peers reach it;
 *   `relayPorts`, `{ min, max }` for its relayed addresses — behind a NAT, forward those and `port`;
 *   `allowPrivatePeers`, default `true`, whether it relays into private and link-local ranges);
 * - `turnServers`: TURN servers of the user's own, tried after the paired devices' relays;
 * - `relayOnly` (default `false`): use relayed connections only, for a network no direct path crosses.
 *
 * Absent lists take the defaults: well-known relays of several operators, replaceable here. A
 * malformed value fails closed with an error naming the setting, never a silent partial list.
 */
import { isIPv4 } from 'node:net';

import {
  DEFAULT_NOSTR_RELAYS,
  DEFAULT_PKARR_RELAYS,
  type IIceServer,
} from '@robota-sdk/agent-transport-webrtc';

import { parseIceServers } from '../remote-control/ice-config.js';

/** The relay this device runs for its paired devices. */
export interface IMeshRelaySettings {
  readonly serve: boolean;
  readonly port: number;
  /** The address the relay binds; absent: every interface. */
  readonly host?: string;
  /** The address peers reach the relay at, when it is not one of this device's own. */
  readonly publicAddress?: string;
  /** The ports relayed addresses take; absent: any free port. */
  readonly relayPorts?: { readonly min: number; readonly max: number };
  /**
   * Whether the relay forwards into private and link-local ranges, the relay host's own network.
   * On by default: a relayed connection to a device on that network needs it.
   */
  readonly allowPrivatePeers: boolean;
}

export interface IMeshInternetSettings {
  readonly dht: boolean;
  readonly pkarrRelays: readonly string[];
  readonly nostrRelays: readonly string[];
  readonly relay: IMeshRelaySettings;
  readonly turnServers: readonly IIceServer[];
  readonly relayOnly: boolean;
}

const DEFAULT_RELAY_PORT = 3478;

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

/** The relay serves IPv4 only, so its addresses are IPv4 addresses. */
function ipv4Address(value: unknown, setting: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isIPv4(value)) {
    throw new Error(`Invalid mesh setting: \`${setting}\` must be an IPv4 address.`);
  }
  return value;
}

function isPort(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= 65_535;
}

function relayPorts(value: unknown): { readonly min: number; readonly max: number } | undefined {
  if (value === undefined) return undefined;
  const range = value as { min?: unknown; max?: unknown } | null;
  if (
    typeof range !== 'object' ||
    range === null ||
    !isPort(range.min, 1024) ||
    !isPort(range.max, 1024) ||
    range.min > range.max
  ) {
    throw new Error(
      'Invalid mesh setting: `relay.relayPorts` must be `{ min, max }` ports from 1024, min <= max.',
    );
  }
  return { min: range.min, max: range.max };
}

function relaySettings(value: unknown): IMeshRelaySettings {
  if (value === undefined || value === null) {
    return { serve: false, port: DEFAULT_RELAY_PORT, allowPrivatePeers: true };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid mesh setting: `relay` must be an object.');
  }
  const bag = value as Record<string, unknown>;
  const serve = bag['serve'];
  if (serve !== undefined && typeof serve !== 'boolean') {
    throw new Error('Invalid mesh setting: `relay.serve` must be true or false.');
  }
  const port = bag['port'];
  if (port !== undefined && !isPort(port)) {
    throw new Error('Invalid mesh setting: `relay.port` must be a port number.');
  }
  const host = ipv4Address(bag['host'], 'relay.host');
  const publicAddress = ipv4Address(bag['publicAddress'], 'relay.publicAddress');
  const ports = relayPorts(bag['relayPorts']);
  const allowPrivatePeers = bag['allowPrivatePeers'];
  if (allowPrivatePeers !== undefined && typeof allowPrivatePeers !== 'boolean') {
    throw new Error('Invalid mesh setting: `relay.allowPrivatePeers` must be true or false.');
  }
  return {
    serve: serve ?? false,
    port: port ?? DEFAULT_RELAY_PORT,
    allowPrivatePeers: allowPrivatePeers ?? true,
    ...(host !== undefined ? { host } : {}),
    ...(publicAddress !== undefined ? { publicAddress } : {}),
    ...(ports !== undefined ? { relayPorts: ports } : {}),
  };
}

/** TURN servers only, each with its credential: a server that relays nothing is no fallback. */
function turnServers(value: unknown): readonly IIceServer[] {
  let servers: IIceServer[] | undefined;
  try {
    servers = parseIceServers(value);
  } catch (error) {
    throw new Error(
      `Invalid mesh setting: \`turnServers\` — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const [index, server] of (servers ?? []).entries()) {
    if (!/^turn:/i.test(server.urls)) {
      throw new Error(`Invalid mesh setting: \`turnServers[${index}]\` must be a turn: URL.`);
    }
    if (server.username === undefined || server.credential === undefined) {
      throw new Error(
        `Invalid mesh setting: \`turnServers[${index}]\` needs a username and credential.`,
      );
    }
  }
  return servers ?? [];
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
  const relayOnly = bag['relayOnly'];
  if (relayOnly !== undefined && typeof relayOnly !== 'boolean') {
    throw new Error('Invalid mesh setting: `relayOnly` must be true or false.');
  }
  const settings: IMeshInternetSettings = {
    dht: dht ?? true,
    pkarrRelays: relayList(bag['pkarrRelays'], 'pkarrRelays', 'https:', DEFAULT_PKARR_RELAYS),
    nostrRelays: relayList(bag['nostrRelays'], 'nostrRelays', 'wss:', DEFAULT_NOSTR_RELAYS),
    relay: relaySettings(bag['relay']),
    turnServers: turnServers(bag['turnServers']),
    relayOnly: relayOnly ?? false,
  };
  // A relay's address reaches paired devices only in the sealed records on the DHT or pkarr relays:
  // with both off, no device can learn of one, so a setting that relies on it would never work.
  const records = settings.dht || settings.pkarrRelays.length > 0;
  if (!records && settings.relay.serve) {
    throw new Error(
      'Invalid mesh setting: `relay.serve` needs `dht` or `pkarrRelays`, which tell your other ' +
        'devices where the relay is.',
    );
  }
  if (!records && settings.relayOnly && settings.turnServers.length === 0) {
    throw new Error(
      'Invalid mesh setting: `relayOnly` needs `turnServers`, or `dht` or `pkarrRelays` to find ' +
        "your devices' relays.",
    );
  }
  return settings;
}
