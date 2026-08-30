// harness-coverage: work-run-report-files.mjs
// harness-coverage: work-run-report-github-client.mjs
// harness-coverage: work-run-report-github.mjs
// harness-coverage: work-run-report-github-evidence.mjs
// harness-coverage: work-run-report-metrics.mjs
import {
  appendFileSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createGitHubLookupBudget,
  joinPullRequest,
  main,
  percentile,
  queryGitHubPullRequest,
  queryGitHubPullRequests,
  reportWorkRuns,
  readLocalWorkRunTerminals,
  readWorkRunReceipts,
} from '../work-run-report.mjs';
import {
  appendWorkRunEvent,
  cohortKey,
  createInitialWorkRun,
  projectWorkRunDurations,
  reduceWorkRun,
} from '../work-run-contract.mjs';
import { makeTemp } from './make-temp.mjs';

const observabilityCohort = {
  key: 'L2/observability',
  lane: 'L2',
  workKind: 'observability',
};

const receiptIdentity = {
  repository: 'woojubb/robota',
  branch: 'codex/work',
  baseCommit: 'b'.repeat(40),
  headCommit: 'a'.repeat(40),
  headTree: 'c'.repeat(40),
  commitOids: ['a'.repeat(40)],
  trailerDigest: 'd'.repeat(64),
  ownerFingerprint: 'e'.repeat(64),
};

function includedReceipt({
  runId = 'run-1',
  wallMs = 10,
  lane = 'L2',
  workKind = 'observability',
  identity = receiptIdentity,
} = {}) {
  let run = createInitialWorkRun({
    runId,
    branch: 'codex/work',
    at: '2026-08-30T00:00:00.000Z',
  });
  run = appendWorkRunEvent(run, {
    type: 'work.bound',
    at: '2026-08-30T00:00:00.001Z',
    data: { workId: 'OBSERVABILITY-002', lane, workKind },
  });
  run = appendWorkRunEvent(run, {
    type: 'work.started',
    at: '2026-08-30T00:00:00.002Z',
    data: {},
  });
  run = appendWorkRunEvent(run, {
    type: 'work.ready',
    at: new Date(Date.parse('2026-08-30T00:00:00.000Z') + wallMs).toISOString(),
    data: { generation: 0, revision: 0 },
  });
  const state = reduceWorkRun(run.events);
  return {
    schemaVersion: 1,
    disposition: 'included',
    runId,
    generation: 0,
    revision: 0,
    identity,
    cohort: { key: cohortKey(state), lane: state.lane, workKind: state.workKind },
    events: run.events,
    durations: projectWorkRunDurations(run.events),
    timestamps: { claimedAt: run.events[0].at, readyAt: run.events.at(-1).at },
  };
}

function excludedReceipt({ runId = 'excluded', reason = 'pure-planning-range' } = {}) {
  let run = createInitialWorkRun({
    runId,
    branch: 'codex/work',
    at: '2026-08-30T00:00:00.000Z',
  });
  run = appendWorkRunEvent(run, {
    type: 'work.bound',
    at: '2026-08-30T00:00:00.001Z',
    data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
  });
  run = appendWorkRunEvent(run, {
    type: 'work.excluded',
    at: '2026-08-30T00:00:00.010Z',
    data: { reason },
  });
  const state = reduceWorkRun(run.events);
  return {
    schemaVersion: 1,
    disposition: 'excluded',
    reason,
    runId,
    generation: 0,
    revision: 0,
    identity: receiptIdentity,
    cohort: { key: cohortKey(state), lane: state.lane, workKind: state.workKind },
    events: run.events,
    durations: projectWorkRunDurations(run.events),
    timestamps: { claimedAt: run.events[0].at, excludedAt: run.events.at(-1).at },
  };
}

function unboundExcludedReceipt({
  runId = 'unbound-excluded',
  reason = 'pure-planning-range',
} = {}) {
  let run = createInitialWorkRun({
    runId,
    branch: 'codex/work',
    at: '2026-08-30T00:00:00.000Z',
  });
  run = appendWorkRunEvent(run, {
    type: 'work.excluded',
    at: '2026-08-30T00:00:00.010Z',
    data: { reason },
  });
  return {
    schemaVersion: 1,
    disposition: 'excluded',
    reason,
    runId,
    generation: 0,
    revision: 0,
    identity: receiptIdentity,
    cohort: null,
    events: run.events,
    durations: projectWorkRunDurations(run.events),
    timestamps: { claimedAt: run.events[0].at, excludedAt: run.events.at(-1).at },
  };
}

function stateLostReceipt(runId = 'state-lost') {
  return {
    schemaVersion: 1,
    disposition: 'invalid',
    reason: 'state-lost',
    runId,
    generation: 0,
    revision: 0,
    identity: receiptIdentity,
    timestamps: { claimedAt: null, readyAt: null },
  };
}

