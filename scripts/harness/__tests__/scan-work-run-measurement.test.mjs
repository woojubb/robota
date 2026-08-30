// harness-coverage: work-run-cutover-scan.mjs
// harness-coverage: work-run-cutover-digest.mjs
// harness-coverage: work-run-scan-adapters.mjs
import { describe, expect, it, vi } from 'vitest';

import {
  classifyPlanningExclusion,
  judgeWorkRunScan,
  resolveScanPrContext,
  resolveScanSubject,
  routeWorkRunScan,
  validateWorkRunRange,
  validateCutoverMarker,
  validatePreCutoverReceipt,
  validateCutoverRegistry,
} from '../scan-work-run-measurement.mjs';
import { createWorkRunVerificationRuntime } from '../work-run-verification-runtime.mjs';
import { changedRange, inspectCutover, receiptForRunAt } from '../work-run-scan-adapters.mjs';

const entryIdentity = {
  repository: 'woojubb/robota',
  branch: 'codex/old-pr',
  baseCommit: 'b'.repeat(40),
  headCommit: 'a'.repeat(40),
  headTree: 'c'.repeat(40),
  commitOids: ['a'.repeat(40)],
  changeDigest: 'd'.repeat(64),
  trailerDigest: 'e'.repeat(64),
  ownerFingerprint: 'f'.repeat(64),
};

const entry = {
  number: 7,
  createdAt: '2026-08-29T00:00:00.000Z',
  baseOid: entryIdentity.baseCommit,
  headOid: entryIdentity.headCommit,
  identity: entryIdentity,
};

const marker = {
  schemaVersion: 1,
  markerId: 'work-run-v1',
  generatedAt: '2026-08-30T10:59:30.000Z',
  repository: 'woojubb/robota',
  openPullRequests: [entry],
};

const sealedReceipt = {
  schemaVersion: 1,
  disposition: 'pre-cutover',
  reason: 'registered-open-pr',
  runId: 'pre-cutover-pr-7',
  generation: 0,
  revision: 0,
  prNumber: 7,
  markerId: 'work-run-v1',
  identity: entry.identity,
  timestamps: { claimedAt: null, readyAt: entry.createdAt },
};

