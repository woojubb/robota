/**
 * Where a peer device might be reached for signaling, and where that answer comes from.
 *
 * A candidate is only an address to try. Whatever answers there is untrusted like any relay: it
 * carries signals, and the peer is still admitted by the device handshake or not at all. So a
 * candidate may be stale, forged or someone else's without granting anything.
 */
import type { IPairRendezvous } from '@robota-sdk/agent-remote-pairing';

/** A direct signaling endpoint a peer might be listening on. */
export interface IMeshCandidate {
  readonly host: string;
  readonly port: number;
}

/** A peer device a node signals, with the pair's rendezvous and relay inbox topics. */
export interface IMeshPeerRoute {
  readonly deviceId: string;
  /** Where this device listens for the peer on a relay. */
  readonly inbound: string;
  /** Where this device sends to reach the peer on a relay. */
  readonly outbound: string;
  readonly rendezvous: IPairRendezvous;
}

/** One way of finding a peer's direct signaling endpoint. */
export interface IMeshCandidateSource {
  /** Candidates for `peer`, best first; empty when this source knows none. Never throws. */
  candidates(peer: IMeshPeerRoute, signal: AbortSignal): Promise<readonly IMeshCandidate[]>;
}

/** The last candidates that worked for each peer device, most recent first. */
export interface IMeshAddressCache {
  recall(deviceId: string): readonly IMeshCandidate[];
  remember(deviceId: string, candidate: IMeshCandidate): void;
  /** Forget every device but these: a device that left the lists has no address worth keeping. */
  retain(deviceIds: readonly string[]): void;
  /** The port this device listened on last, to listen on again so peers' caches stay useful. */
  lastListenPort(): number | undefined;
  rememberListenPort(port: number): void;
}

/** Candidates per device the cache keeps. */
export const MAX_CACHED_CANDIDATES = 3;

/** The cache, as the first candidate source. */
export function addressCacheSource(cache: IMeshAddressCache): IMeshCandidateSource {
  return { candidates: (peer) => Promise.resolve(cache.recall(peer.deviceId)) };
}

function sameCandidate(a: IMeshCandidate, b: IMeshCandidate): boolean {
  return a.host === b.host && a.port === b.port;
}

/** `candidate` first, then the others it does not repeat, bounded. */
function withCandidateFirst(
  candidates: readonly IMeshCandidate[],
  candidate: IMeshCandidate,
): IMeshCandidate[] {
  return [
    { host: candidate.host, port: candidate.port },
    ...candidates.filter((c) => !sameCandidate(c, candidate)),
  ].slice(0, MAX_CACHED_CANDIDATES);
}

/** An address cache that lives as long as the process — for tests and callers without a state dir. */
export function createInMemoryMeshAddressCache(): IMeshAddressCache {
  const byDevice = new Map<string, IMeshCandidate[]>();
  let listenPort: number | undefined;
  return {
    recall: (deviceId) => byDevice.get(deviceId) ?? [],
    remember: (deviceId, candidate) => {
      byDevice.set(deviceId, withCandidateFirst(byDevice.get(deviceId) ?? [], candidate));
    },
    retain: (deviceIds) => {
      const keep = new Set(deviceIds);
      for (const deviceId of [...byDevice.keys()])
        if (!keep.has(deviceId)) byDevice.delete(deviceId);
    },
    lastListenPort: () => listenPort,
    rememberListenPort: (port) => {
      listenPort = port;
    },
  };
}
