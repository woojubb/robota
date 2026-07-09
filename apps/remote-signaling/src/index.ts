/**
 * `@robota-sdk/remote-signaling` — minimal, content-blind WebRTC signaling relay (REMOTE-002 Stage A).
 *
 * Pairs two peers by an opaque rendezvous id and relays SDP/ICE only. Holds no session content and carries no
 * auth in Stage A. Not wired into any default runnable / publish / deploy path (TC-06).
 */
export { SignalingRelay, MAX_PEERS_PER_RENDEZVOUS } from './relay.js';
export type { ISignalingPeer, ISignalingRelayHooks, TInboundFrame, TSignalKind } from './relay.js';
export { startSignalingServer } from './server.js';
export type { ISignalingServerOptions, ISignalingServerHandle } from './server.js';
