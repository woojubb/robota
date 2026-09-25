// @robota-sdk/agent-interface-analytics

// ── Usage and run-trace contracts (ARCH-105 · issue #2112) ───
export type {
  IUsageSource,
  IUsageSnapshot,
  ISpanEntry,
  IUsageSourceTotals,
  IRunTraceSpan,
  IRunTraceTurn,
  IUsageBySourceReport,
  IUsageObservation,
  IUsageModelShare,
  IProviderCallTraceEntry,
  IToolBodyTraceEntry,
  IToolPermissionDecisionEntry,
  ILivePromptTraceBatch,
  TUsageSurface,
  IPersonalUsageRequest,
  IPersonalUsageTotals,
  IPersonalUsageDimension,
  IPersonalUsageActivity,
  IPersonalUsageDay,
  IPersonalUsageCoverage,
  IPersonalUsageReport,
} from './usage-contracts.js';

// ── Opt-in live prompt, response and tool content, carried beside the content-free trace ───
export type {
  TLivePromptContentKind,
  ILivePromptContentPolicy,
  ILivePromptContentItem,
  ILivePromptContentBatch,
  ILivePromptContentToolRef,
  TLivePromptContentOmitted,
} from './live-content-contracts.js';
