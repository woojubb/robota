/**
 * Types for session-log timing analysis.
 *
 * The input record shape is derived from the canonical `IInteractiveSessionRecord`
 * (agent-interface-transport, DATA-001 SSOT) via `Pick` — this package owns no duplicate
 * session-record type. History entries are the canonical `IHistoryEntry` (agent-core).
 */

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-transport';

/** Minimal session-record projection the analyzer reads — SSOT-derived, not a duplicate. */
export type TSessionAnalysisInput = Pick<
  IInteractiveSessionRecord,
  'id' | 'cwd' | 'createdAt' | 'history'
>;

export type TIntervalKind =
  | 'user_to_first_tool'
  | 'user_to_assistant'
  | 'tool_exec'
  | 'llm_between_tools'
  | 'llm_final_response';

export interface ITimingInterval {
  kind: TIntervalKind;
  fromType: string;
  toType: string;
  fromTimestamp: string;
  toTimestamp: string;
  durationMs: number;
  turnIndex: number;
}

export interface ITimingStats {
  llmWaitMs: { avg: number; max: number; total: number; count: number };
  toolExecMs: { avg: number; max: number; median: number; count: number };
  userToAssistantMs: { avg: number; max: number; count: number };
}

export interface ISessionTimingReport {
  sessionId: string;
  cwd: string;
  createdAt: string;
  totalIntervals: number;
  intervals: ITimingInterval[];
  slowIntervals: ITimingInterval[];
  stats: ITimingStats;
}

export interface IAggregateReport {
  sessionCount: number;
  fromDate: string;
  toDate: string;
  avgLlmResponseMs: number;
  avgToolExecMs: number;
  maxSingleDelayMs: number;
  maxSingleDelaySession: string;
  maxSingleDelayTurn: number;
  maxSingleDelayKind: string;
}
