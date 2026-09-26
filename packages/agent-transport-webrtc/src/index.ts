export { WebRtcTransport } from './webrtc-transport.js';
export type { IWebRtcTransportOptions, IIceServer } from './webrtc-transport-options.js';
export type {
  IConnectionApproval,
  IConnectionApprovalContext,
  IHostReconnectConfig,
} from './pairing-gate.js';
// The judge and the frame predicate stay internal: they are this package's policy plumbing, and a
// composition root only needs to SUPPLY the port and, on the peer side, know the frame's shape.
export { localProofFrame } from './local-peer-proof.js';
export type { ILocalPeerProof, ILocalProofFrame } from './local-peer-proof.js';
// SEC-011 (issue #1865): the cross-device hand-off grant gate. The verdict is injected — this
// package implements no cryptographic policy.
export { handoffGrantFrame } from './handoff-grant-gate.js';
export type { IHandoffGrantFrame, IHandoffGrantProof } from './handoff-grant-gate.js';
export { createInMemorySignalingPair } from './signaling.js';
export type { ISignalingClient, ISignalMessage, TSignalKind } from './signaling.js';
export { WsSignalingClient } from './ws-signaling-client.js';
export type { IWsSignalingClientOptions, IWebSocketLike } from './ws-signaling-client.js';
export { loadDataChannel } from './datachannel-loader.js';
// One peer connection over the WebRTC implementation this package runs on (hosts, tests, tools).
export { RtcChannel, RtcPeer } from './rtc-peer.js';
export type {
  IRtcCandidate,
  IRtcPeerDiagnostics,
  IRtcPeerOptions,
  TRtcChannelState,
  TRtcPeerState,
} from './rtc-peer.js';
export type { IDataChannelModule, TModuleResolver } from './datachannel-loader.js';
// The device mesh: CLI↔CLI connections between one user's devices, admitted by the device handshake.
export { DeviceMeshNode } from './device-mesh-node.js';
export type {
  IDeviceMeshLink,
  IDeviceMeshNodeOptions,
  IDeviceMeshRefusal,
} from './device-mesh-node.js';
export { MeshLinkEndedError } from './mesh-peer-link.js';
export type { TMeshLinkEnd, TMeshLinkRole, TMeshLinkStage } from './mesh-peer-link.js';
export { MAX_MESH_MESSAGE_CHARS } from './mesh-signal.js';
export { createInMemoryMeshRelayHub } from './mesh-relay.js';
export type { IInMemoryMeshRelayHub, IMeshRelay } from './mesh-relay.js';
export { WsMeshRelayClient } from './ws-mesh-relay-client.js';
export type { IWsMeshRelayClientOptions } from './ws-mesh-relay-client.js';
// Finding a peer device before the relay: the address cache, mDNS, then public records, each
// yielding candidates only; then public signaling carriers, then the self-hosted relay.
export { DiscoveringMeshRelay, startLanMeshRelay } from './discovering-mesh-relay.js';
export type {
  IDiscoveringMeshRelayOptions,
  IMeshAdvertiser,
  IStartLanMeshRelayOptions,
} from './discovering-mesh-relay.js';
export { DEFAULT_MAX_PUBLISH_JITTER_MS, MeshDht } from './mesh-dht.js';
export type { IFetchedLists, IMeshDhtOptions, IPublishedLists } from './mesh-dht.js';
export { createInMemoryItemNetwork, createPkarrRelayStore } from './mesh-item-store.js';
export type {
  IInMemoryItemNetwork,
  IPkarrRelayStoreOptions,
  IRendezvousItemStore,
} from './mesh-item-store.js';
export { startMainlineDhtStore } from './mainline-dht-store.js';
export type { IMainlineDht, IMainlineDhtStoreOptions } from './mainline-dht-store.js';
export {
  NostrMeshRelay,
  createInMemoryNostrHub,
  createNostrRelayPool,
} from './nostr-mesh-relay.js';
export type {
  IInMemoryNostrHub,
  INostrEvent,
  INostrFilter,
  INostrMeshRelayOptions,
  INostrRelayPool,
} from './nostr-mesh-relay.js';
export {
  MAX_CACHED_CANDIDATES,
  addressCacheSource,
  createInMemoryMeshAddressCache,
} from './mesh-discovery.js';
export type {
  IMeshAddressCache,
  IMeshCandidate,
  IMeshCandidateSource,
  IMeshPeerRoute,
} from './mesh-discovery.js';
export { startMeshLanListener } from './mesh-lan-listener.js';
export type { IMeshLanListener, IMeshLanListenerOptions } from './mesh-lan-listener.js';
export {
  MESH_MDNS_SERVICE,
  MeshMdns,
  createInMemoryMdnsBus,
  localInterfaceAddresses,
  paddedInstanceCount,
} from './mesh-mdns.js';
export { DEFAULT_NOSTR_RELAYS, DEFAULT_PKARR_RELAYS } from './mesh-public-relays.js';
export type {
  IInMemoryMdnsBus,
  IMdnsPacket,
  IMdnsRecord,
  IMdnsTransport,
  IMeshMdnsOptions,
} from './mesh-mdns.js';
