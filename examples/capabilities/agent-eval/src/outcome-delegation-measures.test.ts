import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { IDelegationReport } from './outcome-coding-protocol.js';
import type { IRelayLogEntry } from './outcome-coding-relay.js';
import { idleBetweenJobs, measureTrial, overlappingJobs } from './outcome-delegation-measures.js';

function entry(patch: Partial<IRelayLogEntry> & { id: number }): IRelayLogEntry {
  return {
    outcome: 'forwarded',
    status: 200,
    requestBytes: 100,
    upstreamAttempts: 1,
    latencyMs: 10,
    promptTokens: 100,
    completionTokens: 10,
    ...patch,
  };
}

const report: IDelegationReport = {
  jobsStarted: 3,
  jobsRefused: 1,
  jobs: [
    { agent: 'implementer', startMs: 100, endMs: 400 },
    { agent: 'reviewer', startMs: 450, endMs: 600 },
    { agent: 'implementer', startMs: 650, endMs: null },
  ],
};

test('the idle time between child jobs sums the gaps from one end to the next start', () => {
  assert.equal(idleBetweenJobs(report), 50 + 50);
  assert.equal(idleBetweenJobs(undefined), null);
  assert.equal(idleBetweenJobs({ jobsStarted: 1, jobsRefused: 0, jobs: [] }), 0);
  // A job that never ended leaves no measurable gap after it.
  assert.equal(
    idleBetweenJobs({
      jobsStarted: 2,
      jobsRefused: 0,
      jobs: [
        { agent: 'implementer', startMs: 0, endMs: null },
        { agent: 'reviewer', startMs: 90, endMs: 100 },
      ],
    }),
    0,
  );
});

test('measures are kept by role, count failed attempts and unknown tokens, and add up the coordination share', () => {
  const log: IRelayLogEntry[] = [
    entry({ id: 1, role: 'parent', latencyMs: 20, promptTokens: 200, completionTokens: 20 }),
    entry({ id: 2, role: 'implementer', latencyMs: 100, promptTokens: 500, completionTokens: 80 }),
    entry({
      id: 3,
      role: 'implementer',
      outcome: 'upstream-failed',
      status: 502,
      latencyMs: 60,
      promptTokens: undefined,
      completionTokens: undefined,
    }),
    entry({
      id: 4,
      role: 'implementer',
      status: 503,
      latencyMs: 30,
      promptTokens: 40,
      completionTokens: 0,
    }),
    entry({ id: 5, role: 'reviewer', latencyMs: 50, promptTokens: 300, completionTokens: 30 }),
    entry({ id: 6, role: 'parent', latencyMs: 25, promptTokens: 400, completionTokens: 15 }),
    entry({ id: 7, role: 'parent', outcome: 'refused', status: 403, upstreamAttempts: 0 }),
  ];
  const measures = measureTrial(log, report, 2_000);
  assert.equal(measures.byRole.parent?.calls, 2);
  assert.equal(measures.byRole.parent?.refusedCalls, 1);
  assert.deepEqual(
    {
      calls: measures.byRole.implementer?.calls,
      failed: measures.byRole.implementer?.failedCalls,
      unknown: measures.byRole.implementer?.tokenUnknownCalls,
      prompt: measures.byRole.implementer?.promptTokens,
      completion: measures.byRole.implementer?.completionTokens,
      latency: measures.byRole.implementer?.latencyMs,
    },
    // The failed attempt with a reported usage counts its tokens; the one with none is unknown.
    { calls: 3, failed: 2, unknown: 1, prompt: 540, completion: 80, latency: 190 },
  );
  assert.deepEqual(measures.coordination, {
    roles: ['parent', 'reviewer'],
    calls: 3,
    promptTokens: 900,
    completionTokens: 65,
    latencyMs: 95,
    idleBetweenJobsMs: 100,
  });
  assert.equal(measures.total.calls, 6);
  assert.equal(measures.total.refusedCalls, 1);
  assert.equal(measures.childJobsStarted, 3);
  assert.equal(measures.childJobsRefused, 1);
  assert.equal(measures.wallMs, 2_000);
});

test('a single-agent trial reports its calls under one role and no coordination or idle time', () => {
  const measures = measureTrial(
    [entry({ id: 1, role: 'agent' }), entry({ id: 2, role: 'agent' })],
    undefined,
    500,
  );
  assert.equal(measures.byRole.agent?.calls, 2);
  assert.equal(measures.coordination.calls, 0);
  assert.equal(measures.coordination.idleBetweenJobsMs, null);
  assert.equal(measures.childJobsStarted, null);
});

test('overlapping child jobs are recorded as pairs, and a serial trial has none', () => {
  assert.equal(overlappingJobs(undefined), null);
  assert.deepEqual(overlappingJobs(report), { count: 0, pairs: [] });
  const overlapped: IDelegationReport = {
    jobsStarted: 3,
    jobsRefused: 0,
    jobs: [
      { agent: 'implementer', startMs: 0, endMs: 500 },
      { agent: 'reviewer', startMs: 200, endMs: 300 },
      // Still running when the report was taken, so it overlaps nothing that starts after it.
      { agent: 'implementer', startMs: 600, endMs: null },
    ],
  };
  assert.deepEqual(overlappingJobs(overlapped), { count: 1, pairs: [{ first: 0, second: 1 }] });
  // Touching windows are serial, and idle time still counts an overlap as zero.
  assert.equal(
    overlappingJobs({
      jobsStarted: 2,
      jobsRefused: 0,
      jobs: [
        { agent: 'implementer', startMs: 0, endMs: 100 },
        { agent: 'reviewer', startMs: 100, endMs: 150 },
      ],
    })?.count,
    0,
  );
  assert.equal(measureTrial([], overlapped, 1).childJobOverlap?.count, 1);
});