describe('scan-work-run-measurement', () => {
  it('uses the shared runtime for every Git-backed scan adapter', () => {
    const operations = [
      () =>
        inspectCutover({
          root: '/tmp/repository',
          baseRef: 'origin/develop',
          subject: { subjectRef: 'HEAD', subjectBranch: 'codex/work' },
          env: {},
          currentPrNumber: null,
          runtime: createWorkRunVerificationRuntime({ commandBudget: 0 }),
        }),
      () =>
        receiptForRunAt(
          '/tmp/repository',
          'HEAD',
          'run-1',
          createWorkRunVerificationRuntime({ commandBudget: 0 }),
        ),
      () =>
        changedRange(
          '/tmp/repository',
          'origin/develop',
          'HEAD',
          'run-1',
          createWorkRunVerificationRuntime({ commandBudget: 0 }),
        ),
    ];

    for (const operation of operations) {
      expect(operation).toThrow('work-run verification command budget exhausted');
    }
  });

  it.each(['develop', 'main', 'master'])(
    'classifies a local protected subject branch %s outside the topic range before registry lookup',
    (subjectBranch) => {
      const inspectCutoverRange = vi.fn(() => {
        throw new Error('cutover lookup must not run');
      });
      const validateMeasurement = vi.fn(() => {
        throw new Error('measurement must not run');
      });

      expect(
        validateWorkRunRange(
          {
            root: '/tmp/repository',
            baseRef: 'origin/develop',
            subjectRef: 'HEAD',
            subjectBranch,
            env: {},
          },
          { inspectCutoverRange, validateMeasurement },
        ),
      ).toEqual({ ok: true, population: 'outside-topic-range' });
      expect(inspectCutoverRange).not.toHaveBeenCalled();
      expect(validateMeasurement).not.toHaveBeenCalled();
    },
  );

  it.each(['develop', 'main', 'master'])(
    'does not exempt a pull-request head merely because its fork branch is named %s',
    (subjectBranch) => {
      const validateMeasurement = vi.fn(() => ({
        ok: true,
        population: 'included',
        runId: 'run-1',
      }));
      expect(
        validateWorkRunRange(
          {
            root: '/tmp/repository',
            baseRef: 'origin/develop',
            subjectRef: 'a'.repeat(40),
            subjectBranch,
            env: { GITHUB_ACTIONS: 'true', GITHUB_HEAD_REF: subjectBranch },
          },
          {
            inspectCutoverRange: () => ({ ok: true, population: 'post-cutover' }),
            resolvePrNumber: () => 42,
            validateMeasurement,
          },
        ),
      ).toEqual({ ok: true, population: 'included', runId: 'run-1' });
      expect(validateMeasurement).toHaveBeenCalledWith({
        currentPrNumber: 42,
        currentPrCreatedAt: null,
      });
    },
  );

  it.each(['origin/develop', 'refs/heads/main', 'feature/master'])(
    'does not exempt the topic branch name %s by prefix-like matching',
    (subjectBranch) => {
      const validateMeasurement = vi.fn(() => ({
        ok: true,
        population: 'included',
        runId: 'run-1',
      }));
      expect(
        validateWorkRunRange(
          {
            root: '/tmp/repository',
            baseRef: 'origin/develop',
            subjectRef: 'a'.repeat(40),
            subjectBranch,
          },
          {
            inspectCutoverRange: () => ({ ok: true, population: 'post-cutover' }),
            resolvePrNumber: () => null,
            validateMeasurement,
          },
        ),
      ).toEqual({ ok: true, population: 'included', runId: 'run-1' });
      expect(validateMeasurement).toHaveBeenCalledOnce();
    },
  );

  it('passes the one resolved current PR identity into repository validation', () => {
    const validateMeasurement = vi.fn(() => ({
      ok: true,
      population: 'included',
      runId: 'run-1',
    }));
    validateWorkRunRange(
      {
        root: '/tmp/repository',
        baseRef: 'origin/develop',
        subjectRef: 'a'.repeat(40),
        subjectBranch: 'codex/work',
      },
      {
        inspectCutoverRange: () => ({ ok: true, population: 'post-cutover' }),
        resolvePrNumber: () => 42,
        validateMeasurement,
      },
    );
    expect(validateMeasurement).toHaveBeenCalledWith({
      currentPrNumber: 42,
      currentPrCreatedAt: null,
    });
  });

  it('preserves the pre-push observation through the repository-validation adapter', () => {
    const validateRepositoryWorkRun = vi.fn(() => ({
      ok: true,
      population: 'included',
      runId: 'run-1',
    }));

    validateWorkRunRange(
      {
        root: '/tmp/repository',
        baseRef: 'origin/develop',
        subjectRef: 'a'.repeat(40),
        subjectBranch: 'codex/work',
        prObservation: 'pre-push',
      },
      {
        inspectCutoverRange: () => ({ ok: true, population: 'post-cutover' }),
        resolvePrNumber: () => 42,
        validateRepositoryWorkRun,
        fetchPullRequestEvidence: vi.fn(),
      },
    );

    expect(validateRepositoryWorkRun).toHaveBeenCalledWith(
      expect.objectContaining({ prObservation: 'pre-push', currentPrNumber: 42 }),
    );
  });

  it('keeps unavailable PR context distinct and fails before scan projection', () => {
    expect(
      resolveScanPrContext({
        root: '/tmp/repository',
        subjectBranch: 'codex/work',
        env: {},
        query: () => ({ status: 'none' }),
      }),
    ).toEqual({ status: 'none' });
    expect(() =>
      validateWorkRunRange(
        {
          root: '/tmp/repository',
          baseRef: 'origin/develop',
          subjectRef: 'a'.repeat(40),
          subjectBranch: 'codex/work',
        },
        {
          resolvePrContext: () => ({
            status: 'unavailable',
            reason: 'github-open-pr-query-failed',
          }),
          inspectCutoverRange: vi.fn(),
        },
      ),
    ).toThrow(/github-open-pr-query-failed/);
  });

  it('keeps a closed historical PR in the measured branch context', () => {
    const validateMeasurement = vi.fn(() => ({
      ok: true,
      population: 'included',
      runId: 'run-1',
    }));
    validateWorkRunRange(
      {
        root: '/tmp/repository',
        baseRef: 'origin/develop',
        subjectRef: 'a'.repeat(40),
        subjectBranch: 'codex/work',
      },
      {
        inspectCutoverRange: () => ({ ok: true, population: 'post-cutover' }),
        resolvePrContext: () => ({ status: 'closed', number: 42, createdAt: null }),
        validateMeasurement,
      },
    );
    expect(validateMeasurement).toHaveBeenCalledWith({
      currentPrNumber: 42,
      currentPrCreatedAt: null,
    });
  });

  it('uses one cutover -> measurement -> planning-exclusion route for every caller', () => {
    const calls = [];
    const receipt = { disposition: 'excluded', reason: 'pure-planning-range' };
    const verdict = validateWorkRunRange(
      {
        root: '/tmp/repository',
        baseRef: 'origin/develop',
        subjectRef: 'a'.repeat(40),
        subjectBranch: 'codex/work',
      },
      {
        resolvePrNumber: () => null,
        inspectCutoverRange: () => {
          calls.push('cutover');
          return { ok: true, population: 'post-cutover' };
        },
        validateMeasurement: () => {
          calls.push('measurement');
          return { ok: true, population: 'excluded', runId: 'run-1' };
        },
        receiptForRun: () => receipt,
        validatePlanningExclusion: ({ receipt: candidate }) => {
          calls.push('planning-exclusion');
          expect(candidate).toBe(receipt);
          return { ok: true };
        },
      },
    );

    expect(verdict).toEqual({ ok: true, population: 'excluded', runId: 'run-1' });
    expect(calls).toEqual(['cutover', 'measurement', 'planning-exclusion']);
  });

  it('fails before generic measurement when the shared cutover verdict is malformed', () => {
    const validateMeasurement = vi.fn();
    expect(() =>
      validateWorkRunRange(
        {
          root: '/tmp/repository',
          baseRef: 'origin/develop',
          subjectRef: 'a'.repeat(40),
          subjectBranch: 'codex/work',
        },
        {
          resolvePrNumber: () => null,
          inspectCutoverRange: () => ({ ok: false, reason: 'invalid-cutover-marker' }),
          validateMeasurement,
        },
      ),
    ).toThrow(/invalid-cutover-marker/);
    expect(validateMeasurement).not.toHaveBeenCalled();
  });

  it('fails a non-planning exclusion through the shared route', () => {
    expect(() =>
      validateWorkRunRange(
        {
          root: '/tmp/repository',
          baseRef: 'origin/develop',
          subjectRef: 'a'.repeat(40),
          subjectBranch: 'codex/work',
        },
        {
          resolvePrNumber: () => null,
          inspectCutoverRange: () => ({ ok: true, population: 'post-cutover' }),
          validateMeasurement: () => ({ ok: true, population: 'excluded', runId: 'run-1' }),
          receiptForRun: () => ({ disposition: 'excluded', reason: 'invented-reason' }),
          validatePlanningExclusion: () => ({
            ok: false,
            reason: 'invalid-planning-exclusion',
          }),
        },
      ),
    ).toThrow(/invalid-planning-exclusion/);
  });

  it('resolves the actual pull-request head and branch from args, env, or event payload', () => {
    const explicitSha = '1'.repeat(40);
    expect(
      resolveScanSubject({
        argv: ['--subject-sha', explicitSha, '--subject-branch', 'codex/explicit'],
        env: {},
        currentBranch: 'synthetic',
      }),
    ).toEqual({ subjectRef: explicitSha, subjectBranch: 'codex/explicit' });

    const envSha = '2'.repeat(40);
    expect(
      resolveScanSubject({
        argv: [],
        env: { PR_HEAD_SHA: envSha, GITHUB_HEAD_REF: 'codex/env' },
        currentBranch: 'synthetic',
      }),
    ).toEqual({ subjectRef: envSha, subjectBranch: 'codex/env' });

    const eventSha = '3'.repeat(40);
    expect(
      resolveScanSubject({
        argv: [],
        env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: '/tmp/event.json' },
        currentBranch: 'synthetic',
        readEvent: () =>
          JSON.stringify({ pull_request: { head: { sha: eventSha, ref: 'codex/event' } } }),
      }),
    ).toEqual({ subjectRef: eventSha, subjectBranch: 'codex/event' });
  });

  it('fails closed instead of validating GitHub synthetic merge HEAD', () => {
    expect(() =>
      resolveScanSubject({
        argv: [],
        env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'codex/work' },
        currentBranch: 'HEAD',
      }),
    ).toThrow(/actual pull-request head/i);
  });

  it('goes red when a topic range has no measurement', () => {
    expect(() => judgeWorkRunScan({ ok: false, reason: 'missing-measurement' })).toThrow(
      /missing-measurement/,
    );
  });

  it('goes green only for a validator-approved population', () => {
    expect(judgeWorkRunScan({ ok: true, population: 'included', runId: 'run-1' })).toEqual({
      ok: true,
      population: 'included',
      runId: 'run-1',
    });
  });

  it.each([
    ['unsupported version', { ...marker, schemaVersion: 2 }],
    ['wrong marker identity', { ...marker, markerId: 'work-run-v2' }],
    ['invalid generation time', { ...marker, generatedAt: 'yesterday' }],
    ['duplicate PR', { ...marker, openPullRequests: [entry, entry] }],
    ['malformed OID', { ...marker, openPullRequests: [{ ...entry, headOid: 'expired' }] }],
  ])('fails closed for a malformed cutover marker: %s', (_case, candidate) => {
    expect(validateCutoverMarker(candidate, { repository: 'woojubb/robota' })).toEqual(
      expect.objectContaining({ ok: false, reason: 'invalid-cutover-marker' }),
    );
  });

  it('requires exactly one marker addition in the version-specific discovery range', () => {
    expect(
      validateCutoverRegistry({
        baseMarker: null,
        headMarker: marker,
        markerAdditionCount: 0,
        repository: marker.repository,
      }),
    ).toEqual({ ok: false, reason: 'missing-cutover-marker-addition' });
    expect(
      validateCutoverRegistry({
        baseMarker: null,
        headMarker: marker,
        markerAdditionCount: 2,
        repository: marker.repository,
      }),
    ).toEqual({ ok: false, reason: 'multiple-cutover-marker-additions' });
  });

  it('keeps the base-ancestry open-PR registry immutable', () => {
    expect(
      validateCutoverRegistry({
        baseMarker: marker,
        headMarker: { ...marker, openPullRequests: [] },
        markerAdditionCount: 1,
        repository: marker.repository,
      }),
    ).toEqual({ ok: false, reason: 'cutover-registry-mutated' });
  });

  it('accepts an exact sealed registry entry after original object expiry without probing Git objects', () => {
    expect(
      validateCutoverRegistry({
        baseMarker: marker,
        headMarker: structuredClone(marker),
        markerAdditionCount: 1,
        repository: marker.repository,
        prNumber: 7,
        receipt: sealedReceipt,
        receiptPath: '.agents/evals/work-runs/pre-cutover-pr-7/g0-r0.json',
        subjectBranch: 'codex/old-pr',
        closureValid: true,
        currentChangeDigest: entry.identity.changeDigest,
      }),
    ).toEqual({ ok: true, population: 'excluded', reason: 'registered-pre-cutover' });
  });

  it('rejects a rebased pre-cutover receipt whose current topic change differs from the seal', () => {
    expect(
      validateCutoverRegistry({
        baseMarker: marker,
        headMarker: structuredClone(marker),
        markerAdditionCount: 1,
        repository: marker.repository,
        prNumber: 7,
        receipt: sealedReceipt,
        receiptPath: '.agents/evals/work-runs/pre-cutover-pr-7/g0-r0.json',
        subjectBranch: 'codex/old-pr',
        closureValid: true,
        currentChangeDigest: '0'.repeat(64),
      }),
    ).toEqual({ ok: false, reason: 'altered-pre-cutover-topic-change' });
  });

  it('requires an exact deterministic pre-cutover receipt bound to the immutable registry', () => {
    const receiptPath = '.agents/evals/work-runs/pre-cutover-pr-7/g0-r0.json';
    const exactReceipt = structuredClone(sealedReceipt);
    expect(
      validatePreCutoverReceipt({
        receipt: exactReceipt,
        receiptPath,
        marker,
        entry,
        prNumber: 7,
        subjectBranch: 'codex/old-pr',
        closureValid: true,
        currentChangeDigest: entry.identity.changeDigest,
      }),
    ).toEqual({ ok: true });
    expect(
      validatePreCutoverReceipt({
        receipt: { ...exactReceipt, invented: true },
        receiptPath,
        marker,
        entry,
        prNumber: 7,
        subjectBranch: 'codex/old-pr',
        closureValid: true,
      }),
    ).toEqual({ ok: false, reason: 'stale-pre-cutover-receipt' });
    expect(
      validatePreCutoverReceipt({
        receipt: exactReceipt,
        receiptPath: '.agents/evals/work-runs/pre-cutover-pr-7/g0-r1.json',
        marker,
        entry,
        prNumber: 7,
        subjectBranch: 'codex/old-pr',
        closureValid: true,
      }),
    ).toEqual({ ok: false, reason: 'stale-pre-cutover-receipt' });
  });

  it('routes a registered pre-cutover PR before generic receipt validation after rebase', () => {
    const validateMeasurement = vi.fn(() => ({
      ok: false,
      reason: 'generic-validator-must-not-run',
    }));
    expect(
      routeWorkRunScan({
        cutoverVerdict: {
          ok: true,
          population: 'excluded',
          reason: 'registered-pre-cutover',
        },
        validateMeasurement,
      }),
    ).toEqual({
      ok: true,
      population: 'excluded',
      reason: 'registered-pre-cutover',
    });
    expect(validateMeasurement).not.toHaveBeenCalled();
  });

  it('uses the canonical planning projection for exclusion receipts', () => {
    const basename = 'OBSERVABILITY-002-work-run-pre-pr-measurement.md';
    const taskPath = `.agents/tasks/${basename}`;
    const specPath = `.agents/spec-docs/draft/${basename}`;
    const task = '---\nstatus: todo\n---\n\n# OBSERVABILITY-002\n';
    const spec = '---\nstatus: draft\ntype: OBSERVABILITY\n---\n\n# OBSERVABILITY-002\n';
    const texts = new Map([
      [taskPath, task],
      [specPath, spec],
    ]);
    expect(
      classifyPlanningExclusion({
        receipt: { disposition: 'excluded', reason: 'pure-planning-range' },
        changedPaths: [taskPath, specPath],
        beforeTextForPath: () => null,
        afterTextForPath: (file) => texts.get(file) ?? null,
      }),
    ).toEqual({ ok: true });
    expect(
      classifyPlanningExclusion({
        receipt: { disposition: 'excluded', reason: 'pure-planning-range' },
        changedPaths: [taskPath, specPath, 'scripts/harness/work-run.mjs'],
        beforeTextForPath: () => null,
        afterTextForPath: (file) => texts.get(file) ?? 'implementation',
      }),
    ).toEqual({ ok: false, reason: 'invalid-planning-exclusion' });
  });

  it('rejects stale sealed identity instead of trusting an expired original object', () => {
    expect(
      validateCutoverRegistry({
        baseMarker: marker,
        headMarker: marker,
        markerAdditionCount: 1,
        repository: marker.repository,
        prNumber: 7,
        receipt: {
          ...sealedReceipt,
          identity: { ...sealedReceipt.identity, headCommit: 'f'.repeat(40) },
        },
        receiptPath: '.agents/evals/work-runs/pre-cutover-pr-7/g0-r0.json',
        subjectBranch: 'codex/old-pr',
        closureValid: true,
      }),
    ).toEqual({ ok: false, reason: 'stale-pre-cutover-receipt' });
  });
});
