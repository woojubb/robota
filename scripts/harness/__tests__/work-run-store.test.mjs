// harness-coverage: work-run-branch-pointer.mjs
// harness-coverage: work-run-json-store.mjs
// harness-coverage: work-run-paths.mjs
// harness-coverage: work-run-receipts.mjs
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { writeImmutableWorkRunReceipt } from '../work-run-domain.mjs';
import { readJson } from '../work-run-json-store.mjs';
import {
  projectLocalTerminalWorkRun,
  WORK_RUN_LOCAL_DIR,
  WORK_RUN_RECEIPT_DIR,
  WorkRunStore as ProductionWorkRunStore,
} from '../work-run-store.mjs';
import { makeTemp } from './make-temp.mjs';

const identity = {
  repository: 'woojubb/robota',
  branch: 'codex/work',
  baseCommit: 'b'.repeat(40),
  headCommit: 'h'.repeat(40),
  headTree: 't'.repeat(40),
  commitOids: ['h'.repeat(40)],
  trailerDigest: 'd'.repeat(64),
  ownerFingerprint: 'o'.repeat(64),
};
const claimIdentity = {
  repository: identity.repository,
  branchEpoch: 'e'.repeat(64),
  headCommit: 'c'.repeat(40),
};
const execFileAsync = promisify(execFile);

class WorkRunStore extends ProductionWorkRunStore {
  constructor(options) {
    super({ isAncestor: () => true, ...options });
  }

  claim(request) {
    return super.claim({ identity: claimIdentity, ...request });
  }
}

