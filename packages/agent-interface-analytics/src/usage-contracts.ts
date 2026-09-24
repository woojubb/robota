/**
 * @robota-sdk/agent-interface-analytics — usage and run-trace contracts.
 *
 * Extracted from `agent-interface-transport`'s `session-contracts.ts` by ARCH-105 (issue #2112).
 *
 * This family was declared INSIDE another module rather than as a file of its own, which is why the
 * extraction split declarations rather than moving a whole file.
 *
 * LAYER 0, with an EMPTY dependency set — every field below is a primitive or another declaration in
 * this file, so the package needs nothing, not even `agent-core`. Consumers compose it downward.
 */

/**
 * ANALYTICS-001: the execution unit a usage snapshot is attributed to, so session-log usage can be
 * reported and asserted per source (main thread vs a specific subagent / background task). A minimal
 * contract-layer descriptor — the framework's `IExecutionOrigin` lives a layer up and cannot be
 * imported here; the two stay aligned by `scope`/`id`.
 */
export interface IUsageSource {
  scope: 'main' | 'subagent' | 'background' | 'tool' | 'command' | 'skill';
  /** Stable id of the source (e.g. the subagent / background-task id); omitted for the main thread. */
  id?: string;
  /** Human label for reports (e.g. the agent type or task title). */
  label?: string;
}

export interface IUsageSnapshot {
  kind: 'exact' | 'estimated';
  scope: 'turn';
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  contextUsedTokens: number;
  contextMaxTokens: number;
  contextUsedPercentage: number;
  costStatus: 'unknown' | 'estimated' | 'exact';
  /**
   * SELFHOST-004: derived turn cost in USD, present iff `costStatus !== 'unknown'` (i.e. the turn's
   * model was priced). Computed from the `agent-core/model-pricing.ts` SSOT (`calculateModelCost`,
   * exact input/output split). Optional = backward-compatible; a turn on an unpriced model omits it.
   */
  costUsd?: number;
  /** ANALYTICS-001: which execution unit consumed these tokens. Defaults to the main thread. */
  source?: IUsageSource;
}

/** DATA-2577: one persisted, content-free observation for a started interactive turn. */
export type TUsageSurface = 'cli' | 'desktop-app' | 'browser' | 'remote' | 'unknown';

export interface IUsageObservation {
  usageObservationId: string;
  turnId: string;
  outcome: 'success' | 'failure' | 'interrupted';
  /** Actual prompt execution boundary, absent for failures before execution begins. */
  promptExecutionStartedAt?: string;
  /** First terminal callback, not the later context/wake/handle settlement. */
  promptExecutionEndedAt?: string;
  /** First terminal callback outcome; may differ from the final turn outcome after later failures. */
  promptExecutionOutcome?: IUsageObservation['outcome'];
  /** Fresh, content-free OpenTelemetry-compatible root identity for this prompt execution. */
  promptExecutionTraceId?: string;
  promptExecutionSpanId?: string;
  modelId?: string;
  providerId?: string;
  surface?: TUsageSurface;
  source?: IUsageSource;
  usage?: IUsageSnapshot;
}

/** An explicitly linked, content-free provider round under one persisted prompt root. */
export interface IProviderCallTraceEntry {
  callId?: string;
  traceId: string;
  parentSpanId: string;
  spanId: string;
  startedAt: string;
  endedAt: string;
  outcome: 'success' | 'failure' | 'interrupted';
  round: number;
  disposition?: 'invoked' | 'cache-hit' | 'preflight-refused';
  providerId?: string;
  modelId?: string;
  usageProvenance?: 'complete' | 'partial' | 'absent';
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Opaque ID the provider returned for this invoked call; live projection only, not written to history. */
  providerRequestId?: string;
}

/** The awaited body of one permitted tool call under a persisted prompt root. */
export interface IToolBodyTraceEntry {
  /** Opaque ID of the actual permitted call in live projection; not written to history. */
  toolCallId?: string;
  traceId: string;
  parentSpanId: string;
  spanId: string;
  startedAt: string;
  endedAt: string;
  outcome: 'success' | 'failure' | 'interrupted';
}

/** Live-only decision reached for one tool call before any body runs; never written to history. */
export interface IToolPermissionDecisionEntry {
  /** Opaque ID of the tool call; the same value a permitted body's live entry carries. */
  toolCallId?: string;
  traceId: string;
  parentSpanId: string;
  decidedAt: string;
  decision: 'allowed' | 'denied' | 'hook-blocked';
}

/** One bounded, content-free live prompt execution; not a final turn result or delivery receipt. */
export interface ILivePromptTraceBatch {
  readonly schemaVersion: 1;
  readonly sessionId: string;
  readonly turnId: string;
  readonly root: {
    readonly traceId: string;
    readonly spanId: string;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly outcome: 'success' | 'failure' | 'interrupted';
  };
  /** Callback order, not an inferred causal sequence. Retry joins are unavailable. */
  readonly children: readonly (
    | { readonly kind: 'provider'; readonly trace: IProviderCallTraceEntry }
    | { readonly kind: 'tool'; readonly trace: IToolBodyTraceEntry }
    | { readonly kind: 'permission'; readonly decision: IToolPermissionDecisionEntry }
  )[];
  /** Invalid or over-limit children are never silently represented as a complete trace. */
  readonly omittedChildren: { readonly provider: number; readonly tool: number; readonly permission: number };
}