function postPrReceipt({ runId = 'rework', wallMs = 5, ground = 'red-check' } = {}) {
  let run = createInitialWorkRun({
    runId,
    branch: 'codex/work',
    at: '2026-08-30T00:00:00.000Z',
  });
  run = appendWorkRunEvent(run, {
    type: 'work.bound',
    at: '2026-08-30T00:00:00.001Z',
    data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
  });
  run = appendWorkRunEvent(run, {
    type: 'work.started',
    at: '2026-08-30T00:00:00.002Z',
    data: {},
  });
  run = appendWorkRunEvent(run, {
    type: 'work.ready',
    at: '2026-08-30T00:00:00.010Z',
    data: { generation: 0, revision: 0 },
  });
  const authorization = {
    approvedBy: '@woojubb',
    action: 'push',
    commentAuthor: 'woojubb',
    commentAuthorAssociation: 'OWNER',
    commentId: 1,
    commentUrl: 'https://github.com/woojubb/robota/pull/1#issuecomment-1',
    evidence: 'https://github.com/woojubb/robota/actions/runs/1',
    ground,
    head: 'a'.repeat(40),
    prNumber: 1,
    scope: 'scripts/harness/work-run-report.mjs',
    verdict: 1,
  };
  run = appendWorkRunEvent(run, {
    type: 'work.reopened',
    at: '2026-08-30T00:00:00.100Z',
    data: { generation: 1, revision: 0, ground, authorization },
  });
  run = appendWorkRunEvent(run, {
    type: 'work.ready',
    at: new Date(Date.parse('2026-08-30T00:00:00.100Z') + wallMs).toISOString(),
    data: { generation: 1, revision: 0 },
  });
  const state = reduceWorkRun(run.events);
  return {
    schemaVersion: 1,
    disposition: 'included',
    runId,
    generation: 1,
    revision: 0,
    identity: receiptIdentity,
    cohort: { key: cohortKey(state), lane: state.lane, workKind: state.workKind },
    events: run.events,
    durations: projectWorkRunDurations(run.events),
    timestamps: { claimedAt: run.events[0].at, readyAt: run.events.at(-1).at },
    ground,
    authorization,
  };
}

