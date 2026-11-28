import type { IDelegationReport } from './outcome-coding-protocol.js';
import type { IRelayLogEntry } from './outcome-coding-relay.js';
import { COORDINATION_ROLES } from './outcome-delegation-roles.js';

/** What one role spent in a trial. Failed attempts are counted like any other. */
export interface IRoleMeasure {
  /** Upstream attempts made for the role. */
  readonly calls: number;
  /** Requests refused before any upstream attempt. */
  readonly refusedCalls: number;
  /** Attempts that got no answer or a status outside 2xx. */
  readonly failedCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** Attempts whose answer reported no token counts (the tokens are unknown, not zero). */
  readonly tokenUnknownCalls: number;
  /** Wall time spent waiting on the single upstream attempts. */
  readonly latencyMs: number;
}

export interface ICoordinationMeasure {
  /** The roles counted as coordination: the parent and the reviewer. */
  readonly roles: readonly string[];
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly latencyMs: number;
  /** Time between one child job ending and the next starting; null without a job report. */
  readonly idleBetweenJobsMs: number | null;
}

/** Two child jobs whose timed windows overlapped; the numbers are start-order positions from 0. */
export interface IOverlappingJobs {
  readonly first: number;
  readonly second: number;
}

/** An observation only: the trial's verdict does not depend on it. */
export interface IJobOverlap {
  readonly count: number;
  readonly pairs: readonly IOverlappingJobs[];
}

export interface ITrialMeasures {
  readonly byRole: Readonly<Record<string, IRoleMeasure>>;
  readonly total: IRoleMeasure;
  readonly coordination: ICoordinationMeasure;
  readonly childJobsStarted: number | null;
  readonly childJobsRefused: number | null;
  /**
   * Child jobs that ran at the same time. Idle time counts an overlap as zero, so a trial that was
   * not serial shows here; null without a job report.
   */
  readonly childJobOverlap: IJobOverlap | null;
  /** Wall time of the whole trial as the host saw it. */
  readonly wallMs: number;
}

const EMPTY: IRoleMeasure = {
  calls: 0,
  refusedCalls: 0,
  failedCalls: 0,
  promptTokens: 0,
  completionTokens: 0,
  tokenUnknownCalls: 0,
  latencyMs: 0,
};

function add(into: IRoleMeasure, entry: IRelayLogEntry): IRoleMeasure {
  if (entry.upstreamAttempts === 0) return { ...into, refusedCalls: into.refusedCalls + 1 };
  const failed = entry.outcome !== 'forwarded' || entry.status < 200 || entry.status >= 300 ? 1 : 0;
  const unknown = entry.promptTokens === undefined && entry.completionTokens === undefined ? 1 : 0;
  return {
    calls: into.calls + 1,
    refusedCalls: into.refusedCalls,
    failedCalls: into.failedCalls + failed,
    promptTokens: into.promptTokens + (entry.promptTokens ?? 0),
    completionTokens: into.completionTokens + (entry.completionTokens ?? 0),
    tokenUnknownCalls: into.tokenUnknownCalls + unknown,
    latencyMs: into.latencyMs + (entry.latencyMs ?? 0),
  };
}

/** Idle time between child jobs: each gap from one job's end to the next job's start. */
export function idleBetweenJobs(report: IDelegationReport | undefined): number | null {
  if (report === undefined) return null;
  let idle = 0;
  for (let index = 1; index < report.jobs.length; index += 1) {
    const previous = report.jobs[index - 1];
    const next = report.jobs[index];
    if (previous === undefined || next === undefined || previous.endMs === null) continue;
    idle += Math.max(0, next.startMs - previous.endMs);
  }
  return idle;
}

/** Every pair of jobs where the later one started before the earlier one ended (or never ended). */
export function overlappingJobs(report: IDelegationReport | undefined): IJobOverlap | null {
  if (report === undefined) return null;
  const pairs: IOverlappingJobs[] = [];
  report.jobs.forEach((earlier, first) => {
    report.jobs.forEach((later, second) => {
      if (second <= first) return;
      if (earlier.endMs === null || later.startMs < earlier.endMs) pairs.push({ first, second });
    });
  });
  return { count: pairs.length, pairs };
}

/**
 * Pure: the by-role measures of one trial from the relay's log and the worker's job report.
 * Coordination is what the parent and the reviewer spent, plus the idle time between child jobs;
 * the implementer's calls are the work itself.
 */
export function measureTrial(
  log: readonly IRelayLogEntry[],
  report: IDelegationReport | undefined,
  wallMs: number,
): ITrialMeasures {
  const byRole: Record<string, IRoleMeasure> = {};
  let total = EMPTY;
  for (const entry of log) {
    const role = entry.role ?? 'unattributed';
    byRole[role] = add(byRole[role] ?? EMPTY, entry);
    total = add(total, entry);
  }
  const coordinating = COORDINATION_ROLES.map((role) => byRole[role] ?? EMPTY);
  const sum = (pick: (measure: IRoleMeasure) => number): number =>
    coordinating.reduce((acc, measure) => acc + pick(measure), 0);
  return {
    byRole,
    total,
    coordination: {
      roles: COORDINATION_ROLES,
      calls: sum((measure) => measure.calls),
      promptTokens: sum((measure) => measure.promptTokens),
      completionTokens: sum((measure) => measure.completionTokens),
      latencyMs: sum((measure) => measure.latencyMs),
      idleBetweenJobsMs: idleBetweenJobs(report),
    },
    childJobsStarted: report?.jobsStarted ?? null,
    childJobsRefused: report?.jobsRefused ?? null,
    childJobOverlap: overlappingJobs(report),
    wallMs,
  };
}
