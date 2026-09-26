/** Browser-safe protocol surface: wire unions plus runtime frame decoders, with no Node admission code. */
export {
  MAX_INBOUND_FRAME_BYTES,
  decodeClientMessage,
  decodeFrame,
  decodeServerMessage,
} from './message-decoders.js';
export type { TMessageDecodeResult } from './message-decoders.js';
// The one list of messages an observer may send: the host refuses the rest, a client sends no others.
export { isObserverMessageType } from './observer-messages.js';
export type {
  IWireHistoryEntry,
  TClientMessage,
  TServerMessage,
  TSeqServerMessage,
  TWireExecutionResult,
} from './wire-messages.js';
