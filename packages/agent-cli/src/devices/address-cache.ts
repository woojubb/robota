/**
 * Where this device last reached each peer device directly, under `~/.robota/devices`, so the next
 * connection tries those addresses before looking on the network.
 *
 * It holds device ids, addresses, ports and times, and nothing secret: an address it gives is only
 * a candidate, and a peer found there is admitted by the device handshake or not at all. It is kept
 * owner-only because where a user's devices are is still their business. A file that cannot be read
 * is a cache miss, never an error.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ensureOwnerOnlyDirectory, writeOwnerOnlyFile } from '@robota-sdk/agent-core/node';
import {
  MAX_CACHED_CANDIDATES,
  type IMeshAddressCache,
  type IMeshCandidate,
} from '@robota-sdk/agent-transport-webrtc';

const CACHE_VERSION = 1;
const CACHE_FILE = 'address-cache.json';
/** An entry older than this is not worth trying. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A device id: base64url of a SHA-256 digest. Anything else (e.g. `__proto__`) is dropped. */
const DEVICE_ID = /^[A-Za-z0-9_-]{43}$/;
const MAX_HOST_CHARS = 253;

interface IEntry extends IMeshCandidate {
  readonly at: number;
}

export function addressCachePath(directory: string): string {
  return join(directory, CACHE_FILE);
}

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65_535;
}

function decodeEntry(value: unknown, now: number): IEntry | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const r = value as Record<string, unknown>;
  if (typeof r.host !== 'string' || r.host.length === 0 || r.host.length > MAX_HOST_CHARS) {
    return undefined;
  }
  // An entry from the future would never age out.
  if (!isPort(r.port) || typeof r.at !== 'number' || r.at > now || now - r.at > MAX_AGE_MS) {
    return undefined;
  }
  return { host: r.host, port: r.port, at: r.at };
}

function load(
  path: string,
  now: number,
): { peers: Map<string, IEntry[]>; listenPort: number | undefined } {
  const peers = new Map<string, IEntry[]>();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // allow-fallback: no cache, or one that cannot be read, is a miss; the network is looked at instead
    return { peers, listenPort: undefined };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { peers, listenPort: undefined };
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== CACHE_VERSION) return { peers, listenPort: undefined };
  const stored = r.peers;
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    for (const [deviceId, entries] of Object.entries(stored as Record<string, unknown>)) {
      if (!DEVICE_ID.test(deviceId) || !Array.isArray(entries)) continue;
      const kept = entries
        .map((entry) => decodeEntry(entry, now))
        .filter((entry): entry is IEntry => entry !== undefined)
        .slice(0, MAX_CACHED_CANDIDATES);
      if (kept.length > 0) peers.set(deviceId, kept);
    }
  }
  return { peers, listenPort: isPort(r.listenPort) ? r.listenPort : undefined };
}

export interface IFileMeshAddressCacheOptions {
  /** The `~/.robota` the directory lives under. */
  readonly withinRoot?: string;
  readonly now?: () => number;
}

/** The address cache in `directory`, read once and written on every change. */
export function createFileMeshAddressCache(
  directory: string,
  options: IFileMeshAddressCacheOptions = {},
): IMeshAddressCache {
  const now = options.now ?? Date.now;
  const path = addressCachePath(directory);
  const state = load(path, now());
  const save = (): void => {
    ensureOwnerOnlyDirectory(
      directory,
      options.withinRoot === undefined ? {} : { withinRoot: options.withinRoot },
    );
    writeOwnerOnlyFile(
      path,
      `${JSON.stringify({
        version: CACHE_VERSION,
        ...(state.listenPort !== undefined ? { listenPort: state.listenPort } : {}),
        peers: Object.fromEntries(state.peers),
      })}\n`,
    );
  };
  return {
    recall: (deviceId) =>
      (state.peers.get(deviceId) ?? []).map(({ host, port }) => ({ host, port })),
    remember: (deviceId, candidate) => {
      if (!DEVICE_ID.test(deviceId) || !isPort(candidate.port)) return;
      const held = state.peers.get(deviceId) ?? [];
      state.peers.set(
        deviceId,
        [
          { host: candidate.host, port: candidate.port, at: now() },
          ...held.filter((h) => h.host !== candidate.host || h.port !== candidate.port),
        ].slice(0, MAX_CACHED_CANDIDATES),
      );
      save();
    },
    retain: (deviceIds) => {
      const keep = new Set(deviceIds);
      let changed = false;
      for (const deviceId of [...state.peers.keys()]) {
        if (keep.has(deviceId)) continue;
        state.peers.delete(deviceId);
        changed = true;
      }
      if (changed) save();
    },
    lastListenPort: () => state.listenPort,
    rememberListenPort: (port) => {
      if (!isPort(port) || state.listenPort === port) return;
      state.listenPort = port;
      save();
    },
  };
}
