// @robota-sdk/agent-interface-transport

// ── One interaction primitive, re-exported for a structural reason (ARCH-037) ──
//
// `TActionResponse`'s SSOT is `agent-core`, and this is a pass-through re-export, which STRUCT-07
// bans. It survives as a NAMED exception because the ban has no answer here, and that was measured
// rather than assumed:
//
//   - its consumers are FOUR files across TWO packages — `agent-transport-gui` (three) and
//     `agent-transport-protocol` (one) — and neither package's documented dependency set
//     (`.agents/project-structure.md`) admits `agent-core`. An earlier revision said "the one
//     consumer is `agent-transport-gui`": a line-based count cannot see a multi-line import;
//   - `agent-core` has NO internal dependencies — it is the bottom layer — so the type cannot move
//     here instead.
//
// So this re-export is the only path by which a permitted consumer can name the type. ARCH-037's
// stated direction was to drop these and have consumers "import from `@robota-sdk/agent-core`";
// that holds for the two dropped alongside it and NOT for this one.
//
// `IActionRequest` was re-exported here too and is gone: every consumer already imported it from
// `agent-core` directly, so the re-export was a second name for a type nobody reached this way.
export type { TActionResponse } from '@robota-sdk/agent-core';

// ── Transport adapter contracts ──────────────────────────────
export type {
  ITransportAdapter,
  ITransportCompletionRecord,
  ITransportFailureRecord,
  ITransportLifecycle,
  ITransportLifecycleError,
  ITransportRollbackError,
  ITransportRunnerAdapter,
  ITransportServiceAdapter,
  ITransportStartupError,
  TNonZeroExitCode,
  TTransportAbandonmentReason,
  TTransportAdapter,
  TTransportCompletionOutcome,
  TTransportLifecycleKind,
  TTransportLifecycleErrorCode,
  TTransportRunOutcome,
} from './transport-adapter.js';
export { createTransportFailedOutcome, isTransportRunOutcome } from './transport-adapter.js';
export type {
  ITransportConfig,
  IConfigurableTransport,
  ITransportSettingsCapability,
  ITransportEntry,
  ITransportConfigurationError,
  ITransportLifecycleRegistryView,
  ITransportRegistryView,
  ITransportSettingsRegistryView,
  TConfigurableTransport,
  TTransportConfigurationErrorCode,
} from './transport-config.js';

// ── Payload-agnostic channel contracts (TRANS-001) ───────────
export type {
  IBinaryFrame,
  IChannelDescriptor,
  IChannelEventFrame,
  IPayloadChannel,
  IPayloadChannelHost,
  TChannelEventMap,
  TChannelFrame,
  TChannelReceiveResult,
} from './channel-contracts.js';

// Shared pure accessors over an InteractionEvent stream (values, not types).
// RUNTIME-003: the one narrowing for a rejected `ITurnHandle.completed` (a value, not a type).
// HARNESS-103: `createSessionCapabilityHost` / `readSessionCapability` are NOT here. They are the
// runtime mechanism the interface-package rule forbids, they have no production consumer, and they
// now live under `testing/` per `contracts→agent-interface-*, doubles→owner /testing`.

// SEC-008: the SHAPE of an admission decision. The machinery that produces it lives in
// @robota-sdk/agent-transport-protocol — an interface package carries no runtime dependency edge.
export type { ITransportAdmission, ITransportAdmissionConfig } from './admission.js';

// Session mobility — moving MESSAGES between live sessions (PEER-001) and AUTHORITY over a session
// to another machine (HANDOFF-001). One sub-barrel: they are one axis, and the root barrel is held
// under the anti-monolith limit rather than growing a section per feature.
export * from './session-mobility-contracts.js';
