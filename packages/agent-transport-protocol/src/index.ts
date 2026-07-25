export { createWsHandler } from './ws-handler.js';
export type { IWsHandlerOptions } from './ws-handler.js';
export type { TClientMessage, TServerMessage, TSeqServerMessage } from './ws-protocol.js';
export { ResumeBuffer } from './resume-buffer.js';
export type { IResumeBufferOptions, IBufferedFrame, TResumeTail } from './resume-buffer.js';
// TRANS-001 — payload-agnostic channel frame codec (transport-neutral, body-opaque).
export {
  CHANNEL_FRAME_MAGIC,
  CHANNEL_FRAME_VERSION,
  decodeChannelFrame,
  encodeBinaryFrame,
  encodeChannelEventFrame,
  isChannelFrame,
} from './channel-frames.js';
export { SessionResumeBridge } from './session-resume-bridge.js';
export type {
  ISessionResumeBridgeOptions,
  TResumeSink,
  IAttachOptions,
} from './session-resume-bridge.js';
