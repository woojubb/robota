// harness-coverage: work-run-git-adapter.mjs
// harness-coverage: work-run-rebase-validation.mjs
// harness-coverage: work-run-receipt-validation.mjs
// harness-coverage: work-run-repository-validation.mjs
// harness-coverage: work-run-post-pr-validation.mjs
// harness-coverage: work-run-historical-rebase-suffix.mjs
// harness-coverage: work-run-validation-foundation.mjs
// harness-coverage: work-run-authorization-batch.mjs
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  appendWorkRunEvent,
  cohortKey,
  createInitialWorkRun,
  projectWorkRunDurations,
  reduceWorkRun,
  workRunEventHash,
} from '../work-run-contract.mjs';
import { createRebaseProof } from '../work-run-git.mjs';
import { historicalRebaseSuffixMatches } from '../work-run-historical-rebase-suffix.mjs';
import {
  CUTOVER_SCHEMA_VERSION,
  rebaseProofMatches,
  validateCutoverDisposition,
  validateRepositoryWorkRun,
  validateWorkRunMeasurement,
  validateWorkRunReceipt,
} from '../work-run-validation.mjs';
import { createWorkRunVerificationRuntime } from '../work-run-verification-runtime.mjs';

const identity = {
  repository: 'woojubb/robota',
  branch: 'codex/work',
  baseCommit: 'b'.repeat(40),
  headCommit: 'c'.repeat(40),
  headTree: 'e'.repeat(40),
  commitOids: ['c'.repeat(40)],
  trailerDigest: 'd'.repeat(64),
  ownerFingerprint: 'f'.repeat(64),
};
const fixtureRoots = [];
const topicSeeds = new Map();
let seedOwner;

const GIT_TEST_CONFIG = [
  '-c',
  'user.name=Test User',
  '-c',
  'user.email=test@example.com',
  '-c',
  'commit.gpgSign=false',
  '-c',
  'tag.gpgSign=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsync=none',
  '-c',
  'gc.auto=0',
];

beforeAll(() => {
  seedOwner = makeTemp('robota-work-run-validation-seeds-');
  const baseRoot = path.join(seedOwner, 'base');
  mkdirSync(baseRoot, { recursive: true });
  git(baseRoot, ['init', '--quiet', '-b', 'develop']);
  git(baseRoot, ['remote', 'add', 'origin', 'git@github.com:woojubb/robota.git']);
  write(baseRoot, '.agents/evals/work-runs/cutover-v1.json', '{"schemaVersion":1}\n');
  write(baseRoot, 'scripts/harness/work-run-contract.mjs', 'export const contract = 1;\n');
  git(baseRoot, ['add', '.']);
  git(baseRoot, ['commit', '--quiet', '-m', 'base']);
  const baseCommit = git(baseRoot, ['rev-parse', 'HEAD']);

  for (const [generation, revision] of [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]) {
    const receiptName = `g${generation}-r${revision}`;
    const root = path.join(seedOwner, receiptName);
    cpSync(baseRoot, root, { recursive: true, verbatimSymlinks: true });
    git(root, ['switch', '--quiet', '-c', 'codex/work']);
    let authorizationHead = null;
    if (generation > 0 || revision > 0) {
      write(root, 'src/change-0.mjs', 'export const changed0 = true;\n');
      git(root, ['add', '.']);
      git(root, [
        'commit',
        '--quiet',
        '-m',
        'feat: initial change\n\nWork-Run: run-1\nWork-Receipt: g0-r0',
      ]);
      const events = receiptEvents({ generation: 0 });
      write(
        root,
        '.agents/evals/work-runs/run-1/g0-r0.json',
        `${JSON.stringify({
          schemaVersion: 1,
          disposition: 'included',
          runId: 'run-1',
          generation: 0,
          revision: 0,
          identity: currentReceiptIdentity(root, baseCommit),
          events,
          ...receiptProjection(events),
          timestamps: { claimedAt: events[0].at, readyAt: events.at(-1).at },
        })}\n`,
      );
      git(root, ['add', '.agents/evals/work-runs/run-1/g0-r0.json']);
      git(root, [
        'commit',
        '--quiet',
        '-m',
        'chore: close initial run\n\nWork-Run: run-1\nWork-Receipt: g0-r0',
      ]);
      authorizationHead = git(root, ['rev-parse', 'HEAD']);
    }
    if (generation === 1 && revision > 0) {
      const authorization = trustedAuthorization({ head: authorizationHead });
      write(root, 'src/change-1.mjs', 'export const changed1 = true;\n');
      git(root, ['add', '.']);
      git(root, [
        'commit',
        '--quiet',
        '-m',
        'fix: generation one\n\nWork-Run: run-1\nWork-Receipt: g1-r0',
      ]);
      const events = receiptEvents({ generation: 1, authorization });
      write(
        root,
        '.agents/evals/work-runs/run-1/g1-r0.json',
        `${JSON.stringify({
          schemaVersion: 1,
          disposition: 'included',
          runId: 'run-1',
          generation: 1,
          revision: 0,
          ground: authorization.ground,
          authorization,
          identity: currentReceiptIdentity(root, baseCommit),
          events,
          ...receiptProjection(events),
          timestamps: { claimedAt: events[0].at, readyAt: events.at(-1).at },
        })}\n`,
      );
      git(root, ['add', '.agents/evals/work-runs/run-1/g1-r0.json']);
      git(root, [
        'commit',
        '--quiet',
        '-m',
        'chore: close generation one\n\nWork-Run: run-1\nWork-Receipt: g1-r0',
      ]);
    }
    write(root, `src/change-${receiptName}.mjs`, `export const changed = '${receiptName}';\n`);
    git(root, ['add', '.']);
    git(root, [
      'commit',
      '--quiet',
      '-m',
      `feat: change\n\nWork-Run: run-1\nWork-Receipt: ${receiptName}`,
    ]);
    const headCommit = git(root, ['rev-parse', 'HEAD']);
    topicSeeds.set(receiptName, {
      root,
      baseCommit,
      headCommit,
      commitTime: Date.parse(git(root, ['show', '-s', '--format=%cI', headCommit])),
      receiptIdentity: currentReceiptIdentity(root, baseCommit),
      authorizationHead,
    });
  }
});

afterAll(() => {
  if (seedOwner) rmSync(seedOwner, { recursive: true, force: true });
});

afterEach(() => {
  while (fixtureRoots.length > 0) rmSync(fixtureRoots.pop(), { recursive: true, force: true });
});

function git(root, args) {
  return execFileSync('git', [...GIT_TEST_CONFIG, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
  }).trim();
}

