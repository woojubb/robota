/**
 * @robota-sdk/agent-interface-analytics — usage and run-trace contracts.
 *
 * Extracted from `agent-interface-transport`'s `session-contracts.ts` by ARCH-105 (issue #2112) under
 * the owner map in `.agents/specs/contract-family-owner-map.md`.
 *
 * This family was declared INSIDE another module rather than as a file of its own, which is why the
 * owner map records it as `symbols@session-contracts` and why this leaf is a split rather than a move.
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
 * BOUNDARY CONTRACT, so it is owned here (both the `agent-session-analytics` producer and the
 * `agent-transport-protocol` carrier depend on `agent-interface-transport`). `summarizeUsageBySource`
 * assembles it; a `TServerMessage` variant carries it to the TUI/GUI.
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
  /** Whether every turn attributed to this source carried an exact `costUsd`. */
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
