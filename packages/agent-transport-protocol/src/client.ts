/** Browser-safe protocol surface: wire unions plus runtime frame decoders, with no Node admission code. */
export {
  MAX_INBOUND_FRAME_BYTES,
  decodeClientMessage,
  decodeFrame,
  decodeServerMessage,
} from './message-decoders.js';
export type { TMessageDecodeResult } from './message-decoders.js';
export type { TClientMessage, TServerMessage, TSeqServerMessage } from './ws-protocol.js';
