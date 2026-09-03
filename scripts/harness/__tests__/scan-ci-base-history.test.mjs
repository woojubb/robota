import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  baseHistorySignals,
  fetchDepths,
  findBaseHistoryFindings,
  perCommitSignals,
  splitWorkflowJobs,
  staleInvocations,
  stripComments,
  triggersOnPullRequest,
} from '../scan-ci-base-history.mjs';

async function createWorkflowFixture(files) {
  const root = makeTemp('robota-ci-base-history-');
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(root, '.github', 'workflows', name), content, 'utf8');
  }
  return root;
}

const GRAFTED_JOB = `name: CI
on:
  pull_request:
jobs:
  changes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 50
      - name: Fetch base branch
        run: git fetch origin \${{ github.base_ref }} --depth=50
      - run: git diff --name-only origin/\${{ github.base_ref }}...HEAD
`;

const FIXED_JOB = `name: CI
on:
  pull_request:
jobs:
  changes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - run: git diff --name-only origin/\${{ github.base_ref }}...HEAD
`;

const NO_HISTORY_JOB = `name: CI
on:
  pull_request:
jobs:
  tui-e2e:
    runs-on: ubuntu-latest
    if: github.base_ref != 'main'
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 50
      - run: pnpm test:pty
`;

describe('splitWorkflowJobs', () => {
  it('splits a workflow into one block per job and stops at the next top-level key', () => {
    const jobs = splitWorkflowJobs(`${GRAFTED_JOB}\npermissions:\n  contents: read\n`);
    expect(jobs.map((job) => job.name)).toEqual(['changes']);
    expect(jobs[0].text).toContain('--depth=50');
    expect(jobs[0].text).not.toContain('contents: read');
  });

  it('returns nothing when the file has no jobs block (never a silent pass)', () => {
    expect(splitWorkflowJobs('name: x\non: push\n')).toEqual([]);
  });
});

describe('stripComments', () => {
  it('ignores a comment that merely DESCRIBES the banned pattern', () => {
    const text =
      '      # the `git fetch origin base --depth=50` step used to sit here\n      - run: pnpm test\n';
    expect(stripComments(text)).not.toContain('--depth=50');
    expect(stripComments(text)).toContain('pnpm test');
  });
});

describe('fetchDepths / baseHistorySignals', () => {
  it('reads numeric fetch-depth values only', () => {
    expect(fetchDepths('        with:\n          fetch-depth: 50\n')).toEqual(['50']);
    expect(fetchDepths('          fetch-depth: 0\n')).toEqual(['0']);
  });

  it('treats a base ref used as a git REVISION as a signal, but not a bare `if:` reference', () => {
    expect(baseHistorySignals("    if: github.base_ref != 'main'\n    steps: []")).toEqual([]);
    expect(
      baseHistorySignals('      - run: git diff origin/${{ github.base_ref }}...HEAD'),
    ).toContain('origin/<base> revision');
    expect(baseHistorySignals('      - run: git merge-base origin/develop HEAD')).toContain(
      'git merge-base',
    );
  });
});

describe('findBaseHistoryFindings (INFRA-050)', () => {
  it('flags a depth-limited fetch AND a base-history read on a shallow checkout', async () => {
    const root = await createWorkflowFixture({ 'ci.yml': GRAFTED_JOB });
    const findings = findBaseHistoryFindings(root);
    expect(findings).toHaveLength(2);
    expect(findings[0].detail).toContain('depth-limited');
    expect(findings[1].detail).toContain('fetch-depth: 50');
    expect(findings.every((finding) => finding.job === 'changes')).toBe(true);
  });

  it('passes the same job once the graft is gone and the checkout is complete', async () => {
    const root = await createWorkflowFixture({ 'ci.yml': FIXED_JOB });
    expect(findBaseHistoryFindings(root)).toEqual([]);
  });

  it('leaves a job that never reads base history on its cheap shallow checkout', async () => {
    const root = await createWorkflowFixture({ 'ci.yml': NO_HISTORY_JOB });
    expect(findBaseHistoryFindings(root)).toEqual([]);
  });

  it('flags a base-history job that declares no fetch-depth at all', async () => {
    const root = await createWorkflowFixture({
      'ci.yml': 'jobs:\n  x:\n    steps:\n      - run: git rev-list origin/develop..HEAD\n',
    });
    expect(findBaseHistoryFindings(root)[0].detail).toContain('declares no `fetch-depth`');
  });
});

