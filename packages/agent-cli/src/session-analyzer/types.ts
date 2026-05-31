/**
 * Types for session log analysis.
 */

export interface ISessionHistoryEntry {
  id: string;
  timestamp: string;
  category: 'chat' | 'event';
  type: string;
  data?: Record<string, unknown>;
}

export interface ISessionRecord {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  history: ISessionHistoryEntry[];
  messages?: unknown[];
}

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

export interface ISessionTimingReport {
  sessionId: string;
  cwd: string;
  createdAt: string;
  totalIntervals: number;
  intervals: ITimingInterval[];
  slowIntervals: ITimingInterval[];
  stats: ITimingStats;
}

export interface ITimingStats {
  llmWaitMs: { avg: number; max: number; total: number; count: number };
  toolExecMs: { avg: number; max: number; median: number; count: number };
  userToAssistantMs: { avg: number; max: number; count: number };
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