export interface IPersonalUsageRequest {
  period: '7d' | '30d';
  /** IANA timezone used to assign observations to local calendar days. */
  timezone: string;
}

export interface IPersonalUsageTotals {
  sessions: number;
  turns: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  costStatus: 'unknown' | 'estimated' | 'exact';
}

export interface IPersonalUsageDimension extends Omit<IPersonalUsageTotals, 'sessions'> {
  key: string;
  label: string;
  /** Stable ids of persisted sessions that contributed to this aggregate. */
  sessionIds: string[];
}

export interface IPersonalUsageActivity {
  key: string;
  label: string;
  kind: 'tool' | 'skill' | 'plugin';
  count: number;
}

export interface IPersonalUsageDay {
  date: string;
  partial: boolean;
  totals: IPersonalUsageTotals;
  /** Stable ids of persisted sessions that contributed usage or activity on this local day. */
  sessionIds: string[];
}

export interface IPersonalUsageCoverage {
  validSessions: number;
  corruptSessions: number;
  unsupportedSessions: number;
  duplicateObservations: number;
  legacyObservations: number;
  unknownModelObservations: number;
  unknownProviderObservations: number;
  unknownSurfaceObservations: number;
  corruptSessionIds: string[];
  unsupportedSessionIds: string[];
}

/** OBSERVABILITY-2577: stable, content-free cross-session report consumed by CLI and GUI. */
export interface IPersonalUsageReport {
  schemaVersion: 1;
  generatedAt: string;
  period: IPersonalUsageRequest['period'];
  timezone: string;
  interval: { startDate: string; endDate: string };
  totals: IPersonalUsageTotals;
  daily: IPersonalUsageDay[];
  byModel: IPersonalUsageDimension[];
  byProvider: IPersonalUsageDimension[];
  bySurface: IPersonalUsageDimension[];
  bySource: IPersonalUsageDimension[];
  byActivity: IPersonalUsageActivity[];
  sessionIds: string[];
  coverage: IPersonalUsageCoverage;
}

/**
 * SELFHOST-004: a per-operation span entry recorded on the session timeline. Carried as the `data` of
 * an `IHistoryEntry<ISpanEntry>` on `IInteractiveSessionRecord.history`. It is the record-side projection
 * of the `agent-core` span-completion event (`ISpanCompletionEventData`): the framework builds it from
 * the event (mirroring the usage-summary entry), so `agent-core` never depends on this transport type.
 * Joinable to its turn via the enclosing entry's position in `history`.
 */
export interface ISpanEntry {
  /** The span id (equals the source event's `spanId`; correlatable across the trace). */
  spanId: string;
  /** The operation name (e.g. the tool name). */
  op: string;
  /** Measured wall-clock duration of the operation, in milliseconds. */
  durationMs: number;
}

/**
 * SELFHOST-004: the trace/cost read-model that crosses the sidecar boundary (P5 carrier). It is a
 * BOUNDARY CONTRACT, so it is owned here. The `agent-session-analytics` producer depends on this
 * package; the `agent-transport` carrier depends on this package and `agent-interface-transport`.
 * `summarizeUsageBySource` assembles it; a `TServerMessage` variant carries it to the TUI/GUI.
 */
export interface IUsageSourceTotals {
  /** Stable grouping key (`<scope>:<id>`). */
  key: string;
  source: IUsageSource;
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** How many usage snapshots (turns) were attributed to this source. */
  turns: number;
  /** Share of the session's total tokens, 0–100 (rounded to 1 decimal). */
  percentage: number;
  /** Exact cost (USD) summed from each turn's `IUsageSnapshot.costUsd` (unpriced turns contribute 0). */
  costUsd: number;
  /** Whether every turn has independently proven billed cost; table estimates do not qualify. */
  costExact: boolean;
}

/** SELFHOST-004: one per-operation span on the run timeline (record-side projection of a span event). */
export interface IRunTraceSpan {
  spanId: string;
  op: string;
  durationMs: number;
}

/** SELFHOST-004: one turn on the run timeline, with its sub-turn spans grouped underneath. */
export interface IRunTraceTurn {
  /** 0-based position of this turn among the session's usage-summary turns. */
  turnIndex: number;
  /** The source that owns this turn (main thread when unattributed). */
  source: IUsageSource;
  label: string;
  /** Spans that ran during this turn, in timeline order. */
  spans: IRunTraceSpan[];
  /** Sum of the turn's span durations, in milliseconds. */
  totalDurationMs: number;
}

export interface IUsageBySourceReport {
  sessionId: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  /** Exact total cost (USD) across all priced turns in the session. */
  costUsd: number;
  /** Whether every turn in the session carried an exact `costUsd` (no unpriced turns). */
  costExact: boolean;
  /** Per-source totals, sorted by `totalTokens` descending. */
  bySource: IUsageSourceTotals[];
  /** The single biggest token consumer, if any usage was recorded. */
  topConsumer?: IUsageSourceTotals;
  /** The span timeline — one entry per turn, sub-turn spans grouped under their owning turn. */
  timeline: IRunTraceTurn[];
}