describe('work-run report', () => {
  it('rejects fabricated duration and cohort projections instead of polluting metrics', () => {
    const valid = includedReceipt({ runId: 'valid', wallMs: 20 });
    const fabricatedDuration = {
      ...includedReceipt({ runId: 'duration', wallMs: 30 }),
      durations: { wallMs: 1, activeMs: 1, pausedMs: 0, phases: {} },
    };
    const fabricatedCohort = {
      ...includedReceipt({ runId: 'cohort', wallMs: 40 }),
      cohort: { key: 'L0/fake', lane: 'L0', workKind: 'fake' },
    };

    const report = reportWorkRuns([valid, fabricatedDuration, fabricatedCohort]);

    expect(report.populations).toMatchObject({ included: 1, invalid: 2 });
    expect(report.metrics.wallMs).toEqual({ p50: 20, p90: 20 });
    expect(report.invalidReasons).toEqual({ 'malformed-receipt': 2 });
  });

  it('reads malformed, oversize, and unreadable tracked receipts independently', () => {
    const root = makeTemp('work-run-report-bad-files-');
    const receiptRoot = path.join(root, '.agents/evals/work-runs');
    const writeReceipt = (runId, text) => {
      const directory = path.join(receiptRoot, runId);
      mkdirSync(directory, { recursive: true });
      const file = path.join(directory, 'g0-r0.json');
      writeFileSync(file, text);
      return file;
    };
    writeReceipt('valid', `${JSON.stringify(includedReceipt({ runId: 'valid' }))}\n`);
    writeReceipt('malformed', '{');
    writeReceipt('oversize', JSON.stringify({ padding: 'x'.repeat(10_000) }));
    const unreadable = writeReceipt('unreadable', '{}');

    const readFiles = [];
    const receipts = readWorkRunReceipts(root, {
      maxBytes: 5_000,
      openFile: (file, flags) => {
        readFiles.push(file);
        if (file === unreadable) throw new Error('EACCES');
        return openSync(file, flags);
      },
    });
    const report = reportWorkRuns(receipts);

    expect(report.populations).toMatchObject({ included: 1, invalid: 1, unavailable: 2 });
    expect(report.invalidReasons).toEqual({ 'malformed-json': 1 });
    expect(report.unavailableReasons).toEqual({
      'oversize-receipt': 1,
      'unreadable-receipt': 1,
    });
    expect(readFiles).toHaveLength(4);
  });

  it('rejects oversize local state before invoking the full-file reader', () => {
    const root = makeTemp('work-run-report-large-local-state-');
    const directory = path.join(root, '.agents/evals/local-metrics/work-runs');
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'oversize.json');
    writeFileSync(file, JSON.stringify({ padding: 'x'.repeat(10_000) }));
    const readChunk = vi.fn(readSync);

    expect(readLocalWorkRunTerminals(root, { maxBytes: 100, readChunk })).toEqual([
      expect.objectContaining({
        disposition: 'unavailable',
        reason: 'oversize-local-state',
      }),
    ]);
    expect(readChunk).not.toHaveBeenCalled();
  });

  it('opens report inputs nonblocking and sizes each read buffer from the inspected file', () => {
    const root = makeTemp('work-run-report-bounded-allocation-');
    const directory = path.join(root, '.agents/evals/work-runs/run-1');
    mkdirSync(directory, { recursive: true });
    const text = `${JSON.stringify(includedReceipt())}\n`;
    writeFileSync(path.join(directory, 'g0-r0.json'), text);
    const openedFlags = [];
    const readChunk = vi.fn(readSync);

    expect(
      readWorkRunReceipts(root, {
        maxBytes: 1024 * 1024,
        openFile: (file, flags) => {
          openedFlags.push(flags);
          return openSync(file, flags);
        },
        readChunk,
      }),
    ).toEqual([expect.objectContaining({ disposition: 'included', runId: 'run-1' })]);
    expect(openedFlags).toHaveLength(1);
    expect(openedFlags[0] & constants.O_NONBLOCK).toBe(constants.O_NONBLOCK);
    expect(Math.max(...readChunk.mock.calls.map((call) => call[3]))).toBeLessThanOrEqual(
      Buffer.byteLength(text) + 1,
    );
  });

  it('stops before reading when the aggregate receipt byte budget is exhausted', () => {
    const root = makeTemp('work-run-report-total-budget-');
    const directory = path.join(root, '.agents/evals/work-runs/run-1');
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'g0-r0.json'), '{"schemaVersion":1}\n');
    const readChunk = vi.fn(readSync);

    expect(readWorkRunReceipts(root, { maxBytes: 1_000, maxTotalBytes: 1, readChunk })).toEqual([
      expect.objectContaining({
        disposition: 'unavailable',
        reason: 'receipt-total-byte-budget-exceeded',
      }),
    ]);
    expect(readChunk).not.toHaveBeenCalled();
  });

  it('bounds a receipt read when the file grows after its descriptor is inspected', () => {
    const root = makeTemp('work-run-report-growing-receipt-');
    const directory = path.join(root, '.agents/evals/work-runs/run-1');
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'g0-r0.json');
    const initial = `${JSON.stringify(includedReceipt())}\n`;
    writeFileSync(file, initial);
    const maxBytes = Buffer.byteLength(initial) + 8;
    const readChunk = vi.fn(readSync);

    expect(
      readWorkRunReceipts(root, {
        maxBytes,
        afterInitialStat: (openedFile) => {
          if (openedFile === file) appendFileSync(file, 'x'.repeat(10_000));
        },
        readChunk,
      }),
    ).toEqual([
      expect.objectContaining({
        disposition: 'unavailable',
        reason: 'oversize-receipt',
      }),
    ]);
    expect(Math.max(...readChunk.mock.calls.map((call) => call[3]))).toBeLessThanOrEqual(
      maxBytes + 1,
    );
  });

  it('bounds a growing receipt by the remaining aggregate byte budget', () => {
    const root = makeTemp('work-run-report-growing-total-');
    const receiptRoot = path.join(root, '.agents/evals/work-runs');
    const writeReceipt = (runId) => {
      const directory = path.join(receiptRoot, runId);
      mkdirSync(directory, { recursive: true });
      const file = path.join(directory, 'g0-r0.json');
      const text = `${JSON.stringify(includedReceipt({ runId }))}\n`;
      writeFileSync(file, text);
      return { file, bytes: Buffer.byteLength(text) };
    };
    const first = writeReceipt('run-a');
    const second = writeReceipt('run-b');
    const growthAllowance = 8;
    const maxTotalBytes = first.bytes + second.bytes + growthAllowance;
    let currentFile;
    const readLengths = [];
    const readChunk = (...args) => {
      readLengths.push({ file: currentFile, length: args[3] });
      return readSync(...args);
    };

    const receipts = readWorkRunReceipts(root, {
      maxBytes: 100_000,
      maxTotalBytes,
      afterInitialStat: (openedFile) => {
        currentFile = openedFile;
        if (openedFile === second.file) appendFileSync(second.file, 'x'.repeat(10_000));
      },
      readChunk,
    });

    expect(receipts).toEqual([
      expect.objectContaining({ disposition: 'included', runId: 'run-a' }),
      expect.objectContaining({
        disposition: 'unavailable',
        reason: 'receipt-total-byte-budget-exceeded',
      }),
    ]);
    const secondReadLengths = readLengths
      .filter((entry) => entry.file === second.file)
      .map((entry) => entry.length);
    expect(Math.max(...secondReadLengths)).toBeLessThanOrEqual(second.bytes + growthAllowance + 1);
  });

  it('reports receipt traversal depth exhaustion without reading the deeper file', () => {
    const root = makeTemp('work-run-report-depth-budget-');
    const directory = path.join(root, '.agents/evals/work-runs/run-1/too-deep');
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'g0-r0.json');
    writeFileSync(file, `${JSON.stringify(includedReceipt())}\n`);
    const readChunk = vi.fn(readSync);

    expect(readWorkRunReceipts(root, { maxDepth: 1, readChunk })).toEqual([
      expect.objectContaining({
        disposition: 'unavailable',
        reason: 'receipt-depth-exceeded',
      }),
    ]);
    expect(readChunk).not.toHaveBeenCalled();
  });

  it('reports distinct receipt and local-state entry-budget exhaustion', () => {
    const root = makeTemp('work-run-report-entry-budget-');
    const receiptDirectory = path.join(root, '.agents/evals/work-runs');
    const localDirectory = path.join(root, '.agents/evals/local-metrics/work-runs');
    mkdirSync(receiptDirectory, { recursive: true });
    mkdirSync(localDirectory, { recursive: true });
    for (const directory of [receiptDirectory, localDirectory]) {
      writeFileSync(path.join(directory, 'first.txt'), 'ignored');
      writeFileSync(path.join(directory, 'second.txt'), 'ignored');
    }

    expect(readWorkRunReceipts(root, { maxEntries: 1 })).toEqual([
      expect.objectContaining({
        disposition: 'unavailable',
        reason: 'receipt-entry-count-exceeded',
      }),
    ]);
    expect(readLocalWorkRunTerminals(root, { maxEntries: 1 })).toEqual([
      expect.objectContaining({
        disposition: 'unavailable',
        reason: 'local-state-entry-count-exceeded',
      }),
    ]);
  });

  it('projects abandoned state into an explicit local-only report population', () => {
    const root = makeTemp('work-run-report-abandoned-');
    const directory = path.join(root, '.agents/evals/local-metrics/work-runs');
    mkdirSync(directory, { recursive: true });
    let run = createInitialWorkRun({
      runId: 'abandoned-run',
      branch: 'codex/work',
      at: '2026-08-30T00:00:00.000Z',
    });
    run = appendWorkRunEvent(run, {
      type: 'work.bound',
      at: '2026-08-30T00:00:00.100Z',
      data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
    });
    run = appendWorkRunEvent(run, {
      type: 'work.abandoned',
      at: '2026-08-30T00:00:00.500Z',
      data: { reason: 'superseded' },
    });
    writeFileSync(path.join(directory, `${run.runId}.json`), `${JSON.stringify(run)}\n`);

    const terminals = readLocalWorkRunTerminals(root);
    const report = reportWorkRuns(terminals);

    expect(terminals).toEqual([
      expect.objectContaining({
        disposition: 'abandoned',
        source: 'local-state',
        runId: 'abandoned-run',
        reason: 'superseded',
      }),
    ]);
    expect(report.populations).toMatchObject({ abandoned: 1, included: 0 });
    expect(report.abandonedRuns).toEqual(terminals);
    expect(report.abandonedMetrics.wallMs).toEqual({ p50: 500, p90: 500 });
    expect(readWorkRunReceipts(root).some((receipt) => receipt.disposition === 'abandoned')).toBe(
      false,
    );
  });

  it('rejects copied, nested, and event-mismatched local terminal states', () => {
    const root = makeTemp('work-run-report-local-correlation-');
    const directory = path.join(root, '.agents/evals/local-metrics/work-runs');
    mkdirSync(path.join(directory, 'nested'), { recursive: true });
    let run = createInitialWorkRun({
      runId: 'abandoned-run',
      branch: 'codex/work',
      at: '2026-08-30T00:00:00.000Z',
    });
    run = appendWorkRunEvent(run, {
      type: 'work.abandoned',
      at: '2026-08-30T00:00:01.000Z',
      data: { reason: 'superseded' },
    });
    const text = `${JSON.stringify(run)}\n`;
    writeFileSync(path.join(directory, 'abandoned-run.json'), text);
    writeFileSync(path.join(directory, 'copied-run.json'), text);
    writeFileSync(path.join(directory, 'nested', 'abandoned-run.json'), text);
    writeFileSync(
      path.join(directory, 'forged-run.json'),
      `${JSON.stringify({ ...run, runId: 'forged-run' })}\n`,
    );

    const terminals = readLocalWorkRunTerminals(root);

    expect(terminals.filter((entry) => entry.disposition === 'abandoned')).toEqual([
      expect.objectContaining({ runId: 'abandoned-run' }),
    ]);
    expect(
      terminals.filter(
        (entry) => entry.disposition === 'invalid' && entry.reason === 'malformed-local-state',
      ),
    ).toHaveLength(3);
  });

  it('computes exact nearest-rank p50/p90 and explicit populations', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 90)).toBe(5);
    const report = reportWorkRuns([
      includedReceipt({ runId: 'a', wallMs: 10 }),
      includedReceipt({ runId: 'b', wallMs: 20 }),
      excludedReceipt({ runId: 'c' }),
      stateLostReceipt('d'),
    ]);
    expect(report.populations).toEqual({
      included: 2,
      superseded: 0,
      excluded: 1,
      invalid: 1,
      abandoned: 0,
      unavailable: 0,
    });
    expect(report.metrics.wallMs).toEqual({ p50: 10, p90: 20 });
  });

  it('joins first PR when the ready head starts the proven PR-head commit range', () => {
    const receipt = {
      runId: 'run-1',
      identity: { repository: 'woojubb/robota', headCommit: 'abc' },
    };
    const pr = {
      repository: 'woojubb/robota',
      number: 9,
      body: 'Work-Run: run-1',
      headOid: 'closure',
      createdAt: '2026-08-30T01:00:00Z',
      headRange: {
        startOid: 'abc',
        endOid: 'closure',
        startIsAncestor: true,
        commitRunIds: ['run-1'],
      },
      openingHeadEvidence: { ok: true, headOid: 'closure' },
    };
    const query = {
      ok: true,
      repository: 'woojubb/robota',
      prNumber: 9,
      pullRequests: [pr],
    };
    expect(joinPullRequest(receipt, query)).toEqual({
      ok: true,
      prNumber: 9,
      createdAt: pr.createdAt,
    });
  });

  it('rejects zero, multiple, query-failed, and mismatched first-PR joins distinctly', () => {
    const receipt = {
      runId: 'run-1',
      identity: { repository: 'woojubb/robota', headCommit: 'ready' },
    };
    const pr = {
      repository: 'woojubb/robota',
      number: 9,
      body: 'Work-Run: run-1',
      headOid: 'closure',
      createdAt: '2026-08-30T01:00:00Z',
      headRange: {
        startOid: 'ready',
        endOid: 'closure',
        startIsAncestor: true,
        commitRunIds: ['run-1'],
      },
      openingHeadEvidence: { ok: true, headOid: 'closure' },
    };
    const query = {
      ok: true,
      repository: 'woojubb/robota',
      prNumber: 9,
      pullRequests: [pr],
    };

    expect(joinPullRequest(receipt, { ...query, pullRequests: [] }).reason).toBe('no-pr-match');
    expect(joinPullRequest(receipt, { ...query, pullRequests: [pr, { ...pr }] }).reason).toBe(
      'multiple-pr-matches',
    );
    expect(joinPullRequest(receipt, { ok: false, reason: 'timeout' }).reason).toBe('timeout');

    const mismatches = [
      { ...pr, repository: 'other/repo' },
      { ...pr, number: 10 },
      { ...pr, body: 'Work-Run: other-run' },
      { ...pr, body: 'Work-Run: run-1\nLater prose' },
      { ...pr, body: 'Work-Run: run-1\nWork-Run: run-1' },
      { ...pr, headOid: 'other-head' },
      { ...pr, headRange: { ...pr.headRange, startOid: 'other-ready' } },
      { ...pr, headRange: { ...pr.headRange, endOid: 'other-head' } },
      { ...pr, headRange: { ...pr.headRange, startIsAncestor: false } },
      { ...pr, headRange: { ...pr.headRange, commitRunIds: ['other-run'] } },
    ];
    for (const mismatch of mismatches) {
      expect(joinPullRequest(receipt, { ...query, pullRequests: [mismatch] }).reason).toBe(
        'pr-identity-mismatch',
      );
    }
  });

  it('does not join a PR whose immutable opening-head seal was not proven', () => {
    const receipt = {
      runId: 'run-1',
      identity: { repository: 'woojubb/robota', headCommit: 'ready' },
    };
    const pr = {
      repository: 'woojubb/robota',
      number: 9,
      body: 'Work-Run: run-1',
      headOid: 'closure',
      createdAt: '2026-08-30T01:00:00Z',
      headRange: {
        startOid: 'ready',
        endOid: 'closure',
        startIsAncestor: true,
        commitRunIds: ['run-1'],
      },
      openingHeadEvidence: { ok: false, reason: 'opening-head-comment-missing' },
    };

    expect(
      joinPullRequest(receipt, {
        ok: true,
        repository: 'woojubb/robota',
        prNumber: 9,
        pullRequests: [pr],
      }),
    ).toEqual({ ok: false, reason: 'opening-head-comment-missing' });
  });

  it('keeps first-PR metrics unavailable for missing, deleted, edited, or late seals', () => {
    const receipt = includedReceipt({ runId: 'run-1' });
    const reasons = [
      'opening-head-comment-missing',
      'opening-head-comment-deleted',
      'opening-head-comment-edited',
      'opening-head-comment-late',
    ];
    for (const reason of reasons) {
      const report = reportWorkRuns([receipt], {
        queryPullRequest: () => ({
          ok: true,
          repository: 'woojubb/robota',
          prNumber: 9,
          pullRequests: [
            {
              repository: 'woojubb/robota',
              number: 9,
              body: 'Work-Run: run-1',
              headOid: 'closure',
              createdAt: '2026-08-30T01:00:00Z',
              headRange: {
                startOid: receiptIdentity.headCommit,
                endOid: 'closure',
                startIsAncestor: true,
                commitRunIds: ['run-1'],
              },
              openingHeadEvidence: { ok: false, reason },
            },
          ],
        }),
      });
      expect(report.firstPrRuns).toEqual([]);
      expect(report.metrics.timeToFirstPrMs).toEqual({ p50: null, p90: null });
      expect(report.unavailableReasons).toEqual({ [reason]: 1 });
    }
  });

  it('keeps post-PR rework separate from the first-PR boundary', () => {
    const report = reportWorkRuns(
      [includedReceipt({ runId: 'a', wallMs: 10 }), postPrReceipt({ runId: 'a', wallMs: 5 })],
      {
        queryPullRequest: () => ({
          ok: true,
          repository: 'woojubb/robota',
          prNumber: 9,
          pullRequests: [
            {
              repository: 'woojubb/robota',
              number: 9,
              body: 'Work-Run: a',
              headOid: 'closure',
              createdAt: '2026-08-30T01:00:00Z',
              headRange: {
                startOid: receiptIdentity.headCommit,
                endOid: 'closure',
                startIsAncestor: true,
                commitRunIds: ['a'],
              },
              openingHeadEvidence: { ok: true, headOid: 'closure' },
            },
          ],
        }),
      },
    );
    expect(report.firstPrRuns).toHaveLength(1);
    expect(report.reworkByGround).toEqual({ 'red-check': { count: 1, wallMs: 5 } });
  });

  it('aggregates included measurements by the receipt-owned cohort without inventing one', () => {
    const malformedCohort = {
      ...includedReceipt({ runId: 'b', wallMs: 20 }),
      cohort: undefined,
    };
    const report = reportWorkRuns([
      includedReceipt({ runId: 'a', wallMs: 10 }),
      postPrReceipt({ runId: 'a', wallMs: 4 }),
      malformedCohort,
    ]);

    expect(report.cohorts).toEqual({
      'L2/observability': {
        cohort: { key: 'L2/observability', lane: 'L2', workKind: 'observability' },
        populations: { included: 2, firstPr: 1, rework: 1 },
        metrics: {
          wallMs: { p50: 10, p90: 10 },
          activeMs: { p50: 10, p90: 10 },
          pausedMs: { p50: 0, p90: 0 },
          timeToFirstPrMs: { p50: null, p90: null },
          phases: {},
        },
        reworkByGround: { 'red-check': { count: 1, wallMs: 4 } },
      },
    });
    expect(report.populations.invalid).toBe(1);
    expect(report.invalidReasons).toEqual({ 'malformed-receipt': 1 });
  });

  it('keeps a valid unbound exclusion out of invalid and unavailable populations', () => {
    const report = reportWorkRuns([unboundExcludedReceipt()]);

    expect(report.populations).toMatchObject({
      included: 0,
      excluded: 1,
      invalid: 0,
      unavailable: 0,
    });
    expect(report.invalidReasons).toEqual({});
    expect(report.unavailableReasons).toEqual({});
  });

  it('uses a bounded, completely paginated GitHub adapter to prove the ready-to-PR-head range', () => {
    const calls = [];
    const responses = [
      [
        {
          total_count: 1,
          incomplete_results: false,
          items: [{ number: 9 }],
        },
      ],
      {
        number: 9,
        body: 'Measurement\n\nWork-Run: run-1',
        created_at: '2026-08-30T01:00:00Z',
        head: { sha: 'closure' },
        base: { repo: { full_name: 'woojubb/robota' } },
      },
      [
        [
          { sha: 'ready', commit: { message: 'feat: measured\n\nWork-Run: run-1' } },
          { sha: 'closure', commit: { message: 'chore: close\n\nWork-Run: run-1' } },
        ],
      ],
    ];
    const runGh = vi.fn((command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: JSON.stringify(responses.shift()), stderr: '' };
    });
    const receipt = {
      runId: 'run-1',
      identity: { repository: 'woojubb/robota', headCommit: 'ready' },
    };

    expect(
      queryGitHubPullRequest(receipt, {
        runGh,
        timeoutMs: 3210,
        queryOpeningHeadEvidence: () => ({ ok: false, reason: 'not-under-test' }),
      }),
    ).toEqual({
      ok: true,
      repository: 'woojubb/robota',
      prNumber: 9,
      pullRequests: [
        expect.objectContaining({
          number: 9,
          headOid: 'closure',
          headRange: {
            startOid: 'ready',
            endOid: 'closure',
            startIsAncestor: true,
            commitRunIds: ['run-1'],
          },
        }),
      ],
    });
    expect(calls).toHaveLength(3);
    expect(calls[0].args).toEqual(expect.arrayContaining(['--paginate', '--slurp']));
    expect(calls[2].args).toEqual(expect.arrayContaining(['--paginate', '--slurp']));
    expect(calls.every((call) => call.options.timeout > 0 && call.options.timeout <= 3210)).toBe(
      true,
    );
    expect(calls.every((call) => Number.isFinite(call.options.maxBuffer))).toBe(true);
  });

  it('recovers the sealed opening head from force-push ancestry for first-PR metrics', () => {
    const openingHead = '1'.repeat(40);
    const openingParent = '0'.repeat(40);
    const currentReady = '2'.repeat(40);
    const currentHead = '3'.repeat(40);
    const runGh = vi.fn((_command, args) => {
      const endpoint = args.at(-1);
      if (args.includes('/search/issues')) {
        return {
          status: 0,
          stdout: JSON.stringify([
            { total_count: 1, incomplete_results: false, items: [{ number: 9 }] },
          ]),
          stderr: '',
        };
      }
      if (args.includes('graphql')) {
        return {
          status: 0,
          stdout: JSON.stringify({
            data: {
              repository: {
                pullRequest: {
                  timelineItems: {
                    nodes: [
                      {
                        __typename: 'HeadRefForcePushedEvent',
                        createdAt: '2026-08-30T00:30:00Z',
                        beforeCommit: { oid: openingHead },
                        afterCommit: { oid: currentReady },
                      },
                      {
                        __typename: 'PullRequestCommit',
                        commit: {
                          oid: currentReady,
                          message: 'feat: rebased\n\nWork-Run: run-1\nWork-Receipt: g1-r0',
                          parents: { totalCount: 1, nodes: [{ oid: openingParent }] },
                        },
                      },
                      {
                        __typename: 'PullRequestCommit',
                        commit: {
                          oid: currentHead,
                          message: 'chore: close rebase\n\nWork-Run: run-1\nWork-Receipt: g1-r0',
                          parents: { totalCount: 1, nodes: [{ oid: currentReady }] },
                        },
                      },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          }),
          stderr: '',
        };
      }
      if (endpoint === `/repos/woojubb/robota/commits/${openingHead}`) {
        return {
          status: 0,
          stdout: JSON.stringify({
            sha: openingHead,
            commit: {
              message: 'chore: close initial\n\nWork-Run: run-1\nWork-Receipt: g0-r0',
            },
            parents: [{ sha: openingParent }],
          }),
          stderr: '',
        };
      }
      if (endpoint.includes(`/commits/${openingHead}/comments?`)) {
        return {
          status: 0,
          stdout: JSON.stringify([
            [
              {
                id: 11,
                commit_id: openingHead,
                body: `Work-Run-Opening-Head: v1\nWork-Run: run-1\nHead-Oid: ${openingHead}`,
                created_at: '2026-08-30T00:59:59Z',
                updated_at: '2026-08-30T00:59:59Z',
              },
            ],
          ]),
          stderr: '',
        };
      }
      if (args.some((arg) => arg.startsWith('/repos/woojubb/robota/pulls/9/commits?'))) {
        return {
          status: 0,
          stdout: JSON.stringify([
            [
              {
                sha: currentReady,
                commit: {
                  message: 'feat: rebased\n\nWork-Run: run-1\nWork-Receipt: g1-r0',
                },
              },
              {
                sha: currentHead,
                commit: {
                  message: 'chore: close rebase\n\nWork-Run: run-1\nWork-Receipt: g1-r0',
                },
              },
            ],
          ]),
          stderr: '',
        };
      }
      if (endpoint === '/repos/woojubb/robota/pulls/9') {
        return {
          status: 0,
          stdout: JSON.stringify({
            number: 9,
            body: 'Measured change\n\nWork-Run: run-1',
            created_at: '2026-08-30T01:00:00Z',
            head: { sha: currentHead },
            base: { repo: { full_name: 'woojubb/robota' } },
          }),
          stderr: '',
        };
      }
      throw new Error(`unexpected GitHub call: ${args.join(' ')}`);
    });
    const receipt = {
      runId: 'run-1',
      identity: { repository: 'woojubb/robota', headCommit: currentReady },
    };

    const result = queryGitHubPullRequest(receipt, { runGh });

    expect(joinPullRequest(receipt, result)).toEqual({
      ok: true,
      prNumber: 9,
      createdAt: '2026-08-30T01:00:00Z',
    });
    expect(result.pullRequests[0].openingHeadEvidence).toEqual({
      ok: true,
      headOid: openingHead,
    });
  });

  it('batches root receipt searches and reuses candidate and commit lookups', () => {
    const calls = [];
    const responses = [
      [
        {
          total_count: 1,
          incomplete_results: false,
          items: [{ number: 9 }],
        },
      ],
      {
        number: 9,
        body: 'Work-Run: run-1',
        created_at: '2026-08-30T01:00:00Z',
        head: { sha: 'closure' },
        base: { repo: { full_name: 'woojubb/robota' } },
      },
      [
        [
          { sha: 'ready-1', commit: { message: 'feat: first\n\nWork-Run: run-1' } },
          { sha: 'ready-2', commit: { message: 'feat: second\n\nWork-Run: run-2' } },
          { sha: 'closure', commit: { message: 'chore: close' } },
        ],
      ],
    ];
    const runGh = vi.fn((command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: JSON.stringify(responses.shift()), stderr: '' };
    });
    const receipts = [
      { runId: 'run-1', identity: { repository: 'woojubb/robota', headCommit: 'ready-1' } },
      { runId: 'run-2', identity: { repository: 'woojubb/robota', headCommit: 'ready-2' } },
    ];

    const results = queryGitHubPullRequests(receipts, {
      runGh,
      timeoutMs: 3210,
      queryOpeningHeadEvidence: () => ({ ok: true, headOid: 'closure' }),
    });

    expect(results).toHaveLength(2);
    expect(joinPullRequest(receipts[0], results[0])).toEqual({
      ok: true,
      prNumber: 9,
      createdAt: '2026-08-30T01:00:00Z',
    });
    expect(joinPullRequest(receipts[1], results[1])).toEqual({
      ok: false,
      reason: 'no-pr-match',
    });
    expect(calls).toHaveLength(3);
    expect(calls.filter((call) => call.args.includes('/search/issues'))).toHaveLength(1);
    expect(calls[0].args).toContain(
      'q=repo:woojubb/robota is:pr ("Work-Run: run-1" OR "Work-Run: run-2")',
    );
  });

  it('chunks the maximum UUID receipt batch below the GitHub search limit and deduplicates PR fetches', () => {
    const receipts = Array.from({ length: 10 }, (_, index) => ({
      runId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      identity: {
        repository: 'woojubb/robota',
        headCommit: `ready-${index}`,
      },
    }));
    const calls = [];
    const runGh = vi.fn((_command, args, options) => {
      calls.push({ args, options });
      if (args.includes('/search/issues')) {
        return {
          status: 0,
          stdout: JSON.stringify([
            { total_count: 1, incomplete_results: false, items: [{ number: 9 }] },
          ]),
          stderr: '',
        };
      }
      if (args.includes('/repos/woojubb/robota/pulls/9')) {
        return {
          status: 0,
          stdout: JSON.stringify({
            number: 9,
            body: `Work-Run: ${receipts[0].runId}`,
            created_at: '2026-08-30T01:00:00Z',
            head: { sha: 'closure' },
            base: { repo: { full_name: 'woojubb/robota' } },
          }),
          stderr: '',
        };
      }
      if (args.some((arg) => arg.startsWith('/repos/woojubb/robota/pulls/9/commits?'))) {
        return {
          status: 0,
          stdout: JSON.stringify([
            [
              ...receipts.map(({ runId, identity }) => ({
                sha: identity.headCommit,
                commit: { message: `feat: measured\n\nWork-Run: ${runId}` },
              })),
              { sha: 'closure', commit: { message: 'chore: close' } },
            ],
          ]),
          stderr: '',
        };
      }
      throw new Error(`unexpected GitHub call: ${args.join(' ')}`);
    });

    const results = queryGitHubPullRequests(receipts, {
      runGh,
      queryOpeningHeadEvidence: () => ({ ok: false, reason: 'not-under-test' }),
    });
    const searchCalls = calls.filter(({ args }) => args.includes('/search/issues'));

    expect(results.every((result) => result.ok)).toBe(true);
    expect(searchCalls.length).toBeGreaterThan(1);
    expect(
      searchCalls.every(({ args }) => {
        const query = args.find((arg) => arg.startsWith('q=')).slice(2);
        return Buffer.byteLength(query, 'utf8') <= 240;
      }),
    ).toBe(true);
    expect(calls.filter(({ args }) => args.includes('/repos/woojubb/robota/pulls/9'))).toHaveLength(
      1,
    );
    expect(
      calls.filter(({ args }) =>
        args.some((arg) => arg.startsWith('/repos/woojubb/robota/pulls/9/commits?')),
      ),
    ).toHaveLength(1);
  });

  it('fails every affected receipt explicitly when chunked searches exhaust the request budget', () => {
    const receipts = Array.from({ length: 10 }, (_, index) => ({
      runId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      identity: { repository: 'woojubb/robota', headCommit: `ready-${index}` },
    }));
    const budget = createGitHubLookupBudget({
      totalTimeoutMs: 1_000,
      maxReceipts: 10,
      maxRequests: 1,
      maxPages: 10,
      maxCandidates: 10,
    });
    const runGh = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify([{ total_count: 0, incomplete_results: false, items: [] }]),
      stderr: '',
    }));

    expect(queryGitHubPullRequests(receipts, { budget, runGh })).toEqual(
      receipts.map(() =>
        expect.objectContaining({ ok: false, reason: 'request-budget-exhausted' }),
      ),
    );
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  it('fails the adapter closed on timeout and incomplete pagination', () => {
    const receipt = {
      runId: 'run-1',
      identity: { repository: 'woojubb/robota', headCommit: 'ready' },
    };
    expect(
      queryGitHubPullRequest(receipt, {
        runGh: () => ({ status: null, error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '' }),
      }),
    ).toEqual(expect.objectContaining({ ok: false, reason: 'timeout' }));
    expect(
      queryGitHubPullRequest(receipt, {
        runGh: () => ({
          status: 0,
          stdout: JSON.stringify([
            { total_count: 2, incomplete_results: false, items: [{ number: 9 }] },
          ]),
          stderr: '',
        }),
      }),
    ).toEqual(expect.objectContaining({ ok: false, reason: 'incomplete-pagination' }));
  });

  it('classifies recognizable GitHub rate limits without treating an ordinary 403 as one', () => {
    const receipt = {
      runId: 'run-1',
      identity: { repository: 'woojubb/robota', headCommit: 'ready' },
    };
    const failure = (stderr) => () => ({ status: 1, stdout: '', stderr });

    expect(
      queryGitHubPullRequest(receipt, {
        runGh: failure('gh: API rate limit exceeded for 192.0.2.1. (HTTP 403)'),
      }),
    ).toEqual(expect.objectContaining({ ok: false, reason: 'rate-limit' }));
    expect(
      queryGitHubPullRequest(receipt, {
        runGh: failure('gh: Resource not accessible by integration (HTTP 403)'),
      }),
    ).toEqual(expect.objectContaining({ ok: false, reason: 'query-failed' }));
  });

  it('shares one bounded receipt, request, page, and candidate budget across the report', () => {
    const receipts = Array.from({ length: 4 }, (_, index) =>
      includedReceipt({
        runId: `run-${index}`,
        wallMs: 3,
        identity: { ...receiptIdentity, headCommit: String(index + 1).repeat(40) },
      }),
    );
    const observedBudgets = [];
    const report = reportWorkRuns(receipts, {
      githubLimits: {
        totalTimeoutMs: 1_000,
        maxReceipts: 2,
        maxRequests: 3,
        maxPages: 4,
        maxCandidates: 5,
      },
      queryPullRequest: (_receipt, { budget }) => {
        observedBudgets.push(budget);
        return { ok: false, reason: 'rate-limit' };
      },
    });

    expect(observedBudgets).toHaveLength(2);
    expect(new Set(observedBudgets).size).toBe(1);
    expect(observedBudgets[0]).toMatchObject({
      remainingRequests: 3,
      remainingPages: 4,
      remainingCandidates: 5,
      remainingReceipts: 0,
    });
    expect(report.populations.unavailable).toBe(4);
    expect(report.unavailableReasons).toEqual({
      'rate-limit': 2,
      'receipt-budget-exhausted': 2,
    });
  });

  it('enforces page and candidate caps cumulatively across adapter calls', () => {
    const budget = createGitHubLookupBudget({
      totalTimeoutMs: 1_000,
      maxReceipts: 2,
      maxRequests: 10,
      maxPages: 2,
      maxCandidates: 1,
    });
    const runGh = vi.fn(() => ({
      status: 0,
      stdout: JSON.stringify([
        { total_count: 1, incomplete_results: false, items: [{ number: 9 }] },
      ]),
      stderr: '',
    }));
    const receipt = {
      runId: 'run-1',
      identity: { repository: 'woojubb/robota', headCommit: 'ready' },
    };

    expect(queryGitHubPullRequest(receipt, { budget, runGh })).toEqual(
      expect.objectContaining({ ok: true, pullRequests: [] }),
    );
    expect(queryGitHubPullRequest({ ...receipt, runId: 'run-2' }, { budget, runGh })).toEqual(
      expect.objectContaining({ ok: false, reason: 'candidate-budget-exhausted' }),
    );
    expect(budget.remainingPages).toBe(0);
    expect(budget.remainingCandidates).toBe(0);
  });

  it('projects first-PR time from claimedAt without mutating receipts and counts join failures', () => {
    const receipts = [
      includedReceipt({
        runId: 'joined',
        wallMs: 10,
        identity: { ...receiptIdentity, headCommit: '1'.repeat(40) },
      }),
      includedReceipt({
        runId: 'failed',
        wallMs: 20,
        identity: { ...receiptIdentity, headCommit: '2'.repeat(40) },
      }),
      includedReceipt({
        runId: 'mismatched',
        wallMs: 30,
        identity: { ...receiptIdentity, headCommit: '3'.repeat(40) },
      }),
    ];
    const before = structuredClone(receipts);
    const queryPullRequests = vi.fn((batch) =>
      batch.map((receipt) =>
        receipt.runId === 'failed'
          ? { ok: false, reason: 'timeout' }
          : {
              ok: true,
              repository: 'woojubb/robota',
              prNumber: 9,
              pullRequests: [
                {
                  repository: 'woojubb/robota',
                  number: 9,
                  body: `Work-Run: ${receipt.runId}`,
                  headOid: 'closure',
                  createdAt: '2026-08-30T01:00:00Z',
                  headRange: {
                    startOid: receipt.runId === 'joined' ? '1'.repeat(40) : 'wrong-ready',
                    endOid: 'closure',
                    startIsAncestor: true,
                    commitRunIds: [receipt.runId],
                  },
                  openingHeadEvidence: { ok: true, headOid: 'closure' },
                },
              ],
            },
      ),
    );
    const report = reportWorkRuns(receipts, {
      queryPullRequests,
    });

    expect(receipts).toEqual(before);
    expect(queryPullRequests).toHaveBeenCalledTimes(1);
    expect(queryPullRequests.mock.calls[0][0].map((receipt) => receipt.runId)).toEqual([
      'joined',
      'failed',
      'mismatched',
    ]);
    expect(report.populations.unavailable).toBe(2);
    expect(report.unavailableReasons).toEqual({
      timeout: 1,
      'pr-identity-mismatch': 1,
    });
    expect(report.metrics.timeToFirstPrMs).toEqual({ p50: 3_600_000, p90: 3_600_000 });
    expect(report.firstPrRuns).toEqual([
      expect.objectContaining({
        runId: 'joined',
        firstPrAt: '2026-08-30T01:00:00Z',
        timeToFirstPrMs: 3_600_000,
        prNumber: 9,
      }),
    ]);
  });

  it('wires the injectable PR adapter through main without rewriting receipt files', () => {
    const root = makeTemp('work-run-report-');
    const directory = path.join(root, '.agents/evals/work-runs/run-1');
    mkdirSync(directory, { recursive: true });
    const receipt = includedReceipt({ runId: 'run-1', wallMs: 3 });
    const file = path.join(directory, 'g0-r0.json');
    writeFileSync(file, `${JSON.stringify(receipt)}\n`);
    let output = '';
    const report = main(['--root', root], {
      stdout: { write: (text) => (output += text) },
      queryPullRequest: () => ({ ok: false, reason: 'network' }),
    });

    expect(report.populations.unavailable).toBe(1);
    expect(JSON.parse(output)).toEqual(report);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(receipt);
  });
});
