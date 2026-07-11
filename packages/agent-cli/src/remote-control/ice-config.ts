import type { IIceServer } from '@robota-sdk/agent-transport-webrtc';

/**
 * Validating reader for the HOST WebRTC ICE config (REMOTE-010 E1). `transports.webrtc.options.iceServers` is an
 * UNTYPED bag value (`unknown`), so it must be narrowed with real validation — no `any`, no unchecked cast — and a
 * malformed value must **fail closed** (a clear error), never a silent partial config.
 *
 * CRUCIALLY, this is constrained to what the HOST sink (werift) actually consumes: werift's ICE gatherer
 * (`parseIceServers`) reads only a SINGLE-string `urls` with a `turn:`/`stun:` scheme and **silently drops** array
 * `urls`, `turns:`/`stuns:` schemes, etc. So we REJECT (fail-closed) the shapes werift would drop — accepting them
 * would advertise TURN as configured while werift discards it (a silent never-connect). (The browser peer uses the
 * native `RTCPeerConnection`, which DOES support array urls / `turns:` — its decoder is deliberately wider.)
 */

const ICE_URL_SCHEME = /^(stun|turn):/i;

function validateUrl(url: unknown, where: string): string {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(`Invalid ICE config: ${where} must be a non-empty url string.`);
  }
  if (!ICE_URL_SCHEME.test(url)) {
    throw new Error(
      `Invalid ICE config: ${where} "${url}" must use a stun:/turn: scheme — the host (werift) transport does ` +
        'not support turns:/stuns: (silently dropped). Use turn:/stun:.',
    );
  }
  return url;
}

function validateServer(entry: unknown, index: number): IIceServer {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`Invalid ICE config: iceServers[${index}] must be an object.`);
  }
  const record = entry as Record<string, unknown>;
  const rawUrls = record.urls;
  if (Array.isArray(rawUrls)) {
    throw new Error(
      `Invalid ICE config: iceServers[${index}].urls must be a single url string — the host (werift) transport ` +
        'silently drops array urls. List each server as a separate { urls } entry.',
    );
  }
  const urls = validateUrl(rawUrls, `iceServers[${index}].urls`);
  const server: { urls: string; username?: string; credential?: string } = { urls };
  if (record.username !== undefined) {
    if (typeof record.username !== 'string') {
      throw new Error(`Invalid ICE config: iceServers[${index}].username must be a string.`);
    }
    server.username = record.username;
  }
  if (record.credential !== undefined) {
    if (typeof record.credential !== 'string') {
      throw new Error(`Invalid ICE config: iceServers[${index}].credential must be a string.`);
    }
    server.credential = record.credential;
  }
  return server;
}

/**
 * Narrow an untyped `iceServers` value → a validated `IIceServer[]`. Returns undefined when absent/empty;
 * THROWS on a malformed value (fail-closed — never a silent partial config).
 */
export function parseIceServers(value: unknown): IIceServer[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(
      'Invalid ICE config: `iceServers` must be an array of { urls, username?, credential? }.',
    );
  }
  if (value.length === 0) return undefined;
  return value.map((entry, index) => validateServer(entry, index));
}

/** True when any configured ICE server is a TURN (`turn:`) server (host validator rejects `turns:`). */
export function hasTurnServer(iceServers: readonly IIceServer[] | undefined): boolean {
  if (!iceServers) return false;
  return iceServers.some((s) => /^turn:/i.test(s.urls));
}
