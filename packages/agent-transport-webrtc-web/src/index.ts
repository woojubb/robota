// @robota-sdk/agent-transport-webrtc-web — the BROWSER WebRTC transport peer (REMOTE-009 Stage D).
//
// The browser mirror of the node-side host transport @robota-sdk/agent-transport-webrtc: it answers the
// host's WebRTC offer over a native RTCPeerConnection, runs the directional-HMAC pairing handshake as
// RESPONDER behind a fail-closed gate, and co-drives the SAME session over an RTCDataChannel. It binds the
// shared session reducer from @robota-sdk/agent-transport-gui (imported directly — NOT re-exported here;
// the repo forbids pass-through re-exports) and widens the status union with the RTC pairing/failed states.

export { RemoteClient } from './components/RemoteClient.js';
export { useRtcSession } from './hooks/useRtcSession.js';
export type { TSessionStatus } from './hooks/useRtcSession.js';
export { createRtcSessionClient } from './client/rtc-session-client.js';
export type { TRtcConnectionStatus } from './client/rtc-session-client.js';
export { createRtcSignalingClient } from './client/rtc-signaling.js';
export { parseRemoteClientLocation } from './client/parse-remote-location.js';
