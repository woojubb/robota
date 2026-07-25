export { createWsTransport } from './ws-transport.js';
export type { IWsTransportOptions } from './ws-transport.js';
export { WsTransport } from './ws-transport-configurable.js';
export type { IWsTransportConfig } from './ws-transport-configurable.js';
// TRANS-001 — payload-agnostic channel multiplexing (also usable standalone by another carrier).
export { PayloadChannelRegistry } from './payload-channels.js';
export type { TChannelSink } from './payload-channels.js';
