/**
 * The WebRTC settings under `transports.webrtc.options` in the user settings: the signaling relay,
 * ICE servers and the like, shared by remote control and device enrollment.
 */
import { readSettings } from '@robota-sdk/agent-framework';

import { robotaUserSettingsPath } from '../product/robota-user-settings.js';

/** Read a raw (untyped) value under `transports.webrtc.options.<key>` — for structured values (REMOTE-010). */
export function readWebrtcRawOption(key: string): unknown {
  const settings = readSettings(robotaUserSettingsPath());
  const transports = settings.transports;
  if (typeof transports !== 'object' || transports === null) return undefined;
  const webrtc = (transports as Record<string, unknown>).webrtc;
  if (typeof webrtc !== 'object' || webrtc === null) return undefined;
  const options = (webrtc as Record<string, unknown>).options;
  if (typeof options !== 'object' || options === null) return undefined;
  return (options as Record<string, unknown>)[key];
}

/** A non-empty string under `transports.webrtc.options.<key>`, or undefined. */
export function readWebrtcOption(key: string): string | undefined {
  const value = readWebrtcRawOption(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
