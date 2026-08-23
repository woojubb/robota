import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  automergeSignals,
  checksOutRepository,
  effectivePermissions,
  findAutomergePermissionFindings,
  isPullRequestTriggered,
  missingScopes,
} from '../scan-automerge-disarm-permission.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

async function createWorkflowFixture(files) {
  const root = makeTemp('robota-automerge-permission-');
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(root, '.github', 'workflows', name), content, 'utf8');
  }
  return root;
}

/**
 * The shape `review-gate.yml` actually had when the disarm silently failed on #1461 and #1465:
 * `contents: read`, and the mutation in the same job that checks the pull request out.
 */
const PRE_FIX_REVIEW_GATE = `name: Review Gate
on:
  pull_request:
    branches: [main, develop]

permissions:
  contents: read
  security-events: read
  pull-requests: write

jobs:
  review-gate:
    name: review-gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Decide
        run: |
          if [ "$status" -ne 0 ]; then
            gh pr merge --disable-auto "$PR_NUMBER" \\
              || echo "auto-merge was not armed; nothing to disarm."
          fi
`;

/** The fixed shape: the mutation isolated in its own job that checks nothing out. */
const FIXED_REVIEW_GATE = `name: Review Gate
on:
  pull_request:
    branches: [main, develop]

permissions:
  contents: read
  security-events: read
  pull-requests: write

jobs:
  review-gate:
    name: review-gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Decide
        run: |
          echo decide

  disarm-auto-merge:
    name: disarm-auto-merge
    needs: review-gate
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - name: Disarm auto-merge
        run: |
          gh pr merge --disable-auto "$PR_NUMBER" || true
`;

describe('automerge mutation signal detection', () => {
  it('recognises every form of the mutation', () => {
    expect(automergeSignals('  gh pr merge --disable-auto "$N"')).toEqual([
      'gh pr merge --disable-auto',
    ]);
    expect(automergeSignals('  gh pr merge 670 --squash --auto')).toEqual(['gh pr merge --auto']);
    expect(automergeSignals('  gh api graphql -f query=disablePullRequestAutoMerge')).toEqual([
      'disablePullRequestAutoMerge',
    ]);
    expect(automergeSignals('  enablePullRequestAutoMerge(input: $i)')).toEqual([
      'enablePullRequestAutoMerge',
    ]);
  });

  it('does not read `--disable-auto` as the arming `--auto` flag', () => {
    expect(automergeSignals('gh pr merge --disable-auto 1')).not.toContain('gh pr merge --auto');
  });

  it('ignores the mutation named in a comment, so documenting the rule does not trip it', () => {
    expect(
      automergeSignals('  # gh pr merge --disable-auto is the lever INFRA-048 relies on'),
    ).toEqual([]);
  });

  it('ignores a job that merges without touching auto-merge', () => {
    expect(automergeSignals('  gh pr merge 670 --squash')).toEqual([]);
  });
});

describe('effective permissions', () => {
  it('falls back to the workflow-level block when the job declares none', () => {
    expect(effectivePermissions(PRE_FIX_REVIEW_GATE, '    steps:\n      - run: echo hi')).toEqual({
      contents: 'read',
      'security-events': 'read',
      'pull-requests': 'write',
    });
  });

  it('lets a job-level block REPLACE the workflow-level one', () => {
    const jobText =
      '    permissions:\n      contents: write\n      pull-requests: write\n    steps:';
    expect(effectivePermissions(PRE_FIX_REVIEW_GATE, jobText)).toEqual({
      contents: 'write',
      'pull-requests': 'write',
    });
  });

  it('reads the `write-all` and `read-all` shorthands', () => {
    expect(
      missingScopes(effectivePermissions('permissions: write-all\njobs:', '    steps:')),
    ).toEqual([]);
    expect(
      missingScopes(effectivePermissions('permissions: read-all\njobs:', '    steps:')),
    ).toEqual(['contents', 'pull-requests']);
  });

  it('treats a missing declaration as insufficient — the repository default is not a guarantee', () => {
    expect(missingScopes(effectivePermissions('name: x\njobs:', '    steps:'))).toEqual([
      'contents',
      'pull-requests',
    ]);
  });

  it('names `contents` as the one missing scope when only pull-requests is granted', () => {
    expect(missingScopes({ contents: 'read', 'pull-requests': 'write' })).toEqual(['contents']);
  });
});

describe('pull-request trigger detection', () => {
  it('reads the `on:` block', () => {
    expect(isPullRequestTriggered(PRE_FIX_REVIEW_GATE)).toBe(true);
    expect(isPullRequestTriggered('on:\n  push:\n    branches: [main]\njobs:\n')).toBe(false);
  });

  it('does not treat `pull_request` inside a run body as a trigger', () => {
    const workflow =
      'on:\n  workflow_dispatch:\njobs:\n  a:\n    steps:\n      - run: echo pull_request\n';
    expect(isPullRequestTriggered(workflow)).toBe(false);
  });
});

describe('checkout detection', () => {
  it('sees actions/checkout and a raw clone', () => {
    expect(checksOutRepository('      - uses: actions/checkout@v4')).toBe(true);
    expect(checksOutRepository('      - run: git clone https://example.test/x')).toBe(true);
    expect(checksOutRepository('      - run: gh pr view 1')).toBe(false);
  });
});

describe('findAutomergePermissionFindings', () => {
  it('RED: flags the pre-fix review-gate for both the missing scope and the shared checkout', async () => {
    const root = await createWorkflowFixture({ 'review-gate.yml': PRE_FIX_REVIEW_GATE });
    const findings = findAutomergePermissionFindings(root);
    expect(findings).toHaveLength(2);
    expect(findings[0].job).toBe('review-gate');
    expect(findings[0].detail).toContain('`contents: write`');
    expect(findings[1].detail).toContain('CHECKS THE REPOSITORY OUT');
  });

  it('GREEN: accepts the mutation isolated in its own job with contents: write', async () => {
    const root = await createWorkflowFixture({ 'review-gate.yml': FIXED_REVIEW_GATE });
    expect(findAutomergePermissionFindings(root)).toEqual([]);
  });

  it('flags a job that arms auto-merge without contents: write, not only one that disarms', async () => {
    const workflow = `name: Arm
on:
  pull_request:
permissions:
  pull-requests: write
jobs:
  arm:
    runs-on: ubuntu-latest
    steps:
      - run: gh pr merge "$N" --squash --auto
`;
    const root = await createWorkflowFixture({ 'arm.yml': workflow });
    const findings = findAutomergePermissionFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain('gh pr merge --auto');
  });

  it('allows a checkout alongside the mutation when the workflow is not pull-request triggered', async () => {
    const workflow = `name: Release
on:
  workflow_dispatch:
permissions:
  contents: write
  pull-requests: write
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: gh pr merge "$N" --squash --auto
`;
    const root = await createWorkflowFixture({ 'release.yml': workflow });
    expect(findAutomergePermissionFindings(root)).toEqual([]);
  });

  it('is silent on a repository whose workflows never touch auto-merge', async () => {
    const root = await createWorkflowFixture({
      'ci.yml':
        'name: CI\non:\n  pull_request:\njobs:\n  build:\n    steps:\n      - run: pnpm build\n',
    });
    expect(findAutomergePermissionFindings(root)).toEqual([]);
  });

  it('passes against this repository', () => {
    expect(findAutomergePermissionFindings(WORKSPACE_ROOT)).toEqual([]);
  });
});
