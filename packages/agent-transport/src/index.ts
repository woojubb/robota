/**
 * Browser-safe entry point for `@robota-sdk/agent-transport`.
 *
 * ## Why this file exists
 *
 * The package's `./node` entry owns `admission.ts` and `handoff-manifest.ts`, the only modules
 * that import `node:crypto`. Keeping those modules out of this root prevents a browser consumer
 * from pulling a Node builtin into its bundle.
 *
 * ## What is in, and why
 *
 * Everything in `src/index.ts` EXCEPT the two modules that touch `node:crypto`. Read off the actual
 * import graph, not off intent:
 *
 *   node:crypto reachers   `admission.ts`, `handoff-manifest.ts` — and nothing inside the package
 *                          imports either of them, so removing both from this barrel severs the
 *                          builtin from this entry's graph entirely.
 *   everything else        `session-message-handler` → {`background-messages`, `message-decoders`,
 *                          `session-events`}, `session-resume-bridge` → {`outbound-delivery`,
 *                          `resume-buffer`, `session-message-handler`, `session-events`}, `channel-frames`,
 *                          `peer-message-ledger`, `handoff-chunking`,
 *                          `protocol-session`, `wire-messages` — no builtin on any path.
 *
 * Handoff authority, offer refusal, and inventory decisions live in
 * `agent-interface-session-mobility`, outside this wire package.
 *
 * The handoff MANIFEST types are omitted along with their functions. Keeping the `export type` lines
 * would be free at runtime, but it would put `node/handoff-manifest.ts` back on this entry's import graph
 * — and the `browser-package-node-subpath` scan that guards this file walks EVERY import edge rather
 * than trying to tell a type edge from a value one. A check that has to be clever about which edges
 * count is a check that can be fooled; a browser consumer that needs those types is asking for the
 * Node surface and should say so by importing `./node`.
 */

export { createSessionMessageHandler } from './session-message-handler.js';
export type {
  ISessionMessageHandlerOptions,
  TSessionSurfaceRole,
} from './session-message-handler.js';
// ARCH-030: the connection-scoped outbound delivery boundary every carrier builds and passes down.
export {
  ATTACHED_SURFACE_MAX_PENDING_BYTES,
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
export { PROTOCOL_SESSION_EVENT_CLASSIFICATION } from './session-events.js';
export type { TProtocolSessionEventClassification } from './session-events.js';
export type { IProtocolSession } from './protocol-session.js';
export type {
  IWireHistoryEntry,
  TClientMessage,
  TServerMessage,
  TSeqServerMessage,
} from './wire-messages.js';
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

// SEC-008 admission is NOT here: `src/node/admission.ts` mints and compares transport tokens with
// `node:crypto`. A browser never mints one — it presents one it was handed — so the exclusion costs
// the browser surface nothing it could have used.

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

// The handoff integrity helpers (`sealHandoffRecord`, `verifyHandoffPayload`) are NOT
// here: it hashes with `node:crypto`. Chunking is, because it never hashes anything.
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
