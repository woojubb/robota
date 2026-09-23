/**
 * Predicates over the pairing/reconnect frame vocabulary the gate admits pre-accept.
 *
 * Issue #2046: these are thin adapters over the OWNER codec in `@robota-sdk/agent-remote-pairing`,
 * which decodes every required field (presence, base64url, length ceiling) rather than only the `t`
 * discriminator this file used to check. A true answer means the narrowed value is well-formed; the
 * browser `ResponderGate` imports the same codec, so one corpus governs both carriers.
 */

import {
  decodeEnrollFrame,
  decodePairingFrame,
  decodeReconnectFrame,
  type IEnrollFrame,
  type TPairingFrame,
  type TReconnectFrame,
} from '@robota-sdk/agent-remote-pairing';

export type { IEnrollFrame };

/** True when a parsed value is a well-formed B3 pairing frame (`pair-nonce` | `pair-confirm`). */
export function isPairingFrame(value: unknown): value is TPairingFrame {
  return decodePairingFrame(value).ok;
}

/** True when a parsed value is a well-formed reconnect frame (`rc-hello` | `rc-host` | `rc-device`). */
export function isReconnectFrame(value: unknown): value is TReconnectFrame {
  return decodeReconnectFrame(value).ok;
}

/** True when a parsed value is a well-formed first-pair enrollment frame carrying a device SPKI. */
export function isEnrollFrame(value: unknown): value is IEnrollFrame {
  return decodeEnrollFrame(value).ok;
}
