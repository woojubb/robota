// @robota-sdk/agent-web-ui — the BROWSER-REMOTE surface (REMOTE-009 Stage D).
//
// The shared GUI presentation core (session reducer, components, WS client, prompt state) lives in
// @robota-sdk/agent-transport-gui and is imported directly by consumers — it is NOT re-exported here
// (the repo forbids pass-through re-exports). This package owns only what is specific to driving a
// paired host over WebRTC from the browser: the RemoteClient page, the RTC session/signaling clients,
// the WebRTC-widened status union, and the remote-location parser.

export { SessionMonitor } from './components/SessionMonitor.js';
export { RemoteClient } from './components/RemoteClient.js';
export { useRtcSession } from './hooks/useRtcSession.js';
export type { TSessionStatus } from './hooks/useRtcSession.js';
export { createRtcSessionClient } from './client/rtc-session-client.js';
export type { TRtcConnectionStatus } from './client/rtc-session-client.js';
export { createRtcSignalingClient } from './client/rtc-signaling.js';
export { parseRemoteClientLocation } from './client/parse-remote-location.js';
