// @robota-sdk/agent-interface-transport

// ── One interaction primitive, re-exported for a structural reason (ARCH-037) ──
//
// `TActionResponse`'s SSOT is `agent-core`, and a pass-through re-export is normally banned
// (STRUCT-07). This one stays because `agent-ui-web`, the GUI presentation layer, does not depend on
// `agent-core` and names the type only through this package; `agent-core` is the bottom layer, so
// the type cannot move here instead. (`agent-transport` imports it from here too, although it could
// reach `agent-core` directly.)
//
// `IActionRequest` was re-exported here too and is gone: every consumer already imported it from
// `agent-core` directly, so the re-export was a second name for a type nobody reached this way.
export type { TActionResponse } from '@robota-sdk/agent-core';

// ── Transport adapter contracts ──────────────────────────────
export type {
  IBoundTransportAdapter,
  IBoundTransportRunnerAdapter,
  IBoundTransportServiceAdapter,
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
  TBoundTransportAdapter,
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
  ITransportSavedConfig,
  ITransportSettingsRepository,
  ITransportEntry,
  ITransportConfigurationError,
  ITransportLifecycleRegistryView,
  ITransportRegistryView,
  ITransportSettingsRegistryView,
  TConfigurableTransport,
  TBoundConfigurableTransport,
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
// @robota-sdk/agent-transport — an interface package carries no runtime dependency edge.
export type { ITransportAdmission, ITransportAdmissionConfig } from './admission.js';

// Remote resource-server authorization: the shape of an access-token admission decision. The
// verifier that produces it lives in @robota-sdk/agent-transport/node.
export type {
  IAccessTokenVerifier,
  IAccessTokenVerifierConfig,
  TAccessTokenAdmission,
  TAccessTokenAlgorithm,
  TAccessTokenRefusal,
} from './access-token.js';

// External events: identity is the grant a verified access token matched, never a payload claim.
export type {
  IExternalEventDelivery,
  IExternalEventGrant,
  IExternalEventRateWindow,
  IExternalMessageEvent,
  TExternalEventAdmission,
  TExternalEventAuditRecord,
  TExternalEventRefusal,
  TExternalEventRemoteClass,
  TExternalEventSettlementOutcome,
} from './external-event.js';
