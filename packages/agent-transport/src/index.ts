/**
 * Platform-neutral entry point for `@robota-sdk/agent-transport`.
 *
 * ## Why this file exists
 *
 * The package's `./node` entry owns the modules that need a Node host: the handoff manifest and file
 * transfer (`node:crypto`), the bearer resource gate (`node:http`, `node:net`), the stdio carrier
 * (`node:stream`) and the access-token verifier (the egress boundary of `agent-core/node`). Keeping
 * them out of this root means a browser, a Worker, Deno or Bun consumer never pulls a Node builtin
 * into its bundle.
 *
 * ## What is in, and why
 *
 * Everything the wire protocol needs that no host provides: transport admission (the decision is
 * minted and compared from `agent-core`'s neutral randomness and comparison), the session-message
 * dispatch with its decoders, resumable delivery, the channel frame codec, the peer-message ledger
 * and handoff chunking. None of them imports a builtin or reads a Node global, and
 * `scripts/harness/check-platform-neutral.mjs` bundles this entry on every lint run to keep it so.
 *
 * Handoff authority, offer refusal, and inventory decisions live in
 * `agent-interface-session-mobility`, outside this wire package.
 *
 * The handoff MANIFEST types are omitted along with their functions: they describe what only `./node`
 * seals and verifies, so a consumer that needs them is asking for the Node surface and should say so
 * by importing `./node`.
 */

export { createSessionMessageHandler } from './session-message-handler.js';
export type { ISessionMessageHandlerOptions } from './session-message-handler.js';
export { handleSurfaceRoleMessage, resolveSurfaceRole } from './surface-role.js';
export type { TSurfaceRoleDecision, TSurfaceRoleRefusal } from './surface-role.js';
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
// The one list of messages an observer may send: the host refuses the rest, a client sends no others.
export { isObserverMessageType } from './observer-messages.js';
// The most history one frame carries, sized for the tightest channel; a carrier whose channel is
// small (a WebRTC data channel) bounds an app view's frame by the same number.
export { HISTORY_PAGE_MAX_BYTES } from './session-query-messages.js';
export type { TProtocolSessionEventClassification } from './session-events.js';
export type { IProtocolSession } from './protocol-session.js';
export type {
  IWireAgentDefinitionSummary,
  IWireHistoryEntry,
  TClientMessage,
  TServerMessage,
  TSeqServerMessage,
  TSessionSurfaceRole,
  TWireExecutionResult,
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
// #3282 §4a: the Settings screen's host-owned read/write seam (parallels `IUsageQueryReporters`).
export { handleSettingsMessage, isSettingsMessage } from './settings-messages.js';
export type { ISettingsReporter, TSettingsUpdateOutcome } from './settings-messages.js';

// SEC-008: the admission decision every transport resolves through, and the bearer-header and
// credential helpers that apply it. The shape of the decision is `agent-interface-transport`'s.
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

// The argument a person recognises a tool call by, shared by every transport that asks a person
// about a permission in its own wire form, so they name the same call the same way.
export { permissionSummaryArgument } from './permission-summary.js';

// The handoff integrity helpers (`sealHandoffRecord`, `verifyHandoffPayload`) are on `./node`, which
// hashes with `node:crypto`. Chunking is here because it never hashes anything.
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
