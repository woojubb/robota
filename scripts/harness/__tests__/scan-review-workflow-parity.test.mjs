/**
 * INFRA-048-A — `anthropics/claude-code-action` silently skips (and exits 0) when its workflow file
 * differs from the default branch's copy, so the check reports `success` having reviewed nothing.
 * Measured on this repo: a one-line `checkout@v4`→`@v7` bump merged to `develop` alone disabled the
 * reviewer, and all 100 subsequent runs reported `success`.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findReviewWorkflowParityFindings,
  isPromotionToDefault,
  listGovernedWorkflows,
} from '../scan-review-workflow-parity.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** GIT_* is stripped: inside a git hook it would redirect fixture git calls to the real repo. */
function gitSafeEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
}

function git(cwd, args) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: gitSafeEnv(),
  });
}

const REVIEW_WORKFLOW = [
  'name: Claude Code Review',
  'on:',
  '  pull_request:',
  '    branches: [main, develop]',
  'jobs:',
  '  review:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: anthropics/claude-code-action@v1',
  '',
].join('\n');

/** A repo with `main` carrying the review workflow, and a feature branch that may diverge. */
async function createFixture({ featureContent = REVIEW_WORKFLOW } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-review-parity-'));
  const workflowPath = path.join(root, '.github/workflows/claude-code-review.yml');
  mkdirSync(path.dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, REVIEW_WORKFLOW, 'utf8');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'main']);
  git(root, ['checkout', '-q', '-b', 'feature']);
  if (featureContent !== REVIEW_WORKFLOW) {
    writeFileSync(workflowPath, featureContent, 'utf8');
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'diverge']);
  }
  return root;
}

describe('scan-review-workflow-parity', () => {
  it('discovers governed workflows by the action they invoke, not by a hardcoded name', async () => {
    const root = await createFixture();
    expect(listGovernedWorkflows(root)).toEqual(['.github/workflows/claude-code-review.yml']);
  });

  it('RED: reports drift when the workflow differs from the default branch by ONE line', async () => {
    const root = await createFixture({
      featureContent: REVIEW_WORKFLOW.replace('actions/checkout@v4', 'actions/checkout@v7'),
    });
    const { findings } = findReviewWorkflowParityFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].workflow).toBe('.github/workflows/claude-code-review.yml');
    expect(findings[0].detail).toMatch(/differs from main/);
  });

  it('GREEN: reports nothing when the copies are byte-identical', async () => {
    const root = await createFixture();
    expect(findReviewWorkflowParityFindings(root).findings).toEqual([]);
  });

  it('FAIL-CLOSED: reports a finding when the default branch cannot be resolved', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-review-parity-nodefault-'));
    const workflowPath = path.join(root, '.github/workflows/claude-code-review.yml');
    mkdirSync(path.dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, REVIEW_WORKFLOW, 'utf8');
    git(root, ['init', '-q', '-b', 'work']);
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'work']);
    const { findings } = findReviewWorkflowParityFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/will not report a pass it did not compute/);
  });

  it('reports a finding when the workflow does not exist on the default branch at all', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-review-parity-new-'));
    mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
    writeFileSync(path.join(root, 'README.md'), '# f\n', 'utf8');
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'main']);
    git(root, ['checkout', '-q', '-b', 'feature']);
    writeFileSync(
      path.join(root, '.github/workflows/claude-code-review.yml'),
      REVIEW_WORKFLOW,
      'utf8',
    );
    git(root, ['add', '.']);
    git(root, ['commit', '-q', '-m', 'add review workflow']);
    const { findings } = findReviewWorkflowParityFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/does not exist on main/);
  });

  it('is not applicable to the promotion PR that restores parity', () => {
    expect(isPromotionToDefault({ GITHUB_BASE_REF: 'main' })).toBe(true);
    expect(isPromotionToDefault({ GITHUB_BASE_REF: 'develop' })).toBe(false);
    expect(isPromotionToDefault({})).toBe(false);
  });

  it('holds on the real repository', () => {
    const { findings } = findReviewWorkflowParityFindings(REPO_ROOT);
    expect(findings).toEqual([]);
  });
});