function write(root, file, content) {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function rawPatchDigest(root, base, head) {
  const patch = execFileSync('git', ['diff', '--binary', `${base}..${head}`], { cwd: root });
  return createHash('sha256').update(patch).digest('hex');
}

function receiptEvents({
  runId = 'run-1',
  disposition = 'included',
  generation = 0,
  revision = 0,
  claimedAt = '2000-01-01T00:00:00.000Z',
  authorization,
  rebaseProof,
}) {
  let second = 0;
  const nextAt = () => {
    second += 1;
    return new Date(Date.parse(claimedAt) + second * 1000).toISOString();
  };
  let run = createInitialWorkRun({ runId, at: claimedAt, branch: 'codex/work' });
  run = appendWorkRunEvent(run, {
    type: 'work.bound',
    at: nextAt(),
    data: { workId: 'OBSERVABILITY-002', lane: 'L2', workKind: 'harness' },
  });
  if (disposition === 'excluded') {
    return appendWorkRunEvent(run, {
      type: 'work.excluded',
      at: nextAt(),
      data: { reason: 'pure-planning-range' },
    }).events;
  }
  run = appendWorkRunEvent(run, { type: 'work.started', at: nextAt() });
  run = appendWorkRunEvent(run, {
    type: 'work.ready',
    at: nextAt(),
    data: { generation: 0, revision: 0 },
  });
  for (let currentGeneration = 0; currentGeneration <= generation; currentGeneration += 1) {
    const firstRevision = 1;
    const lastRevision = currentGeneration === generation ? revision : 0;
    if (currentGeneration > 0) {
      run = appendWorkRunEvent(run, {
        type: 'work.reopened',
        at: nextAt(),
        data: {
          generation: currentGeneration,
          revision: 0,
          ground: authorization?.ground ?? 'finding',
          ...(authorization ? { authorization } : {}),
          ...(authorization?.ground === 'rebase' && currentGeneration === generation
            ? { rebaseProof }
            : {}),
        },
      });
      run = appendWorkRunEvent(run, {
        type: 'work.ready',
        at: nextAt(),
        data: { generation: currentGeneration, revision: 0 },
      });
    }
    for (
      let currentRevision = firstRevision;
      currentRevision <= lastRevision;
      currentRevision += 1
    ) {
      const postPrRevision = currentGeneration > 0;
      run = appendWorkRunEvent(run, {
        type: 'work.reopened',
        at: nextAt(),
        data: {
          generation: currentGeneration,
          revision: currentRevision,
          ground: postPrRevision ? authorization?.ground : 'local-fix',
          ...(postPrRevision ? { authorization } : {}),
        },
      });
      run = appendWorkRunEvent(run, {
        type: 'work.ready',
        at: nextAt(),
        data: { generation: currentGeneration, revision: currentRevision },
      });
    }
  }
  return run.events;
}

function trustedAuthorization(overrides = {}) {
  return {
    prNumber: 42,
    head: 'a'.repeat(40),
    verdict: 3,
    action: 'push',
    ground: 'finding',
    evidence: 'https://github.com/woojubb/robota/pull/42#discussion_r1',
    scope: 'address finding',
    approvedBy: '@woojubb',
    commentId: 10,
    commentUrl: 'https://github.com/woojubb/robota/pull/42#issuecomment-10',
    commentAuthor: 'woojubb',
    commentAuthorAssociation: 'OWNER',
    ...overrides,
  };
}

function receiptProjection(events) {
  const state = reduceWorkRun(events);
  return {
    durations: projectWorkRunDurations(events),
    cohort: {
      key: cohortKey(state),
      lane: state.lane,
      workKind: state.workKind,
    },
  };
}

function currentReceiptIdentity(root, baseCommit) {
  const headCommit = git(root, ['rev-parse', 'HEAD']);
  return {
    repository: 'woojubb/robota',
    branch: 'codex/work',
    baseCommit,
    headCommit,
    headTree: git(root, ['rev-parse', 'HEAD^{tree}']),
    commitOids: git(root, ['rev-list', '--reverse', `${baseCommit}..HEAD`]).split('\n'),
    trailerDigest: createHash('sha256')
      .update(git(root, ['log', '--format=%H%x00%B%x00', `${baseCommit}..${headCommit}`]))
      .digest('hex'),
    ownerFingerprint: createHash('sha256')
      .update(readFileSync(path.join(root, 'scripts/harness/work-run-contract.mjs')))
      .digest('hex'),
  };
}

function repositoryFixture({
  disposition = 'included',
  generation = 0,
  revision = 0,
  claimedAt,
  claimOffsetMs,
  authorization,
} = {}) {
  const receiptName = `g${generation}-r${revision}`;
  const seed = topicSeeds.get(receiptName);
  if (!seed) throw new Error(`missing immutable topic seed for ${receiptName}`);
  const fixtureOwner = makeTemp('robota-work-run-validation-');
  fixtureRoots.push(fixtureOwner);
  const root = path.join(fixtureOwner, 'repo');
  cpSync(seed.root, root, { recursive: true, verbatimSymlinks: true });
  const { baseCommit, headCommit } = seed;
  const effectiveAuthorization =
    generation > 0 && authorization
      ? { ...authorization, head: seed.authorizationHead }
      : authorization;
  const effectiveClaimedAt =
    claimOffsetMs === undefined
      ? claimedAt
      : new Date(seed.commitTime + claimOffsetMs).toISOString();
  const receiptIdentity = structuredClone(seed.receiptIdentity);
  const receiptPath = `.agents/evals/work-runs/run-1/${receiptName}.json`;
  const events = receiptEvents({
    disposition,
    generation,
    revision,
    claimedAt: effectiveClaimedAt,
    authorization: effectiveAuthorization,
  });
  write(
    root,
    receiptPath,
    `${JSON.stringify({
      schemaVersion: 1,
      disposition,
      runId: 'run-1',
      generation,
      revision,
      identity: receiptIdentity,
      events,
      ...receiptProjection(events),
      ...(disposition === 'excluded' ? { reason: events.at(-1).data.reason } : {}),
      ...(generation > 0
        ? {
            ground: effectiveAuthorization?.ground ?? 'finding',
            authorization: effectiveAuthorization,
          }
        : {}),
      timestamps:
        disposition === 'excluded'
          ? { claimedAt: events[0].at, excludedAt: events.at(-1).at }
          : { claimedAt: events[0].at, readyAt: events.at(-1).at },
    })}\n`,
  );
  return {
    root,
    baseCommit,
    headCommit,
    receiptPath,
    receiptIdentity,
    receiptName,
    authorization: effectiveAuthorization,
  };
}

function commitClosure(fixture) {
  git(fixture.root, ['add', fixture.receiptPath]);
  git(fixture.root, [
    'commit',
    '-m',
    `chore: close work run\n\nWork-Run: run-1\nWork-Receipt: ${fixture.receiptName}`,
  ]);
  return git(fixture.root, ['rev-parse', 'HEAD']);
}

function pullRequestEvidence(fixture, currentHeadOid) {
  const receiptPath = '.agents/evals/work-runs/run-1/g0-r0.json';
  const firstHeadOid = git(fixture.root, [
    'log',
    '-1',
    '--format=%H',
    '--diff-filter=A',
    '--',
    receiptPath,
  ]);
  const receiptBytes = execFileSync('git', ['show', `${firstHeadOid}:${receiptPath}`], {
    cwd: fixture.root,
  });
  return {
    status: 'found',
    number: 42,
    runId: 'run-1',
    forcePushEdges: [],
    firstHeadOid,
    currentHeadOid,
    openingReceiptDigest: createHash('sha256').update(receiptBytes).digest('hex'),
  };
}

function historicalRebaseSuffixFixture({
  bindMessage = 'chore: bind rebased generation\n\nWork-Run: run-1\nWork-Receipt: g1-r0',
  closureMessage = 'chore: close rebased generation\n\nWork-Run: run-1\nWork-Receipt: g1-r0',
  mergeBind = false,
  mutateReceipt = (receipt) => receipt,
  mutateRetainedBytes = false,
} = {}) {
  const fixture = repositoryFixture();
  rmSync(path.join(fixture.root, fixture.receiptPath), { force: true });
  const oldHead = fixture.headCommit;
  git(fixture.root, ['switch', 'develop']);
  write(fixture.root, 'base/rebase-suffix.txt', 'new base\n');
  git(fixture.root, ['add', 'base/rebase-suffix.txt']);
  git(fixture.root, ['commit', '-m', 'chore: advance rebase suffix base']);
  const newBase = git(fixture.root, ['rev-parse', 'HEAD']);
  if (mergeBind) {
    git(fixture.root, ['switch', '-c', 'test/rebase-bind-parent']);
    git(fixture.root, ['commit', '--allow-empty', '-m', 'test: second bind parent']);
  }
  git(fixture.root, ['switch', 'codex/work']);
  git(fixture.root, ['rebase', 'develop']);
  const newHead = git(fixture.root, ['rev-parse', 'HEAD']);
  const proof = createRebaseProof(fixture.root, 'develop', oldHead, newHead);
  if (mergeBind) {
    git(fixture.root, ['merge', '--no-ff', 'test/rebase-bind-parent', '-m', bindMessage]);
  } else {
    git(fixture.root, ['commit', '--allow-empty', '-m', bindMessage]);
  }
  const authorization = trustedAuthorization({
    action: 'rebase',
    ground: 'rebase',
    head: oldHead,
  });
  const events = receiptEvents({ generation: 1, authorization, rebaseProof: proof });
  const receiptPath = '.agents/evals/work-runs/run-1/g1-r0.json';
  const receipt = mutateReceipt({
    schemaVersion: 1,
    disposition: 'included',
    runId: 'run-1',
    generation: 1,
    revision: 0,
    ground: 'rebase',
    authorization,
    identity: currentReceiptIdentity(fixture.root, newBase),
    events,
    ...receiptProjection(events),
    timestamps: { claimedAt: events[0].at, readyAt: events.at(-1).at },
  });
  write(fixture.root, receiptPath, `${JSON.stringify(receipt)}\n`);
  git(fixture.root, ['add', receiptPath]);
  git(fixture.root, ['commit', '-m', closureMessage]);
  const edgeAfter = git(fixture.root, ['rev-parse', 'HEAD']);
  let subjectCommit = edgeAfter;
  if (mutateRetainedBytes) {
    write(fixture.root, receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    git(fixture.root, ['add', receiptPath]);
    git(fixture.root, [
      'commit',
      '-m',
      'test: alter retained bytes\n\nWork-Run: run-1\nWork-Receipt: g1-r1',
    ]);
    subjectCommit = git(fixture.root, ['rev-parse', 'HEAD']);
  }
  return { root: fixture.root, subjectCommit, currentReceipt: receipt, edgeAfter, proof };
}

function changeReceiptIdentity(fixture, field, value) {
  const receiptFile = path.join(fixture.root, fixture.receiptPath);
  const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
  receipt.identity[field] = value;
  writeFileSync(receiptFile, `${JSON.stringify(receipt)}\n`);
}

describe('work-run validation', () => {
  it('is RED for a topic range with missing measurement', () => {
    expect(
      validateWorkRunMeasurement({
        operation: 'content',
        protectedBranch: false,
        changedPaths: ['docs/guide.md'],
        identity,
        receipts: [],
      }),
    ).toEqual(expect.objectContaining({ ok: false, reason: 'missing-measurement' }));
  });

  it('accepts exact included and state-lost identities but rejects mixed or stale receipts', () => {
    const events = receiptEvents({});
    const included = {
      schemaVersion: 1,
      disposition: 'included',
      runId: 'run-1',
      generation: 0,
      revision: 0,
      identity,
      events,
      ...receiptProjection(events),
      timestamps: { claimedAt: events[0].at, readyAt: events.at(-1).at },
    };
    expect(
      validateWorkRunMeasurement({
        operation: 'content',
        protectedBranch: false,
        changedPaths: ['scripts/a.mjs'],
        identity,
        receipts: [included],
      }),
    ).toEqual(expect.objectContaining({ ok: true, population: 'included' }));
    expect(
      validateWorkRunMeasurement({
        operation: 'content',
        protectedBranch: false,
        changedPaths: ['docs/a.md'],
        identity,
        receipts: [
          {
            schemaVersion: 1,
            disposition: 'invalid',
            reason: 'state-lost',
            runId: 'run-1',
            generation: 0,
            revision: 0,
            identity,
            timestamps: { claimedAt: null, readyAt: null },
          },
        ],
      }),
    ).toEqual(expect.objectContaining({ ok: true, population: 'invalid' }));
    expect(
      validateWorkRunMeasurement({
        operation: 'content',
        protectedBranch: false,
        changedPaths: ['docs/a.md'],
        identity,
        receipts: [included, { ...included, runId: 'run-2' }],
      }).ok,
    ).toBe(false);
    expect(
      validateWorkRunMeasurement({
        operation: 'content',
        protectedBranch: false,
        changedPaths: ['docs/a.md'],
        identity,
        receipts: [{ ...included, identity: { ...identity, headCommit: 'x'.repeat(40) } }],
      }).reason,
    ).toBe('identity-mismatch');
  });

  it('rejects every invalid receipt except the exact state-lost recovery schema', () => {
    const validStateLost = {
      schemaVersion: 1,
      disposition: 'invalid',
      reason: 'state-lost',
      runId: 'run-1',
      generation: 0,
      revision: 0,
      identity,
      timestamps: { claimedAt: null, readyAt: null },
    };
    expect(validateWorkRunReceipt(validStateLost).ok).toBe(true);
    expect(validateWorkRunReceipt({ ...validStateLost, reason: 'manual-bypass' })).toEqual({
      ok: false,
      reason: 'malformed-receipt',
    });
    expect(validateWorkRunReceipt({ ...validStateLost, cohort: { key: 'L2/harness' } })).toEqual({
      ok: false,
      reason: 'malformed-receipt',
    });
    expect(validateWorkRunReceipt({ ...validStateLost, identity: null })).toEqual({
      ok: false,
      reason: 'malformed-receipt',
    });
  });

  it('rejects unowned report-derived fields from raw included receipts', () => {
    const events = receiptEvents({});
    const receipt = {
      schemaVersion: 1,
      disposition: 'included',
      runId: 'run-1',
      generation: 0,
      revision: 0,
      identity,
      events,
      ...receiptProjection(events),
      timestamps: { claimedAt: events[0].at, readyAt: events.at(-1).at },
      timeToFirstPrMs: 1,
    };

    expect(validateWorkRunReceipt(receipt)).toEqual({
      ok: false,
      reason: 'malformed-receipt',
    });
  });

  it('distinguishes introduction, registered pre-cutover and post-cutover branches', () => {
    const marker = {
      schemaVersion: CUTOVER_SCHEMA_VERSION,
      repository: 'woojubb/robota',
      markerId: 'work-run-v1',
      openPullRequests: [
        { number: 7, createdAt: '2026-08-29T00:00:00Z', baseOid: 'b', headOid: 'h' },
      ],
    };
    expect(validateCutoverDisposition({ marker, mode: 'introduction' }).ok).toBe(true);
    expect(validateCutoverDisposition({ marker, mode: 'registered', prNumber: 7 }).ok).toBe(true);
    expect(validateCutoverDisposition({ marker, mode: 'registered', prNumber: 8 }).reason).toBe(
      'unregistered-pre-cutover-pr',
    );
    expect(
      validateCutoverDisposition({
        marker,
        mode: 'post-cutover',
        receipt: { disposition: 'pre-cutover' },
      }).ok,
    ).toBe(false);
  });

  it('rejects generic pre-cutover receipts until the registry validator binds them', () => {
    expect(
      validateWorkRunReceipt(
        { schemaVersion: 1, disposition: 'pre-cutover', runId: 'forged' },
        { receiptPath: '.agents/evals/work-runs/forged/g999-r999.json' },
      ),
    ).toEqual({ ok: false, reason: 'pre-cutover-requires-registry' });
  });

  it('rejects a closure commit that adds the receipt and another path', () => {
    const fixture = repositoryFixture();
    write(fixture.root, 'unexpected.txt', 'extra\n');
    git(fixture.root, ['add', '.']);
    git(fixture.root, ['commit', '-m', 'chore: close work run']);

    expect(validateRepositoryWorkRun({ root: fixture.root, baseRef: fixture.baseCommit })).toEqual({
      ok: false,
      reason: 'invalid-closure-commit',
    });
  });

  it('accepts exactly one child commit that adds only its bound receipt', () => {
    const fixture = repositoryFixture();
    commitClosure(fixture);
    let authorizationFetches = 0;

    expect(
      validateRepositoryWorkRun({
        root: fixture.root,
        baseRef: fixture.baseCommit,
        fetchAuthorization: () => {
          authorizationFetches += 1;
          throw new Error('generation zero must stay offline');
        },
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });
    expect(authorizationFetches).toBe(0);
  });

  it('fails closed deterministically when the shared command budget is exhausted', () => {
    const fixture = repositoryFixture();
    commitClosure(fixture);

    expect(
      validateRepositoryWorkRun({
        root: fixture.root,
        baseRef: fixture.baseCommit,
        runtime: createWorkRunVerificationRuntime({ commandBudget: 0 }),
      }),
    ).toEqual({
      ok: false,
      reason: 'verification-budget-exhausted',
      detail: 'work-run verification command budget exhausted',
    });
  });

  it('validates a historical subject without inspecting current worktree cleanliness', () => {
    const fixture = repositoryFixture();
    const subjectRef = commitClosure(fixture);
    write(fixture.root, 'local-diagnostic.txt', 'must not affect historical validation\n');

    expect(
      validateRepositoryWorkRun({
        root: fixture.root,
        baseRef: fixture.baseCommit,
        subjectRef,
        subjectBranch: 'codex/work',
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });
  });

  it('validates an explicit PR head ref and branch instead of synthetic merge HEAD', () => {
    const fixture = repositoryFixture();
    const subjectRef = commitClosure(fixture);
    git(fixture.root, ['switch', 'develop']);
    write(fixture.root, 'base-advance.txt', 'base advance\n');
    git(fixture.root, ['add', 'base-advance.txt']);
    git(fixture.root, ['commit', '-m', 'chore: advance integration base']);
    git(fixture.root, ['merge', '--no-ff', subjectRef, '-m', 'merge: synthetic PR checkout']);

    expect(
      validateRepositoryWorkRun({
        root: fixture.root,
        baseRef: fixture.baseCommit,
        subjectRef,
        subjectBranch: 'codex/work',
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });
  });

  it('rejects malformed event chains, receipt paths, and late claims', () => {
    const malformed = repositoryFixture();
    const malformedFile = path.join(malformed.root, malformed.receiptPath);
    const malformedReceipt = JSON.parse(readFileSync(malformedFile, 'utf8'));
    malformedReceipt.events[1].hash = '0'.repeat(64);
    writeFileSync(malformedFile, `${JSON.stringify(malformedReceipt)}\n`);
    commitClosure(malformed);
    expect(
      validateRepositoryWorkRun({ root: malformed.root, baseRef: malformed.baseCommit }),
    ).toEqual({ ok: false, reason: 'malformed-receipt' });

    const wrongPath = repositoryFixture();
    const wrongPathName = '.agents/evals/work-runs/run-1/g0-r7.json';
    renameSync(
      path.join(wrongPath.root, wrongPath.receiptPath),
      path.join(wrongPath.root, wrongPathName),
    );
    wrongPath.receiptPath = wrongPathName;
    commitClosure(wrongPath);
    expect(
      validateRepositoryWorkRun({ root: wrongPath.root, baseRef: wrongPath.baseCommit }),
    ).toEqual({ ok: false, reason: 'receipt-path-mismatch' });

    const late = repositoryFixture({ claimedAt: '2099-01-01T00:00:00.000Z' });
    commitClosure(late);
    expect(validateRepositoryWorkRun({ root: late.root, baseRef: late.baseCommit })).toEqual({
      ok: false,
      reason: 'late-claim',
    });
  });

  it('compares claims with Git commit timestamps at seconds precision', () => {
    const sameSecond = repositoryFixture({ claimOffsetMs: 500 });
    commitClosure(sameSecond);
    expect(
      validateRepositoryWorkRun({ root: sameSecond.root, baseRef: sameSecond.baseCommit }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });

    const nextSecond = repositoryFixture({ claimOffsetMs: 1_000 });
    commitClosure(nextSecond);
    expect(
      validateRepositoryWorkRun({ root: nextSecond.root, baseRef: nextSecond.baseCommit }),
    ).toEqual({ ok: false, reason: 'late-claim' });
  });

  it('accepts a terminal exclusion', () => {
    const excluded = repositoryFixture({ disposition: 'excluded' });
    commitClosure(excluded);
    expect(
      validateRepositoryWorkRun({ root: excluded.root, baseRef: excluded.baseCommit }),
    ).toEqual({ ok: true, population: 'excluded', runId: 'run-1' });
  });

  it('accepts state-lost PR evidence without dereferencing absent events', () => {
    const fixture = repositoryFixture();
    const receiptFile = path.join(fixture.root, fixture.receiptPath);
    const original = JSON.parse(readFileSync(receiptFile, 'utf8'));
    writeFileSync(
      receiptFile,
      `${JSON.stringify({
        schemaVersion: 1,
        disposition: 'invalid',
        reason: 'state-lost',
        runId: 'run-1',
        generation: 0,
        revision: 0,
        identity: original.identity,
        timestamps: { claimedAt: null, readyAt: null },
      })}\n`,
    );
    const currentHead = commitClosure(fixture);

    expect(
      validateRepositoryWorkRun({
        root: fixture.root,
        baseRef: fixture.baseCommit,
        currentPrNumber: 42,
        fetchPullRequestEvidence: () => pullRequestEvidence(fixture, currentHead),
      }),
    ).toEqual({ ok: true, population: 'invalid', runId: 'run-1' });
  });

  it('rejects a structurally forged post-PR authorization without a live request', () => {
    const forged = repositoryFixture({
      generation: 1,
      authorization: trustedAuthorization({ commentAuthorAssociation: 'NONE' }),
    });
    commitClosure(forged);
    expect(validateRepositoryWorkRun({ root: forged.root, baseRef: forged.baseCommit })).toEqual({
      ok: false,
      reason: 'invalid-post-pr-authorization',
    });
  });

  it('rejects association-only approvals from non-maintainer repository users', () => {
    for (const commentAuthorAssociation of ['MEMBER', 'COLLABORATOR']) {
      const forged = repositoryFixture({
        generation: 1,
        authorization: trustedAuthorization({
          approvedBy: '@org-member',
          commentAuthor: 'org-member',
          commentAuthorAssociation,
        }),
      });
      commitClosure(forged);
      expect(validateRepositoryWorkRun({ root: forged.root, baseRef: forged.baseCommit })).toEqual({
        ok: false,
        reason: 'invalid-post-pr-authorization',
      });
    }
  });

  it('requires the exact live GitHub comment for post-PR authorization', () => {
    const authorized = repositoryFixture({
      generation: 1,
      authorization: trustedAuthorization(),
    });
    const currentHead = commitClosure(authorized);
    const prEvidence = pullRequestEvidence(authorized, currentHead);
    const runtime = createWorkRunVerificationRuntime();
    const authorizationRequests = [];
    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 42,
        runtime,
        fetchAuthorization: ({ repository, commentId, authorizedAt, runtime: observedRuntime }) => {
          expect(repository).toBe('woojubb/robota');
          expect(commentId).toBe(10);
          expect(observedRuntime).toBe(runtime);
          authorizationRequests.push(authorizedAt);
          return authorized.authorization;
        },
        fetchPullRequestEvidence: ({ runtime: observedRuntime }) => {
          expect(observedRuntime).toBe(runtime);
          return prEvidence;
        },
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });
    const workBoundary = JSON.parse(
      readFileSync(path.join(authorized.root, authorized.receiptPath), 'utf8'),
    ).events.find((event) => event.type === 'work.reopened' && event.data.generation === 1).at;
    expect(authorizationRequests).not.toContain(null);
    expect(authorizationRequests).not.toContain(undefined);
    expect(authorizationRequests).toEqual(authorizationRequests.map(() => workBoundary));

    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 42,
        fetchAuthorization: () => ({
          ...authorized.authorization,
          scope: 'different live scope',
        }),
        fetchPullRequestEvidence: () => prEvidence,
      }),
    ).toEqual({ ok: false, reason: 'authorization-comment-mismatch' });

    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 42,
        fetchAuthorization: () => {
          throw new Error('offline');
        },
        fetchPullRequestEvidence: () => prEvidence,
      }),
    ).toEqual({ ok: false, reason: 'authorization-comment-unverified' });
  });

  it('batch-fetches repository authorizations once and reuses them across validation stages', () => {
    const authorized = repositoryFixture({
      generation: 1,
      authorization: trustedAuthorization(),
    });
    const currentHead = commitClosure(authorized);
    const fetchAuthorizations = vi.fn(({ requests }) => {
      expect(requests).toEqual([
        expect.objectContaining({ commentId: authorized.authorization.commentId }),
      ]);
      return [authorized.authorization];
    });

    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 42,
        fetchAuthorizations,
        fetchAuthorization: () => {
          throw new Error('single-comment fetch must not run');
        },
        fetchPullRequestEvidence: () => pullRequestEvidence(authorized, currentHead),
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });
    expect(fetchAuthorizations).toHaveBeenCalledTimes(1);
  });

  it('accepts a normally pushed later generation when its live authorization is valid', () => {
    const authorized = repositoryFixture({
      generation: 1,
      authorization: trustedAuthorization(),
    });
    const currentHead = commitClosure(authorized);
    const prEvidence = pullRequestEvidence(authorized, currentHead);
    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 42,
        fetchAuthorization: () => authorized.authorization,
        fetchPullRequestEvidence: () => prEvidence,
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });

    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 42,
        prObservation: 'pre-push',
        fetchAuthorization: () => authorized.authorization,
        fetchPullRequestEvidence: () => ({
          ...prEvidence,
          currentHeadOid: authorized.authorization.head,
        }),
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });

    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 42,
        fetchAuthorization: () => authorized.authorization,
        fetchPullRequestEvidence: () => ({
          ...prEvidence,
          currentHeadOid: authorized.authorization.head,
        }),
      }),
    ).toEqual({ ok: false, reason: 'post-pr-local-fix' });

    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 42,
        fetchAuthorization: () => authorized.authorization,
        fetchPullRequestEvidence: () => ({
          ...prEvidence,
          firstHeadOid: authorized.baseCommit,
          forcePushEdges: [{ before: authorized.authorization.head, after: currentHead }],
        }),
      }),
    ).toEqual({ ok: false, reason: 'post-pr-local-fix' });
  });

  it('rejects authorized g1 when the PR opened at A before a late forged g0 at B', () => {
    const authorized = repositoryFixture({
      generation: 1,
      authorization: trustedAuthorization(),
    });
    const currentHeadC = commitClosure(authorized);
    const prEvidence = pullRequestEvidence(authorized, currentHeadC);
    const lateGenerationZeroB = prEvidence.firstHeadOid;
    const openedWithoutGenerationZeroA = git(authorized.root, [
      'rev-parse',
      `${lateGenerationZeroB}^`,
    ]);

    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 42,
        fetchAuthorization: () => authorized.authorization,
        fetchPullRequestEvidence: () => ({
          ...prEvidence,
          firstHeadOid: openedWithoutGenerationZeroA,
        }),
      }),
    ).toEqual({ ok: false, reason: 'post-pr-local-fix' });
  });

  it('binds post-PR authorization to the current PR and action-ground relation', () => {
    const authorized = repositoryFixture({
      generation: 1,
      authorization: trustedAuthorization(),
    });
    const authorization = authorized.authorization;
    commitClosure(authorized);
    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        fetchAuthorization: () => authorization,
      }),
    ).toEqual({ ok: false, reason: 'current-pr-required' });
    expect(
      validateRepositoryWorkRun({
        root: authorized.root,
        baseRef: authorized.baseCommit,
        currentPrNumber: 99,
        fetchAuthorization: () => authorization,
      }),
    ).toEqual({ ok: false, reason: 'authorization-pr-mismatch' });

    const mismatched = trustedAuthorization({ action: 'rebase', ground: 'finding' });
    const events = receiptEvents({ generation: 1, authorization: mismatched });
    expect(
      validateWorkRunReceipt({
        schemaVersion: 1,
        disposition: 'included',
        runId: 'run-1',
        generation: 1,
        revision: 0,
        ground: mismatched.ground,
        authorization: mismatched,
        events,
        ...receiptProjection(events),
        timestamps: { claimedAt: events[0].at, readyAt: events.at(-1).at },
      }),
    ).toEqual({ ok: false, reason: 'invalid-post-pr-authorization' });
  });

  it('binds generation zero to authoritative first-PR-head evidence', () => {
    const initialAtPrOpen = repositoryFixture();
    const initialClosure = commitClosure(initialAtPrOpen);
    expect(
      validateRepositoryWorkRun({
        root: initialAtPrOpen.root,
        baseRef: initialAtPrOpen.baseCommit,
        currentPrNumber: 42,
        fetchPullRequestEvidence: () => pullRequestEvidence(initialAtPrOpen, initialClosure),
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });

    const afterPr = repositoryFixture({ generation: 0, revision: 1 });
    const revisedClosure = commitClosure(afterPr);
    const firstPrHead = git(afterPr.root, [
      'rev-list',
      '--reverse',
      `${afterPr.baseCommit}..${revisedClosure}`,
    ]).split('\n')[1];
    expect(
      validateRepositoryWorkRun({
        root: afterPr.root,
        baseRef: afterPr.baseCommit,
        currentPrNumber: 42,
        fetchPullRequestEvidence: () => ({
          ...pullRequestEvidence(afterPr, revisedClosure),
          firstHeadOid: firstPrHead,
        }),
      }),
    ).toEqual({ ok: false, reason: 'post-pr-local-fix' });
  });

  it('distinguishes authoritative no-PR from pull-request lookup failure', () => {
    const noPr = repositoryFixture({ generation: 0, revision: 1 });
    commitClosure(noPr);
    expect(
      validateRepositoryWorkRun({
        root: noPr.root,
        baseRef: noPr.baseCommit,
        fetchPullRequestEvidence: () => ({ status: 'not-found' }),
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });

    const failed = repositoryFixture();
    commitClosure(failed);
    expect(
      validateRepositoryWorkRun({
        root: failed.root,
        baseRef: failed.baseCommit,
        fetchPullRequestEvidence: () => {
          throw new Error('GitHub unavailable');
        },
      }),
    ).toMatchObject({ ok: false, reason: 'pr-context-unverified' });
  });

  it.each([
    ['trailing spaces', 'value   \n'],
    ['missing EOF newline', 'value'],
    ['binary payload', Buffer.from('\0binary payload')],
  ])('hashes exact --binary patch bytes for %s', (_label, payload) => {
    const fixture = repositoryFixture();
    write(fixture.root, 'zz-raw-patch/payload.bin', payload);
    git(fixture.root, ['add', 'zz-raw-patch/payload.bin']);
    git(fixture.root, ['commit', '-m', 'test: add raw patch payload']);
    const oldHead = git(fixture.root, ['rev-parse', 'HEAD']);
    git(fixture.root, ['switch', 'develop']);
    write(fixture.root, 'base/raw-patch.txt', 'advance base\n');
    git(fixture.root, ['add', 'base/raw-patch.txt']);
    git(fixture.root, ['commit', '-m', 'chore: advance raw patch base']);
    const newBase = git(fixture.root, ['rev-parse', 'HEAD']);
    git(fixture.root, ['switch', 'codex/work']);
    git(fixture.root, ['rebase', 'develop']);
    const newHead = git(fixture.root, ['rev-parse', 'HEAD']);
    const proof = createRebaseProof(fixture.root, 'develop', oldHead, newHead);
    const expectedDigest = rawPatchDigest(fixture.root, fixture.baseCommit, oldHead);
    const receipt = {
      authorization: { head: oldHead },
      generation: 1,
      events: [
        {
          type: 'work.reopened',
          data: { generation: 1, revision: 0, rebaseProof: proof },
        },
      ],
    };
    expect(proof).toMatchObject({ oldBase: fixture.baseCommit, patchDigest: expectedDigest });
    expect(rebaseProofMatches(fixture.root, receipt, newHead, newBase)).toBe(true);
  });

  it('fails closed when rebase proof objects disappear or oldBase is not the merge-base', () => {
    const fixture = repositoryFixture();
    const oldBase = fixture.baseCommit;
    const oldHead = fixture.headCommit;
    git(fixture.root, ['switch', 'develop']);
    write(fixture.root, 'base/rebase-proof.txt', 'new base\n');
    git(fixture.root, ['add', 'base/rebase-proof.txt']);
    git(fixture.root, ['commit', '-m', 'chore: advance base']);
    const newBase = git(fixture.root, ['rev-parse', 'HEAD']);
    git(fixture.root, ['switch', 'codex/work']);
    git(fixture.root, ['rebase', 'develop']);
    const newHead = git(fixture.root, ['rev-parse', 'HEAD']);
    const patchDigest = rawPatchDigest(fixture.root, oldBase, oldHead);
    const receipt = {
      authorization: { head: oldHead },
      generation: 1,
      events: [
        {
          type: 'work.reopened',
          data: {
            generation: 1,
            revision: 0,
            rebaseProof: { oldBase, oldHead, newBase, newHead, patchDigest },
          },
        },
      ],
    };
    expect(rebaseProofMatches(fixture.root, receipt, newHead, newBase)).toBe(true);
    expect(() =>
      rebaseProofMatches(
        fixture.root,
        receipt,
        newHead,
        newBase,
        createWorkRunVerificationRuntime({ commandBudget: 1 }),
      ),
    ).toThrow('work-run verification command budget exhausted');
    expect(
      rebaseProofMatches(
        fixture.root,
        {
          ...receipt,
          authorization: { head: 'f'.repeat(40) },
          events: [
            {
              ...receipt.events[0],
              data: {
                ...receipt.events[0].data,
                rebaseProof: {
                  ...receipt.events[0].data.rebaseProof,
                  oldHead: 'f'.repeat(40),
                },
              },
            },
          ],
        },
        newHead,
        newBase,
      ),
    ).toBe(false);
    expect(
      rebaseProofMatches(
        fixture.root,
        {
          ...receipt,
          events: [
            {
              ...receipt.events[0],
              data: {
                ...receipt.events[0].data,
                rebaseProof: { ...receipt.events[0].data.rebaseProof, oldBase: newBase },
              },
            },
          ],
        },
        newHead,
        newBase,
      ),
    ).toBe(false);
  });

  it('accepts only a complete historical rebase bind and receipt-only closure', () => {
    const fixture = historicalRebaseSuffixFixture();
    expect(historicalRebaseSuffixMatches({ ...fixture, generation: 1 })).toBe(true);
  });

  it.each([
    ['a merge bind commit', { mergeBind: true }],
    [
      'duplicate bind trailers',
      {
        bindMessage:
          'chore: bind rebased generation\n\nWork-Run: run-1\nWork-Run: forged\nWork-Receipt: g1-r0',
      },
    ],
    [
      'duplicate closure trailers',
      {
        closureMessage:
          'chore: close rebased generation\n\nWork-Run: run-1\nWork-Receipt: g1-r0\nWork-Receipt: g9-r9',
      },
    ],
    [
      'nonterminal bind trailers',
      {
        bindMessage:
          'chore: bind rebased generation\n\nWork-Run: run-1\nWork-Receipt: g1-r0\n\ntrailing prose',
      },
    ],
    [
      'nonterminal closure trailers',
      {
        closureMessage:
          'chore: close rebased generation\n\nWork-Run: run-1\nWork-Receipt: g1-r0\n\ntrailing prose',
      },
    ],
    [
      'an incomplete receipt schema',
      { mutateReceipt: (receipt) => ({ ...receipt, durations: undefined }) },
    ],
    [
      'a forged receipt identity',
      {
        mutateReceipt: (receipt) => ({
          ...receipt,
          identity: { ...receipt.identity, headCommit: 'f'.repeat(40) },
        }),
      },
    ],
    ['retained receipt bytes that differ', { mutateRetainedBytes: true }],
  ])('rejects historical rebase suffix laundering through %s', (_label, options) => {
    const fixture = historicalRebaseSuffixFixture(options);
    expect(historicalRebaseSuffixMatches({ ...fixture, generation: 1 })).toBe(false);
  });

  it('uses disposition-specific terminal timestamps without accepting fabricated fields', () => {
    const includedEvents = receiptEvents({});
    const included = {
      schemaVersion: 1,
      disposition: 'included',
      runId: 'run-1',
      generation: 0,
      revision: 0,
      events: includedEvents,
      ...receiptProjection(includedEvents),
      timestamps: {
        claimedAt: includedEvents[0].at,
        readyAt: includedEvents.at(-1).at,
      },
    };
    expect(validateWorkRunReceipt(included).ok).toBe(true);
    expect(
      validateWorkRunReceipt({
        ...included,
        timestamps: { ...included.timestamps, excludedAt: includedEvents.at(-1).at },
      }),
    ).toEqual({ ok: false, reason: 'malformed-receipt' });

    const excludedEvents = receiptEvents({ disposition: 'excluded' });
    const excluded = {
      schemaVersion: 1,
      disposition: 'excluded',
      reason: excludedEvents.at(-1).data.reason,
      runId: 'run-1',
      generation: 0,
      revision: 0,
      events: excludedEvents,
      ...receiptProjection(excludedEvents),
      timestamps: {
        claimedAt: excludedEvents[0].at,
        excludedAt: excludedEvents.at(-1).at,
      },
    };
    expect(validateWorkRunReceipt(excluded).ok).toBe(true);
    expect(validateWorkRunReceipt({ ...excluded, reason: 'forged' })).toEqual({
      ok: false,
      reason: 'malformed-receipt',
    });
    expect(
      validateWorkRunReceipt({
        ...excluded,
        timestamps: { ...excluded.timestamps, readyAt: excludedEvents.at(-1).at },
      }),
    ).toEqual({ ok: false, reason: 'malformed-receipt' });
  });

  it('rejects missing or fabricated duration and cohort projections', () => {
    const events = receiptEvents({});
    const projection = receiptProjection(events);
    const receipt = {
      schemaVersion: 1,
      disposition: 'included',
      runId: 'run-1',
      generation: 0,
      revision: 0,
      events,
      ...projection,
      timestamps: { claimedAt: events[0].at, readyAt: events.at(-1).at },
    };
    expect(validateWorkRunReceipt(receipt).ok).toBe(true);
    expect(validateWorkRunReceipt({ ...receipt, durations: undefined })).toEqual({
      ok: false,
      reason: 'malformed-receipt',
    });
    expect(
      validateWorkRunReceipt({
        ...receipt,
        durations: { ...projection.durations, wallMs: projection.durations.wallMs + 1 },
      }),
    ).toEqual({ ok: false, reason: 'malformed-receipt' });
    expect(
      validateWorkRunReceipt({
        ...receipt,
        cohort: { ...projection.cohort, key: 'L0/forged' },
      }),
    ).toEqual({ ok: false, reason: 'malformed-receipt' });
  });

  it('requires post-PR revisions to retain their revision-zero authorization projection', () => {
    const authorization = trustedAuthorization();
    const valid = repositoryFixture({ generation: 1, revision: 1, authorization });
    const currentHead = commitClosure(valid);
    expect(
      validateRepositoryWorkRun({
        root: valid.root,
        baseRef: valid.baseCommit,
        currentPrNumber: 42,
        fetchAuthorization: () => valid.authorization,
        fetchPullRequestEvidence: () => pullRequestEvidence(valid, currentHead),
      }),
    ).toEqual({ ok: true, population: 'included', runId: 'run-1' });

    const rewrittenEvents = structuredClone(
      receiptEvents({ generation: 1, revision: 1, authorization }),
    );
    const rewrittenAt = rewrittenEvents.findIndex(
      (event) =>
        event.type === 'work.reopened' && event.data.generation === 1 && event.data.revision === 1,
    );
    rewrittenEvents[rewrittenAt].data.authorization = trustedAuthorization({ commentId: 998 });
    for (let index = rewrittenAt; index < rewrittenEvents.length; index += 1) {
      rewrittenEvents[index].previousHash = rewrittenEvents[index - 1]?.hash ?? null;
      rewrittenEvents[index].hash = workRunEventHash(rewrittenEvents[index]);
    }
    expect(
      validateWorkRunReceipt({
        schemaVersion: 1,
        disposition: 'included',
        runId: 'run-1',
        generation: 1,
        revision: 1,
        ground: authorization.ground,
        authorization,
        events: rewrittenEvents,
        timestamps: {
          claimedAt: rewrittenEvents[0].at,
          readyAt: rewrittenEvents.at(-1).at,
        },
      }),
    ).toEqual({ ok: false, reason: 'malformed-receipt' });

    const bypass = repositoryFixture({ generation: 1, revision: 1, authorization });
    const receiptFile = path.join(bypass.root, bypass.receiptPath);
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
    receipt.authorization = { ...receipt.authorization, commentId: 999 };
    writeFileSync(receiptFile, `${JSON.stringify(receipt)}\n`);
    commitClosure(bypass);
    expect(
      validateRepositoryWorkRun({
        root: bypass.root,
        baseRef: bypass.baseCommit,
        currentPrNumber: 42,
        fetchAuthorization: () => bypass.authorization,
      }),
    ).toEqual({ ok: false, reason: 'invalid-post-pr-authorization' });
  });

  it('rejects duplicate or conflicting work-run trailer pairs', () => {
    const fixture = repositoryFixture();
    git(fixture.root, ['add', fixture.receiptPath]);
    git(fixture.root, [
      'commit',
      '-m',
      'chore: close work run\n\nWork-Run: run-1\nWork-Run: other\nWork-Receipt: g0-r0',
    ]);

    expect(validateRepositoryWorkRun({ root: fixture.root, baseRef: fixture.baseCommit })).toEqual({
      ok: false,
      reason: 'invalid-commit-trailers',
    });
  });

  it('rejects a receipt whose ready tree does not match the bound commit', () => {
    const fixture = repositoryFixture();
    const receiptFile = path.join(fixture.root, fixture.receiptPath);
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'));
    receipt.identity.headTree = 'f'.repeat(40);
    writeFileSync(receiptFile, `${JSON.stringify(receipt)}\n`);
    commitClosure(fixture);

    expect(validateRepositoryWorkRun({ root: fixture.root, baseRef: fixture.baseCommit })).toEqual({
      ok: false,
      reason: 'identity-mismatch',
    });
  });

  it('rejects an amended or rebased ready head and a commit after closure', () => {
    const amended = repositoryFixture();
    write(amended.root, 'src/change.mjs', 'export const changed = "amended";\n');
    git(amended.root, ['add', 'src/change.mjs']);
    git(amended.root, ['commit', '--amend', '--no-edit']);
    commitClosure(amended);
    expect(validateRepositoryWorkRun({ root: amended.root, baseRef: amended.baseCommit })).toEqual({
      ok: false,
      reason: 'invalid-closure-commit',
    });

    const rebased = repositoryFixture();
    git(rebased.root, ['switch', 'develop']);
    write(rebased.root, 'base-extra.txt', 'new base\n');
    git(rebased.root, ['add', 'base-extra.txt']);
    git(rebased.root, ['commit', '-m', 'chore: advance base']);
    git(rebased.root, ['switch', 'codex/work']);
    git(rebased.root, ['rebase', 'develop']);
    commitClosure(rebased);
    expect(validateRepositoryWorkRun({ root: rebased.root, baseRef: rebased.baseCommit })).toEqual({
      ok: false,
      reason: 'invalid-closure-commit',
    });

    const additional = repositoryFixture();
    commitClosure(additional);
    write(additional.root, 'after.txt', 'too late\n');
    git(additional.root, ['add', 'after.txt']);
    git(additional.root, ['commit', '-m', 'chore: extra commit']);
    expect(
      validateRepositoryWorkRun({ root: additional.root, baseRef: additional.baseCommit }),
    ).toEqual({ ok: false, reason: 'invalid-closure-commit' });
  });

  it.each([
    ['commitOids', ['0'.repeat(40)]],
    ['trailerDigest', '0'.repeat(64)],
    ['ownerFingerprint', '0'.repeat(64)],
  ])('rejects a mismatched %s identity field', (field, value) => {
    const fixture = repositoryFixture();
    changeReceiptIdentity(fixture, field, value);
    commitClosure(fixture);

    expect(validateRepositoryWorkRun({ root: fixture.root, baseRef: fixture.baseCommit })).toEqual({
      ok: false,
      reason: 'identity-mismatch',
    });
  });

  it('validates the newest closure while retaining immutable prior receipts', () => {
    const fixture = repositoryFixture();
    commitClosure(fixture);
    write(fixture.root, 'src/next.mjs', 'export const next = true;\n');
    git(fixture.root, ['add', 'src/next.mjs']);
    git(fixture.root, ['commit', '-m', 'fix: rework\n\nWork-Run: run-1\nWork-Receipt: g0-r1']);
    const nextReceiptPath = '.agents/evals/work-runs/run-1/g0-r1.json';
    const events = receiptEvents({ revision: 1 });
    write(
      fixture.root,
      nextReceiptPath,
      `${JSON.stringify({
        schemaVersion: 1,
        disposition: 'included',
        runId: 'run-1',
        generation: 0,
        revision: 1,
        identity: currentReceiptIdentity(fixture.root, fixture.baseCommit),
        events,
        ...receiptProjection(events),
        timestamps: { claimedAt: events[0].at, readyAt: events.at(-1).at },
      })}\n`,
    );
    git(fixture.root, ['add', nextReceiptPath]);
    git(fixture.root, [
      'commit',
      '-m',
      'chore: close revised work run\n\nWork-Run: run-1\nWork-Receipt: g0-r1',
    ]);

    expect(validateRepositoryWorkRun({ root: fixture.root, baseRef: fixture.baseCommit })).toEqual({
      ok: true,
      population: 'included',
      runId: 'run-1',
    });
  });

  it('rejects a prior receipt path that was modified after its one addition', () => {
    const fixture = repositoryFixture();
    commitClosure(fixture);
    write(
      fixture.root,
      fixture.receiptPath,
      `${readFileSync(path.join(fixture.root, fixture.receiptPath), 'utf8')}\n`,
    );
    git(fixture.root, ['add', fixture.receiptPath]);
    git(fixture.root, [
      'commit',
      '-m',
      'fix: mutate old receipt\n\nWork-Run: run-1\nWork-Receipt: g0-r1',
    ]);
    write(fixture.root, 'src/next.mjs', 'export const next = true;\n');
    git(fixture.root, ['add', 'src/next.mjs']);
    git(fixture.root, ['commit', '-m', 'fix: rework\n\nWork-Run: run-1\nWork-Receipt: g0-r1']);
    const nextReceiptPath = '.agents/evals/work-runs/run-1/g0-r1.json';
    const events = receiptEvents({ revision: 1 });
    write(
      fixture.root,
      nextReceiptPath,
      `${JSON.stringify({
        schemaVersion: 1,
        disposition: 'included',
        runId: 'run-1',
        generation: 0,
        revision: 1,
        identity: currentReceiptIdentity(fixture.root, fixture.baseCommit),
        events,
        ...receiptProjection(events),
        timestamps: { claimedAt: events[0].at, readyAt: events.at(-1).at },
      })}\n`,
    );
    git(fixture.root, ['add', nextReceiptPath]);
    git(fixture.root, [
      'commit',
      '-m',
      'chore: close revised work run\n\nWork-Run: run-1\nWork-Receipt: g0-r1',
    ]);

    expect(validateRepositoryWorkRun({ root: fixture.root, baseRef: fixture.baseCommit })).toEqual({
      ok: false,
      reason: 'mutable-prior-receipt',
    });
  });

  it('rejects a foreign receipt injected into the validated topic range', () => {
    const fixture = repositoryFixture();
    const foreignPath = '.agents/evals/work-runs/run-2/g0-r0.json';
    write(fixture.root, foreignPath, '{"schemaVersion":1,"runId":"run-2"}\n');
    git(fixture.root, ['add', foreignPath]);
    git(fixture.root, [
      'commit',
      '-m',
      'chore: inject foreign receipt\n\nWork-Run: run-1\nWork-Receipt: g0-r0',
    ]);
    write(fixture.root, 'src/continue.mjs', 'export const continued = true;\n');
    git(fixture.root, ['add', 'src/continue.mjs']);
    git(fixture.root, [
      'commit',
      '-m',
      'fix: continue measured work\n\nWork-Run: run-1\nWork-Receipt: g0-r0',
    ]);
    changeReceiptIdentity(fixture, 'headCommit', git(fixture.root, ['rev-parse', 'HEAD']));
    const identity = currentReceiptIdentity(fixture.root, fixture.baseCommit);
    for (const [field, value] of Object.entries(identity)) {
      changeReceiptIdentity(fixture, field, value);
    }
    commitClosure(fixture);

    expect(validateRepositoryWorkRun({ root: fixture.root, baseRef: fixture.baseCommit })).toEqual({
      ok: false,
      reason: 'incomplete-or-foreign-receipt-history',
    });
  });

  it('rejects the commit-count sentinel before materializing an unbounded range', () => {
    const fixture = repositoryFixture();
    const message = 'test: expand bounded range\n\nWork-Run: run-1\nWork-Receipt: g0-r0\n';
    const initialHead = git(fixture.root, ['rev-parse', 'HEAD']);
    let stream = '';
    for (let index = 0; index < 1_000; index += 1) {
      stream += `commit refs/heads/codex/work\nmark :${index + 1}\n`;
      stream += `committer Test User <test@example.com> ${946684800 + index} +0000\n`;
      stream += `data ${Buffer.byteLength(message)}\n${message}`;
      stream += `from ${index === 0 ? initialHead : `:${index}`}\n\n`;
    }
    execFileSync('git', [...GIT_TEST_CONFIG, 'fast-import', '--quiet'], {
      cwd: fixture.root,
      input: stream,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    });
    const updated = currentReceiptIdentity(fixture.root, fixture.baseCommit);
    for (const [field, value] of Object.entries(updated)) {
      changeReceiptIdentity(fixture, field, value);
    }
    commitClosure(fixture);

    expect(validateRepositoryWorkRun({ root: fixture.root, baseRef: fixture.baseCommit })).toEqual({
      ok: false,
      reason: 'measurement-range-budget-exceeded',
    });
  });
});
