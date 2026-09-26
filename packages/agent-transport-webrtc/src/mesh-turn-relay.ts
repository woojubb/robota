/**
 * The device mesh's relay of last resort: a TURN server on one of the user's always-on devices, used
 * only by the devices of the same roster, with short-lived credentials each pair derives on its own.
 *
 * A credential follows the TURN REST scheme — the username carries its expiry, the password is a MAC
 * of the username — but the MAC key is the pair's secret rather than one shared by every client: the
 * username is `<expiry>:<tag>`, where the tag is the pair's rotating relay-user tag, so it names no
 * device to whoever sees it, and only the relay device can tell whose it is. A device the lists no
 * longer name, or revoke, derives no tag and no password, and its allocations close.
 *
 * The relay moves datagrams between two ends that run DTLS with each other; it never holds a key of
 * that channel, and a connection through it is admitted by the device handshake exactly as a direct
 * one is.
 */
import { rendezvousEpoch, type IPairRendezvous } from '@robota-sdk/agent-remote-pairing';

import { TurnServer, type ITurnQuotas } from './turn-server.js';

import type { IIceServer } from './webrtc-transport-options.js';

/** Where a paired device's relay listens. */
export interface IMeshRelayEndpoint {
  readonly host: string;
  readonly port: number;
}

/** A device the relay serves, with the pair's rendezvous. */
export interface IMeshRelayPeer {
  readonly deviceId: string;
  readonly rendezvous: IPairRendezvous;
}

/** How long a relay credential is good for, by default. */
export const DEFAULT_RELAY_CREDENTIAL_TTL_MS = 10 * 60 * 1000;
/** The longest a relay accepts: a credential cannot outlive the tag epochs its relay looks up. */
export const MAX_RELAY_CREDENTIAL_TTL_MS = 60 * 60 * 1000;
/** Clocks of two devices may disagree by this much. */
const CLOCK_SKEW_MS = 60 * 1000;
const TAG_BYTES = 16;
const USERNAME = /^(\d{1,12}):([A-Za-z0-9_-]{22})$/;

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/** A relay credential this device presents to `rendezvous`'s peer's relay, good until `now + ttlMs`. */
export async function meshRelayCredential(
  rendezvous: IPairRendezvous,
  now: number,
  ttlMs: number = DEFAULT_RELAY_CREDENTIAL_TTL_MS,
): Promise<{ readonly username: string; readonly credential: string }> {
  const ttl = Math.min(Math.max(ttlMs, 1000), MAX_RELAY_CREDENTIAL_TTL_MS);
  const tag = (await rendezvous.tag('relay-user', 'outbound', rendezvousEpoch(now))).slice(
    0,
    TAG_BYTES,
  );
  const username = `${Math.floor((now + ttl) / 1000)}:${base64Url(tag)}`;
  return { username, credential: await rendezvous.relayPassword('outbound', username) };
}

function turnUrl(endpoint: IMeshRelayEndpoint): string {
  const host = endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host;
  return `turn:${host}:${endpoint.port}?transport=udp`;
}

/** ICE servers for a paired device's relay endpoints, with this pair's credential. */
export async function meshRelayIceServers(
  rendezvous: IPairRendezvous,
  endpoints: readonly IMeshRelayEndpoint[],
  now: number,
  ttlMs?: number,
): Promise<IIceServer[]> {
  if (endpoints.length === 0) return [];
  const { username, credential } = await meshRelayCredential(rendezvous, now, ttlMs);
  return endpoints.map((endpoint) => ({ urls: turnUrl(endpoint), username, credential }));
}

/**
 * No path reached a peer device and no relay could be tried: this network needs one. Never a silent
 * degrade — the connection is refused with this error instead.
 */
export class MeshRelayNeededError extends Error {
  public readonly deviceId: string;

  public constructor(deviceId: string, options?: { readonly cause?: unknown }) {
    super(
      `a relay device is needed to reach device ${deviceId}: no direct path worked, no paired device ` +
        'advertises a relay, and no TURN server is configured. Run the relay on an always-on device, ' +
        'or configure a TURN server.',
      options?.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = 'MeshRelayNeededError';
    this.deviceId = deviceId;
  }
}

export interface IMeshTurnRelayOptions {
  /** Default every IPv4 interface. */
  readonly host?: string;
  /** Default 3478; 0 picks a free port. */
  readonly port?: number;
  /** The address relayed transport addresses carry, e.g. this device's public address. */
  readonly relayAddress?: string;
  readonly quotas?: Partial<ITurnQuotas>;
  /** Default: see {@link TurnServer}. */
  readonly allowPeer?: (address: string) => boolean;
  readonly now?: () => number;
  readonly onError?: (error: Error) => void;
}

/** This device's relay for its paired devices. */
export class MeshTurnRelay {
  private peers: readonly IMeshRelayPeer[] = [];

  private constructor(
    private readonly server: TurnServer,
    private readonly now: () => number,
  ) {}

  public static async start(options: IMeshTurnRelayOptions = {}): Promise<MeshTurnRelay> {
    const now = options.now ?? Date.now;
    let relay: MeshTurnRelay | undefined;
    const server = await TurnServer.start({
      ...(options.host !== undefined ? { host: options.host } : {}),
      ...(options.port !== undefined ? { port: options.port } : {}),
      ...(options.relayAddress !== undefined ? { relayAddress: options.relayAddress } : {}),
      ...(options.quotas !== undefined ? { quotas: options.quotas } : {}),
      ...(options.allowPeer !== undefined ? { allowPeer: options.allowPeer } : {}),
      ...(options.onError !== undefined ? { onError: options.onError } : {}),
      now,
      authorize: (username) => relay?.authorize(username) ?? Promise.resolve(undefined),
    });
    relay = new MeshTurnRelay(server, now);
    return relay;
  }

  /** Where the relay listens. */
  public get endpoint(): IMeshRelayEndpoint {
    const { address, port } = this.server.address;
    return { host: address, port };
  }

  /** Allocations held, by one device or in all. */
  public allocationCount(deviceId?: string): number {
    return this.server.allocationCount(deviceId);
  }

  /**
   * The devices the relay serves: the current, unrevoked peers of the lists in force. Any other
   * device's credentials stop working, and its allocations close at once.
   */
  public declarePeers(peers: readonly IMeshRelayPeer[]): void {
    this.peers = [...peers];
    this.server.retain(new Set(peers.map((peer) => peer.deviceId)));
  }

  private async authorize(
    username: string,
  ): Promise<{ readonly owner: string; readonly password: string } | undefined> {
    const match = USERNAME.exec(username);
    if (match === null) return undefined;
    const now = this.now();
    const expiresAt = Number(match[1]) * 1000;
    if (expiresAt <= now || expiresAt - now > MAX_RELAY_CREDENTIAL_TTL_MS + CLOCK_SKEW_MS) {
      return undefined;
    }
    const tag = Buffer.from(match[2]!, 'base64url');
    const epoch = rendezvousEpoch(now);
    const peers = this.peers;
    for (const peer of peers) {
      const tags = await peer.rendezvous.lookupTags('relay-user', epoch);
      if (!tags.some((candidate) => tag.equals(Buffer.from(candidate.slice(0, TAG_BYTES))))) {
        continue;
      }
      // Still a peer once the tags are derived: a revocation meanwhile wins.
      if (!this.peers.some((current) => current.deviceId === peer.deviceId)) return undefined;
      return {
        owner: peer.deviceId,
        password: await peer.rendezvous.relayPassword('inbound', username),
      };
    }
    return undefined;
  }

  public close(): Promise<void> {
    this.peers = [];
    return this.server.close();
  }
}
