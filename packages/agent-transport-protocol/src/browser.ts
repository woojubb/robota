/**
 * Browser-safe entry point for `@robota-sdk/agent-transport-protocol`.
 *
 * ## Why this file exists
 *
 * The package's `.` entry is a NODE bundle: `src/admission.ts` and `src/handoff-manifest.ts` import
 * `node:crypto` (`randomBytes`, `timingSafeEqual`, `createHash`), so the single barrel drags a Node
 * builtin into every consumer that reaches it. A browser consumer that only wanted the wire decoders
 * got the whole graph, and the bundler failed on `randomBytes` — not on the import that asked for it.
 *
 * ## What is in, and why
 *
 * Everything in `src/index.ts` EXCEPT the two modules that touch `node:crypto`. Read off the actual
 * import graph, not off intent:
 *
 *   node:crypto reachers   `admission.ts`, `handoff-manifest.ts` — and nothing inside the package
 *                          imports either of them, so removing both from this barrel severs the
 *                          builtin from this entry's graph entirely.
 *   everything else        `ws-handler` → {`ws-background-messages`, `message-decoders`,
 *                          `ws-session-events`}, `session-resume-bridge` → {`outbound-delivery`,
 *                          `resume-buffer`, `ws-handler`, `ws-session-events`}, `channel-frames`,
 *                          `peer-message-ledger`, `handoff-ownership`, `handoff-chunking`,
 *                          `protocol-session`, `ws-protocol` — no builtin on any path.
 *
 * `handoff-ownership` keeps a VALUE import of `sourceRetainsAuthority` from
 * `@robota-sdk/agent-interface-session-mobility`; that package imports no builtin either, so the
 * edge is browser-safe.
 *
 * The handoff MANIFEST types are omitted along with their functions. Keeping the `export type` lines
 * would be free at runtime, but it would put `handoff-manifest.ts` back on this entry's import graph
 * — and the `browser-package-node-subpath` scan that guards this file walks EVERY import edge rather
 * than trying to tell a type edge from a value one. A check that has to be clever about which edges
 * count is a check that can be fooled; a browser consumer that needs those types is asking for the
 * Node surface and should say so by importing `.`.
 */

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

// SEC-008 admission is NOT here: `src/admission.ts` mints and compares transport tokens with
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
// The handoff MANIFEST (`buildHandoffManifest`, `sealHandoffRecord`, `verifyHandoffPayload`) is NOT
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