describe('rule 3 — a per-commit history scan under pull_request names its head (issue #2412)', () => {
  const perCommitJob = (env) => `name: CI
on:
  pull_request:
jobs:
  scans:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - name: scans
        env:
          HARNESS_BASE_REF: origin/\${{ github.base_ref }}
${env}        run: pnpm harness:scan -- --affected --base "\${HARNESS_BASE_REF}"
`;

  it('flags the scans job that runs harness:scan with no PR_HEAD_SHA — the shape ci.yml had', async () => {
    const root = await createWorkflowFixture({ 'ci.yml': perCommitJob('') });
    const findings = findBaseHistoryFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].job).toBe('scans');
    expect(findings[0].detail).toContain('PR_HEAD_SHA');
    expect(findings[0].detail).toContain('refs/pull/N/merge');
  });

  it('passes once the job exports PR_HEAD_SHA', async () => {
    const root = await createWorkflowFixture({
      'ci.yml': perCommitJob('          PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n'),
    });
    expect(findBaseHistoryFindings(root)).toEqual([]);
  });

  it('a PR_HEAD_SHA mentioned only in a comment does not satisfy it', async () => {
    const root = await createWorkflowFixture({
      'ci.yml': perCommitJob('          # PR_HEAD_SHA: would go here\n'),
    });
    expect(findBaseHistoryFindings(root)).toHaveLength(1);
  });

  it('does not apply to a workflow that never runs on pull_request (HEAD is a real commit there)', async () => {
    const root = await createWorkflowFixture({
      'ci.yml': perCommitJob('').replace('  pull_request:', '  push:\n    branches: [develop]'),
    });
    expect(findBaseHistoryFindings(root)).toEqual([]);
  });

  it('recognises each per-commit consumer, and not the build-contracts sub-command', () => {
    expect(perCommitSignals('      - run: pnpm harness:scan -- --context pr')).toHaveLength(1);
    expect(perCommitSignals('        run: pnpm harness:verify:release')).toHaveLength(1);
    expect(perCommitSignals('      - run: pnpm harness:scan:build-contracts')).toEqual([]);
    expect(perCommitSignals('run: node scripts/harness/scan-promotion-ancestry.mjs')).toEqual([
      'scan-promotion-ancestry.mjs',
    ]);
    expect(perCommitSignals('run: node scripts/harness/check-regression-red-proof.mjs')).toEqual([
      'check-regression-red-proof.mjs',
    ]);
  });

  it('reads the trigger block, including the flow-sequence and _target spellings', () => {
    expect(triggersOnPullRequest('on:\n  pull_request:\n    branches: [develop]\njobs:\n')).toBe(
      true,
    );
    expect(triggersOnPullRequest('on: [push, pull_request]\njobs:\n')).toBe(true);
    expect(triggersOnPullRequest('on:\n  pull_request_target:\njobs:\n')).toBe(true);
    expect(
      triggersOnPullRequest(
        'on:\n  push:\njobs:\n  x:\n    if: github.event_name == "pull_request"\n',
      ),
    ).toBe(false);
  });
});

describe('staleInvocations', () => {
  it('reports every indirect entry as stale when its backing script is absent', async () => {
    const root = makeTemp('robota-ci-base-history-empty-');
    expect(staleInvocations(root).length).toBeGreaterThan(0);
  });

  it('is empty against the real repository (the guard still guards something real)', () => {
    expect(staleInvocations()).toEqual([]);
  });
});
