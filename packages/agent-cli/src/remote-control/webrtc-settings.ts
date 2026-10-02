/**
 * The WebRTC settings under `transports.webrtc.options` in the user settings: the signaling relay,
 * ICE servers and the like, shared by remote control and device enrollment.
 */
import { readSettings } from '@robota-sdk/agent-framework';

import { productUserSettingsPath } from '../product/user-settings.js';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

/** Read a raw (untyped) value under `transports.webrtc.options.<key>` — for structured values (REMOTE-010). */
export function readWebrtcRawOption(productRuntime: ICliRuntimeContext, key: string): unknown {
  const settings = readSettings(productUserSettingsPath(productRuntime));
  const transports = settings.transports;
  if (typeof transports !== 'object' || transports === null) return undefined;
  const webrtc = (transports as Record<string, unknown>).webrtc;
  if (typeof webrtc !== 'object' || webrtc === null) return undefined;
  const options = (webrtc as Record<string, unknown>).options;
  if (typeof options !== 'object' || options === null) return undefined;
  return (options as Record<string, unknown>)[key];
}

/** A non-empty string under `transports.webrtc.options.<key>`, or undefined. */
export function readWebrtcOption(productRuntime: ICliRuntimeContext, key: string): string | undefined {
  const value = readWebrtcRawOption(productRuntime, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