describe('work-run store', () => {
  it('rejects an oversized existing JSON file before returning parsed state', () => {
    const root = makeTemp('work-run-oversized-json-');
    const file = join(root, 'state.json');
    writeFileSync(file, JSON.stringify({ padding: 'x'.repeat(1_048_576) }));

    expect(() => readJson(file, root)).toThrow(/work-run state exceeds 1 MiB/i);
  });

  it('rejects a missing claim identity before persisting any local state', () => {
    const root = makeTemp('work-run-missing-claim-identity-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new ProductionWorkRunStore({ root, gitCommonDir: join(root, '.git') });

    expect(() => store.claim({ branch: identity.branch })).toThrow(/claim requires.*identity/i);
    expect(existsSync(join(root, WORK_RUN_LOCAL_DIR))).toBe(false);
  });

  it.each([
    '../outside',
    '/tmp/outside',
    '..',
    '.',
    'two/segments',
    'two\\segments',
    '%2e%2e%2foutside',
    ' spaced ',
    '',
    'run-id\0suffix',
    'rún-id',
  ])('rejects unsafe run ID %j at every filesystem boundary', (runId) => {
    const root = makeTemp('work-run-path-boundary-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    let lockActionCalled = false;

    expect(() => store.statePath(runId)).toThrow(/invalid work-run run ID/i);
    expect(() => store.receiptPath(runId, 0, 0)).toThrow(/invalid work-run run ID/i);
    expect(() =>
      store.withLock(runId, () => {
        lockActionCalled = true;
      }),
    ).toThrow(/invalid work-run run ID/i);
    expect(() => store.recoverStateLost({ runId, identity })).toThrow(/invalid work-run run ID/i);
    expect(() => store.read(runId)).toThrow(/invalid work-run run ID/i);
    expect(() => store.append(runId, {})).toThrow(/invalid work-run run ID/i);
    expect(() => store.reopen({ runId, ground: 'local-fix' })).toThrow(/invalid work-run run ID/i);
    expect(() => store.ready({ runId, identity })).toThrow(/invalid work-run run ID/i);
    expect(() => store.exclude({ runId, identity, reason: 'pure-planning-range' })).toThrow(
      /invalid work-run run ID/i,
    );
    expect(lockActionCalled).toBe(false);
  });

  it('accepts the complete canonical run ID alphabet at filesystem boundaries', () => {
    const root = makeTemp('work-run-canonical-path-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const runId = 'Run_01.alpha-beta';

    expect(store.statePath(runId)).toBe(join(root, WORK_RUN_LOCAL_DIR, `${runId}.json`));
    expect(store.receiptPath(runId, 2, 3)).toBe(
      join(root, WORK_RUN_RECEIPT_DIR, runId, 'g2-r3.json'),
    );
  });

  it('rejects a symlinked state owner before writing outside the repository', () => {
    const root = makeTemp('work-run-state-symlink-');
    const outside = makeTemp('work-run-state-outside-');
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, '.agents/evals/local-metrics'), { recursive: true });
    symlinkSync(outside, join(root, WORK_RUN_LOCAL_DIR), 'dir');
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });

    expect(() => store.claim({ branch: identity.branch })).toThrow(/symlink/i);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('rejects a symlinked lock owner before creating a lock outside git common dir', () => {
    const root = makeTemp('work-run-lock-symlink-');
    const outside = makeTemp('work-run-lock-outside-');
    mkdirSync(join(root, '.git'), { recursive: true });
    symlinkSync(outside, join(root, '.git/robota-work-runs'), 'dir');
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });

    expect(() => store.withLock('safe-run', () => undefined)).toThrow(/symlink/i);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('rejects a symlinked receipt run directory before writing outside the repository', () => {
    const root = makeTemp('work-run-receipt-symlink-');
    const outside = makeTemp('work-run-receipt-outside-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const run = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });
    store.append(run.runId, {
      type: 'work.bound',
      at: '2026-08-30T00:00:01.000Z',
      data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
    });
    store.append(run.runId, {
      type: 'work.started',
      at: '2026-08-30T00:00:02.000Z',
      data: {},
    });
    mkdirSync(join(root, WORK_RUN_RECEIPT_DIR), { recursive: true });
    symlinkSync(outside, join(root, WORK_RUN_RECEIPT_DIR, run.runId), 'dir');

    expect(() =>
      store.ready({ runId: run.runId, identity, at: '2026-08-30T00:00:03.000Z' }),
    ).toThrow(/symlink/i);
    expect(existsSync(join(outside, 'g0-r0.json'))).toBe(false);
  });

  it('rejects a symlinked cutover receipt directory in the direct immutable writer', () => {
    const root = makeTemp('work-run-direct-receipt-symlink-');
    const outside = makeTemp('work-run-direct-receipt-outside-');
    const receiptRoot = join(root, WORK_RUN_RECEIPT_DIR);
    mkdirSync(receiptRoot, { recursive: true });
    symlinkSync(outside, join(receiptRoot, 'pre-cutover-pr-42'), 'dir');
    const receiptPath = join(receiptRoot, 'pre-cutover-pr-42', 'g0-r0.json');

    expect(() =>
      writeImmutableWorkRunReceipt(receiptPath, {
        schemaVersion: 1,
        runId: 'pre-cutover-pr-42',
        generation: 0,
        revision: 0,
      }),
    ).toThrow(/symlink/i);
    expect(readdirSync(outside)).toEqual([]);
  });

  it('fails closed when a branch pointer contains an unsafe run ID', () => {
    const root = makeTemp('work-run-unsafe-pointer-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const pointerPath = store.pointerPath(identity.branch);
    mkdirSync(dirname(pointerPath), { recursive: true });
    writeFileSync(pointerPath, JSON.stringify({ branch: identity.branch, runId: '../outside' }));

    expect(() => store.claim({ branch: identity.branch })).toThrow(/invalid work-run run ID/i);
    expect(() => store.recoverStateLost({ runId: 'safe-run', identity })).toThrow(
      /invalid work-run run ID/i,
    );
  });

  it('serializes claim and reuse under the branch-hash lock', () => {
    const root = makeTemp('work-run-claim-lock-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const lockKeys = [];
    class ObservedStore extends WorkRunStore {
      withLock(key, action) {
        lockKeys.push(key);
        return super.withLock(key, action);
      }
    }
    const store = new ObservedStore({ root, gitCommonDir: join(root, '.git') });

    const first = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });
    const reused = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:01.000Z' });

    expect(reused.runId).toBe(first.runId);
    expect(lockKeys).toEqual([
      `branch-${createHash('sha256').update(identity.branch).digest('hex')}`,
      `branch-${createHash('sha256').update(identity.branch).digest('hex')}`,
    ]);
  });

  it('rotates a stale active pointer when the recreated branch is outside the initial ancestry', () => {
    const root = makeTemp('work-run-recreated-branch-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({
      root,
      gitCommonDir: join(root, '.git'),
      isAncestor: () => false,
    });
    const first = store.claim({
      branch: identity.branch,
      identity: claimIdentity,
      at: '2026-08-30T00:00:00.000Z',
    });

    const recreated = store.claim({
      branch: identity.branch,
      identity: { ...claimIdentity, headCommit: 'd'.repeat(40) },
      at: '2026-08-30T00:00:01.000Z',
    });

    expect(recreated.runId).not.toBe(first.runId);
    expect(recreated.events[0].at).toBe('2026-08-30T00:00:01.000Z');
  });

  it('rotates an active pointer copied from a different repository', () => {
    const root = makeTemp('work-run-repository-mismatch-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const first = store.claim({ branch: identity.branch });

    const replacement = store.claim({
      branch: identity.branch,
      identity: { ...claimIdentity, repository: 'fork/robota' },
    });

    expect(replacement.runId).not.toBe(first.runId);
  });

  it('migrates one legacy active pointer without interrupting the current run', () => {
    const root = makeTemp('work-run-legacy-pointer-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const run = store.claim({ branch: identity.branch });
    writeFileSync(
      store.pointerPath(identity.branch),
      `${JSON.stringify({ branch: identity.branch, runId: run.runId })}\n`,
    );

    expect(store.active({ branch: identity.branch, identity: claimIdentity })?.runId).toBe(
      run.runId,
    );
    expect(JSON.parse(readFileSync(store.pointerPath(identity.branch), 'utf8'))).toEqual({
      schemaVersion: 1,
      branch: identity.branch,
      runId: run.runId,
      repository: claimIdentity.repository,
      branchEpoch: claimIdentity.branchEpoch,
      initialHead: claimIdentity.headCommit,
    });
  });

  it('returns one active run when separate processes claim the same branch concurrently', async () => {
    const root = makeTemp('work-run-concurrent-claim-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const moduleUrl = new URL('../work-run-store.mjs', import.meta.url).href;
    const startAt = Date.now() + 300;
    const script = `
      import { WorkRunStore } from ${JSON.stringify(moduleUrl)};
      const store = new WorkRunStore({
        root: ${JSON.stringify(root)},
        gitCommonDir: ${JSON.stringify(join(root, '.git'))},
        isAncestor: () => true,
      });
      while (Date.now() < ${startAt}) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      process.stdout.write(store.claim({
        branch: ${JSON.stringify(identity.branch)},
        identity: ${JSON.stringify(claimIdentity)},
      }).runId);
    `;

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
          timeout: 5_000,
        }),
      ),
    );

    expect(new Set(results.map(({ stdout }) => stdout)).size).toBe(1);
  });

  it('claims collision-resistant runs and serializes atomic transitions', () => {
    const root = makeTemp('work-run-store-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const first = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });
    const reused = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:01.000Z' });
    expect(first.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reused.runId).toBe(first.runId);
    store.append(first.runId, {
      type: 'work.bound',
      at: '2026-08-30T00:00:02.000Z',
      data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
    });
    expect(store.read(first.runId).events).toHaveLength(2);
  });

  it('reconciles ready idempotently and increments pre-PR revisions only', () => {
    const root = makeTemp('work-run-ready-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const run = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });
    store.append(run.runId, {
      type: 'work.bound',
      at: '2026-08-30T00:00:01.000Z',
      data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
    });
    store.append(run.runId, {
      type: 'work.started',
      at: '2026-08-30T00:00:02.000Z',
      data: {},
    });
    const ready = store.ready({ runId: run.runId, identity, at: '2026-08-30T00:00:03.000Z' });
    const retry = store.ready({ runId: run.runId, identity, at: '2026-08-30T00:00:04.000Z' });
    expect(retry.receiptPath).toBe(ready.receiptPath);
    expect(JSON.parse(readFileSync(ready.receiptPath, 'utf8')).revision).toBe(0);
    expect(ready.receipt.cohort).toEqual({
      key: 'L2/observability',
      lane: 'L2',
      workKind: 'observability',
    });
    store.reopen({ runId: run.runId, at: '2026-08-30T00:00:05.000Z', ground: 'local-fix' });
    const revised = store.ready({
      runId: run.runId,
      identity: { ...identity, headCommit: 'n'.repeat(40) },
      at: '2026-08-30T00:00:06.000Z',
    });
    expect(JSON.parse(readFileSync(revised.receiptPath, 'utf8')).revision).toBe(1);
    expect(JSON.parse(readFileSync(revised.receiptPath, 'utf8')).generation).toBe(0);
  });

  it('recovers state from an immutable receipt after persistence fails between receipt and state', () => {
    const root = makeTemp('work-run-ready-recovery-');
    mkdirSync(join(root, '.git'), { recursive: true });
    let injectFailure = true;
    const store = new WorkRunStore({
      root,
      gitCommonDir: join(root, '.git'),
      persistenceHooks: {
        afterReceiptPersist() {
          if (!injectFailure) return;
          injectFailure = false;
          throw new Error('injected failure after receipt persistence');
        },
      },
    });
    const run = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });
    store.append(run.runId, {
      type: 'work.bound',
      at: '2026-08-30T00:00:01.000Z',
      data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
    });
    store.append(run.runId, {
      type: 'work.started',
      at: '2026-08-30T00:00:02.000Z',
      data: {},
    });

    expect(() =>
      store.ready({ runId: run.runId, identity, at: '2026-08-30T00:00:03.000Z' }),
    ).toThrow('injected failure after receipt persistence');
    const receiptPath = store.receiptPath(run.runId, 0, 0);
    const receiptBeforeRetry = readFileSync(receiptPath, 'utf8');
    const persistedReadyEvent = JSON.parse(receiptBeforeRetry).events.at(-1);
    expect(store.read(run.runId).events.at(-1).type).toBe('work.started');

    const recovered = store.ready({
      runId: run.runId,
      identity,
      at: '2026-08-30T00:00:09.000Z',
    });

    expect(recovered.receiptPath).toBe(receiptPath);
    expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBeforeRetry);
    expect(store.read(run.runId).events.at(-1)).toEqual(persistedReadyEvent);
    expect(persistedReadyEvent.at).toBe('2026-08-30T00:00:03.000Z');
  });

  it('does not overwrite a different receipt at the deterministic ready path', () => {
    const root = makeTemp('work-run-ready-conflict-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const run = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });
    store.append(run.runId, {
      type: 'work.bound',
      at: '2026-08-30T00:00:01.000Z',
      data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
    });
    store.append(run.runId, {
      type: 'work.started',
      at: '2026-08-30T00:00:02.000Z',
      data: {},
    });
    const receiptPath = store.receiptPath(run.runId, 0, 0);
    mkdirSync(join(root, '.agents/evals/work-runs', run.runId), { recursive: true });
    const conflictingReceipt = '{"different":true}\n';
    writeFileSync(receiptPath, conflictingReceipt, 'utf8');

    expect(() =>
      store.ready({ runId: run.runId, identity, at: '2026-08-30T00:00:03.000Z' }),
    ).toThrow('immutable work-run receipt conflict');
    expect(readFileSync(receiptPath, 'utf8')).toBe(conflictingReceipt);
    expect(store.read(run.runId).events.at(-1).type).toBe('work.started');
  });

  it('copies the matching post-PR reopen ground and authorization into its receipt', () => {
    const root = makeTemp('work-run-post-pr-reopen-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const run = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });
    store.append(run.runId, {
      type: 'work.bound',
      at: '2026-08-30T00:00:01.000Z',
      data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
    });
    store.append(run.runId, {
      type: 'work.started',
      at: '2026-08-30T00:00:02.000Z',
      data: {},
    });
    store.ready({ runId: run.runId, identity, at: '2026-08-30T00:00:03.000Z' });
    const authorization = {
      action: 'fix',
      approver: 'review-bot',
      evidence: 'check-123',
      ground: 'red-check',
      prNumber: 2514,
      reviewedRemoteHead: identity.headCommit,
      scope: ['scripts/harness/work-run-store.mjs'],
    };
    store.reopen({
      runId: run.runId,
      at: '2026-08-30T00:00:04.000Z',
      ground: 'red-check',
      generation: 1,
      authorization,
    });
    const postPrIdentity = { ...identity, headCommit: 'n'.repeat(40) };
    const postPr = store.ready({
      runId: run.runId,
      identity: postPrIdentity,
      at: '2026-08-30T00:00:05.000Z',
    });

    expect(postPr.receipt.generation).toBe(1);
    expect(postPr.receipt.revision).toBe(0);
    expect(postPr.receipt.ground).toBe('red-check');
    expect(postPr.receipt.authorization).toEqual(authorization);
    expect(postPr.receipt.events.at(-2).data.authorization).toEqual(authorization);
    expect(postPr.receipt.durations).toEqual({
      wallMs: 1_000,
      activeMs: 1_000,
      pausedMs: 0,
      phases: {},
    });
  });

  it('writes an immutable identity-bound exclusion receipt with the canonical cohort', () => {
    const root = makeTemp('work-run-excluded-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const run = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });
    store.append(run.runId, {
      type: 'work.bound',
      at: '2026-08-30T00:00:01.000Z',
      data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
    });

    const excluded = store.exclude({
      runId: run.runId,
      identity,
      reason: 'pure-planning-range',
      at: '2026-08-30T00:00:02.000Z',
    });
    const beforeRetry = readFileSync(excluded.receiptPath, 'utf8');
    const retry = store.exclude({
      runId: run.runId,
      identity,
      reason: 'pure-planning-range',
      at: '2026-08-30T00:00:09.000Z',
    });

    expect(readFileSync(retry.receiptPath, 'utf8')).toBe(beforeRetry);
    expect(retry.receipt).toMatchObject({
      disposition: 'excluded',
      reason: 'pure-planning-range',
      identity,
      cohort: { key: 'L2/observability', lane: 'L2', workKind: 'observability' },
    });
    expect(retry.receipt.events.at(-1)).toMatchObject({
      type: 'work.excluded',
      data: { reason: 'pure-planning-range' },
    });
    expect(() =>
      store.exclude({
        runId: run.runId,
        identity: { ...identity, headCommit: 'x'.repeat(40) },
        reason: 'pure-planning-range',
      }),
    ).toThrow('immutable work-run receipt conflict');
  });

  it('keeps abandonment local and creates no push-satisfying receipt', () => {
    const root = makeTemp('work-run-abandoned-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const run = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });

    store.append(run.runId, {
      type: 'work.bound',
      at: '2026-08-30T00:00:00.250Z',
      data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'observability' },
    });
    store.append(run.runId, {
      type: 'work.started',
      at: '2026-08-30T00:00:00.500Z',
      data: {},
    });
    store.append(run.runId, {
      type: 'work.abandoned',
      at: '2026-08-30T00:00:01.000Z',
      data: { reason: 'user-stopped' },
    });

    expect(existsSync(store.receiptPath(run.runId, 0, 0))).toBe(false);
    expect(projectLocalTerminalWorkRun(store.read(run.runId))).toEqual({
      disposition: 'abandoned',
      source: 'local-state',
      runId: run.runId,
      generation: 0,
      revision: 0,
      reason: 'user-stopped',
      cohort: { key: 'L2/observability', lane: 'L2', workKind: 'observability' },
      durations: { wallMs: 1_000, activeMs: 1_000, pausedMs: 0, phases: {} },
      timestamps: {
        claimedAt: '2026-08-30T00:00:00.000Z',
        abandonedAt: '2026-08-30T00:00:01.000Z',
      },
    });
  });

  it('does not project nonterminal local state into the report population', () => {
    const root = makeTemp('work-run-active-local-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const run = store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });

    expect(projectLocalTerminalWorkRun(store.read(run.runId))).toBeNull();
  });

  it('writes state-lost as invalid with unavailable timestamps', () => {
    const root = makeTemp('work-run-lost-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const recovered = store.recoverStateLost({ runId: 'lost-run', identity });
    const receipt = JSON.parse(readFileSync(recovered.receiptPath, 'utf8'));
    expect(receipt.disposition).toBe('invalid');
    expect(receipt.reason).toBe('state-lost');
    expect(receipt.timestamps).toEqual({ claimedAt: null, readyAt: null });
    expect(store.recoverStateLost({ runId: 'lost-run', identity }).receipt).toEqual(receipt);
    expect(() =>
      store.recoverStateLost({
        runId: 'lost-run',
        identity: { ...identity, headCommit: 'x'.repeat(40) },
      }),
    ).toThrow('immutable work-run receipt conflict');
  });

  it('refuses state-lost recovery when the requested run state still exists', () => {
    const root = makeTemp('work-run-recover-existing-state-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    const existing = store.claim({ branch: 'codex/existing', at: '2026-08-30T00:00:00.000Z' });

    expect(() =>
      store.recoverStateLost({
        runId: existing.runId,
        identity: { ...identity, branch: 'codex/different-branch' },
      }),
    ).toThrow(/state still exists/i);
    expect(existsSync(store.receiptPath(existing.runId, 0, 0))).toBe(false);
  });

  it('refuses state-lost recovery when the branch points to an active readable run', () => {
    const root = makeTemp('work-run-recover-active-pointer-');
    mkdirSync(join(root, '.git'), { recursive: true });
    const store = new WorkRunStore({ root, gitCommonDir: join(root, '.git') });
    store.claim({ branch: identity.branch, at: '2026-08-30T00:00:00.000Z' });

    expect(() => store.recoverStateLost({ runId: 'lost-run', identity })).toThrow(
      /branch points to an active work run/i,
    );
    expect(existsSync(store.receiptPath('lost-run', 0, 0))).toBe(false);
  });
});
