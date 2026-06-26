// @robota-sdk/agent-session-analytics
//
// Session-log timing analysis and reporting. Pure analysis over canonical session records — no
// file I/O, no process concerns. Composition (loading records, writing output) lives in the caller.

export type {
  TSessionAnalysisInput,
  TIntervalKind,
  ITimingInterval,
  ITimingStats,
  ISessionTimingReport,
  IAggregateReport,
} from './types.js';

export { analyzeSession, aggregateReports, computeTimingIntervals, gapMs } from './analyze.js';
export { formatSingleSession, formatAggregateReport } from './report.js';
