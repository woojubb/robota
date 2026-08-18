export { WebRtcTransport } from './webrtc-transport.js';
export type { IWebRtcTransportOptions, IIceServer } from './webrtc-transport-options.js';
export type { IHostReconnectConfig } from './pairing-gate.js';
// The judge and the frame predicate stay internal: they are this package's policy plumbing, and a
// composition root only needs to SUPPLY the port and, on the peer side, know the frame's shape.
export type { ILocalPeerProof, ILocalProofFrame } from './local-peer-proof.js';
export { createInMemorySignalingPair } from './signaling.js';
export type { ISignalingClient, ISignalMessage, TSignalKind } from './signaling.js';
export { WsSignalingClient } from './ws-signaling-client.js';
export type { IWsSignalingClientOptions, IWebSocketLike } from './ws-signaling-client.js';
export { loadWerift } from './werift-loader.js';
export type { IWeriftModule, TModuleResolver } from './werift-loader.js';
