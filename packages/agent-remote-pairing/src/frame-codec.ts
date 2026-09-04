/**
 * Owner-side total decoders for every PRE-AUTH frame (issue #2046 / SECURITY-002).
 *
 * The pairing, reconnect and enrollment frame vocabulary belongs to this package, so its decoding
 * does too. Before this, each carrier (the Node `PairingGate`, the browser `ResponderGate`) kept its
 * own predicate that checked only the `t` discriminator, which let an empty, malformed or unbounded
 * `nonce` / `mac` / `sig` / `deviceId` / `spki` reach crypto and controller code. A decoder here
 * checks presence, type, base64url encoding and an explicit length ceiling BEFORE any crypto work,
 * and both carriers import it.
 *
 * Wire contract — every string field is base64url (`[A-Za-z0-9_-]+`, no padding) and bounded by
 * {@link PRE_AUTH_FRAME_LIMITS}. The ceilings are generous relative to what this package emits
 * (a 16-byte nonce is 22 chars, an HMAC-SHA256 MAC 43, an ECDSA P-256 signature 86, a SHA-256
 * identity id 43, a P-256 SPKI 122) so they bound abuse without pinning the algorithm.
 */

import type { TPairingFrame } from './handshake.js';
import type { TReconnectFrame } from './reconnect.js';

/** Maximum accepted length (chars) per pre-auth wire field. Part of the wire contract. */
export const PRE_AUTH_FRAME_LIMITS = {
  nonce: 64,
  mac: 128,
  sig: 256,
  deviceId: 128,
  spki: 2048,
} as const;

/** The identity-exchange frame both sides send after a first-pair accept (E3 enrollment). */
export interface IEnrollFrame {
  readonly t: 'enroll-key';
  readonly spki: string;
}

/** Every frame a carrier admits before the session is exposed. */
export type TPreAuthFrame = TPairingFrame | TReconnectFrame | IEnrollFrame;

export type TFrameDecodeResult<TFrame> =
  { readonly ok: true; readonly frame: TFrame } | { readonly ok: false; readonly reason: string };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function fail<TFrame>(reason: string): TFrameDecodeResult<TFrame> {
  return { ok: false, reason };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** A required base64url field within its ceiling; the reason names the field, never echoes it. */
function field(
  frame: Record<string, unknown>,
  name: keyof typeof PRE_AUTH_FRAME_LIMITS | 'nonceHost' | 'nonceDevice',
): { readonly value: string } | { readonly reason: string } {
  const limit =
    name === 'nonceHost' || name === 'nonceDevice'
      ? PRE_AUTH_FRAME_LIMITS.nonce
      : PRE_AUTH_FRAME_LIMITS[name];
  const raw = frame[name];
  if (typeof raw !== 'string') return { reason: `${name}: expected a string` };
  if (raw.length === 0) return { reason: `${name}: empty` };
  if (raw.length > limit) return { reason: `${name}: exceeds ${limit} chars` };
  if (!BASE64URL.test(raw)) return { reason: `${name}: not base64url` };
  return { value: raw };
}

export function decodePairingFrame(value: unknown): TFrameDecodeResult<TPairingFrame> {
  const frame = record(value);
  if (frame === undefined) return fail('pairing frame: expected an object');
  if (frame['t'] === 'pair-nonce') {
    const nonce = field(frame, 'nonce');
    return 'reason' in nonce
      ? fail(nonce.reason)
      : { ok: true, frame: { t: 'pair-nonce', nonce: nonce.value } };
  }
  if (frame['t'] === 'pair-confirm') {
    const mac = field(frame, 'mac');
    return 'reason' in mac
      ? fail(mac.reason)
      : { ok: true, frame: { t: 'pair-confirm', mac: mac.value } };
  }
  return fail('pairing frame: unknown discriminator');
}

export function decodeReconnectFrame(value: unknown): TFrameDecodeResult<TReconnectFrame> {
  const frame = record(value);
  if (frame === undefined) return fail('reconnect frame: expected an object');
  if (frame['t'] === 'rc-hello') {
    const deviceId = field(frame, 'deviceId');
    if ('reason' in deviceId) return fail(deviceId.reason);
    const nonceDevice = field(frame, 'nonceDevice');
    if ('reason' in nonceDevice) return fail(nonceDevice.reason);
    return {
      ok: true,
      frame: { t: 'rc-hello', deviceId: deviceId.value, nonceDevice: nonceDevice.value },
    };
  }
  if (frame['t'] === 'rc-host') {
    const nonceHost = field(frame, 'nonceHost');
    if ('reason' in nonceHost) return fail(nonceHost.reason);
    const sig = field(frame, 'sig');
    if ('reason' in sig) return fail(sig.reason);
    return { ok: true, frame: { t: 'rc-host', nonceHost: nonceHost.value, sig: sig.value } };
  }
  if (frame['t'] === 'rc-device') {
    const sig = field(frame, 'sig');
    return 'reason' in sig
      ? fail(sig.reason)
      : { ok: true, frame: { t: 'rc-device', sig: sig.value } };
  }
  return fail('reconnect frame: unknown discriminator');
}

export function decodeEnrollFrame(value: unknown): TFrameDecodeResult<IEnrollFrame> {
  const frame = record(value);
  if (frame === undefined) return fail('enroll frame: expected an object');
  if (frame['t'] !== 'enroll-key') return fail('enroll frame: unknown discriminator');
  const spki = field(frame, 'spki');
  return 'reason' in spki
    ? fail(spki.reason)
    : { ok: true, frame: { t: 'enroll-key', spki: spki.value } };
}
