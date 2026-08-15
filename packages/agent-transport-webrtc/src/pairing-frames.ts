/**
 * Predicates over the pairing/reconnect frame vocabulary the gate admits pre-accept.
 *
 * These answer "what KIND of frame is this", which is a question about the wire vocabulary, not about
 * the gate's state machine. They lived inside `pairing-gate.ts` where they were the only thing in the
 * file not about gating.
 */

import type { TPairingFrame, TReconnectFrame } from '@robota-sdk/agent-remote-pairing';

/** A gate-level identity-exchange frame (first-pair enrollment, post-B3-accept). */
export interface IEnrollFrame {
  readonly t: 'enroll-key';
  readonly spki: string;
}

/** True when a parsed value is a B3 pairing frame (`{ t: 'pair-nonce' | 'pair-confirm', … }`). */
export function isPairingFrame(value: unknown): value is TPairingFrame {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === 'pair-nonce' || t === 'pair-confirm';
}

/** True when a parsed value is a reconnect frame the host consumes (`rc-hello` / `rc-device`). */
export function isReconnectFrame(value: unknown): value is TReconnectFrame {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { t?: unknown }).t;
  return t === 'rc-hello' || t === 'rc-device';
}

/** True when a parsed value is the first-pair enrollment frame carrying a device SPKI. */
export function isEnrollFrame(value: unknown): value is IEnrollFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { t?: unknown }).t === 'enroll-key' &&
    typeof (value as { spki?: unknown }).spki === 'string'
  );
}
