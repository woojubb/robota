/**
 * `@robota-sdk/remote-signaling` — minimal, content-blind WebRTC signaling relay.
 *
 * Pairs two peers by an opaque rendezvous id and relays SDP/ICE only. Holds no session content and
 * authenticates no one by default: the peers confirm each other end to end during pairing, and the relay limits abuse
 * at its own layer. It is not part of any published or deployed artifact — you run it yourself.
 */
export { SignalingRelay, MAX_PEERS_PER_RENDEZVOUS } from './relay.js';
export type {
  ISignalingPeer,
  ISignalingRelayHooks,
  ISignalingRelayOptions,
  IJoinAttemptContext,
  TInboundFrame,
  TSignalKind,
} from './relay.js';
export {
  TokenBucketLimiter,
  systemClock,
  systemScheduler,
  DEFAULT_TOKEN_BUCKET,
  DEFAULT_MESSAGE_RATE,
  DEFAULT_RENDEZVOUS_TTL_MS,
  DEFAULT_MAX_RENDEZVOUS,
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_MAX_CONNECTIONS_PER_IP,
  DEFAULT_MAX_FRAME_BYTES,
} from './rate-limiter.js';
export type { IClock, IScheduler, ITokenBucketConfig } from './rate-limiter.js';
export { startSignalingServer, OVER_CAPACITY_CLOSE_CODE } from './server.js';
export type {
  ISignalingServerOptions,
  ISignalingServerHandle,
  TAddressResolver,
} from './server.js';
