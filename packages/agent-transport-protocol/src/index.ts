export { createWsHandler } from './ws-handler.js';
export type { IWsHandlerOptions } from './ws-handler.js';
// ARCH-030: the connection-scoped outbound delivery boundary every carrier builds and passes down.
export {
  createOutboundDelivery,
  createPendingStallClock,
  isOverPendingBudget,
  DEFAULT_MAX_PENDING_BYTES,
  DEFAULT_MAX_PENDING_MS,
} from './outbound-delivery.js';
export type {
  IPendingStallClock,
  TDeliveryErrorHandler,
  TOutboundDeliver,
} from './outbound-delivery.js';
export { PROTOCOL_SESSION_EVENT_CLASSIFICATION } from './ws-session-events.js';
// `ISubscribeSessionEventsOptions` is NOT here (ARCH-030): it is the options bag of
// `subscribeSessionEvents`, which is package-internal, and a barrel that exports the options of a
// function it does not export is the "internal implementation detail through the barrel" the
// version-management skill bans. It was also absent from the SPEC's Public API Surface table.
export type { TProtocolSessionEventClassification } from './ws-session-events.js';
export type { IProtocolSession } from './protocol-session.js';
export type { TClientMessage, TServerMessage, TSeqServerMessage } from './ws-protocol.js';
// Issue #2045: the owner-side runtime decoders; carriers implement `raw → decodeFrame → typed`.
export {
  MAX_INBOUND_FRAME_BYTES,
  decodeClientMessage,
  decodeFrame,
  decodeServerMessage,
} from './message-decoders.js';
export type { TMessageDecodeResult } from './message-decoders.js';
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

// SEC-008: admission — the one place a transport asks what credential it requires.
export {
  bearerCredential,
  credentialMatches,
  mintTransportToken,
  resolveAdmission,
} from './admission.js';

// PEER-001 (#1809): the receiver's record of what it has already taken responsibility for. Lives
// here rather than in a carrier because duplicate, retry and gap are questions about what was SEEN
// BEFORE, and no socket or frame codec has the memory to answer them.
export {
  acknowledgePeerMessage,
  admitPeerMessage,
  createPeerMessageLedger,
  forgetPeerOrigin,
} from './peer-message-ledger.js';
export type {
  IPeerMessageLedger,
  IPeerMessageRejection,
  IPeerMessageVerdict,
} from './peer-message-ledger.js';

// HANDOFF-001 (#1811): the ownership transaction. Every failure lands in the same place — the source
// keeps authority — because it only ever gives it up on evidence it holds.
export {
  advanceHandoff,
  beginHandoff,
  commitHandoff,
  handoffOutcome,
  sourceStillOwns,
} from './handoff-ownership.js';
export type { ICommitResult, IHandoffTransaction, ITransitionResult } from './handoff-ownership.js';
export {
  buildHandoffManifest,
  sealHandoffRecord,
  verifyHandoffPayload,
} from './handoff-manifest.js';
export {
  chunkCountFor,
  chunkHandoffPayload,
  DEFAULT_MAX_CHUNK_BYTES,
  HandoffChunkAssembler,
} from './handoff-chunking.js';
export type {
  IChunkResult,
  IHandoffChunk,
  TChunkOutcome,
  TChunkRejection,
} from './handoff-chunking.js';
export type {
  IBuildManifestInput,
  IIntegrityVerdict,
  ISourceRuntimeState,
  TIntegrityFailure,
  TManifestResult,
} from './handoff-manifest.js';
