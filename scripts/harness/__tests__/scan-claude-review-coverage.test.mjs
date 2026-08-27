import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findClaudeReviewCoverageFindings,
  findWorkflowCoverageFindings,
  readExamined,
} from '../scan-claude-review-coverage.mjs';
import { findTokenlessActionSteps } from '../scan-review-token-supply.mjs';
import { parsePermissions } from '../scan-workflow-permissions.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const workflow = ({
  pullRequest = 'all',
  types = 'opened, synchronize, reopened, edited',
} = {}) => `
name: Claude Code Review
on:
  pull_request:
    ${pullRequest === 'all' ? '' : `branches: [${pullRequest}]`}
    types: [${types}]
concurrency:
  group: claude-review-\${{ github.event.pull_request.number }}
  cancel-in-progress: true
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    if: \${{ github.event.pull_request.head.repo.full_name == github.repository && (github.event.action != 'edited' || github.event.changes.base != null) }}
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          github_token: \${{ secrets.GITHUB_TOKEN }}
          prompt: |
            Write the PR summary and every inline review comment in English.
            REVIEWED BASE: \${{ github.event.pull_request.base.sha }}
            REVIEWED HEAD: \${{ github.event.pull_request.head.sha }}
            ACTIONABLE FINDINGS: <n>
`;

function fixture(source) {
  const root = makeTemp('claude-review-coverage-');
  roots.push(root);
  const dir = path.join(root, '.github', 'workflows');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'review.yml'), source);
  return root;
}

describe('scan-claude-review-coverage (INFRA-098)', () => {
  it('rejects target-base filters and missing lifecycle events', () => {
    expect(findWorkflowCoverageFindings(workflow({ pullRequest: 'main, develop' }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/base branch/) }),
      ]),
    );
    expect(findWorkflowCoverageFindings(workflow({ types: 'opened, synchronize' }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/reopened/) }),
      ]),
    );
  });

  it.each(['REVIEWED BASE', 'REVIEWED HEAD', 'ACTIONABLE FINDINGS'])(
    'rejects a missing %s marker',
    (marker) => {
      expect(findWorkflowCoverageFindings(workflow().replace(marker, `MISSING ${marker}`))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ detail: expect.stringContaining(marker) }),
        ]),
      );
    },
  );

  it('rejects a reviewer prompt without the explicit English-output contract', () => {
    const source = workflow().replace(
      'Write the PR summary and every inline review comment in English.',
      'Review the pull request.',
    );
    expect(findWorkflowCoverageFindings(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/English-output contract/i) }),
      ]),
    );
  });

  it('rejects Hangul even when the explicit English-output contract remains', () => {
    const source = workflow().replace('REVIEWED BASE:', '리뷰 기준\n            REVIEWED BASE:');
    expect(findWorkflowCoverageFindings(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/Hangul/) }),
      ]),
    );
  });

  it('accepts the all-base lifecycle and exact event SHA markers', () => {
    expect(findWorkflowCoverageFindings(workflow())).toEqual([]);
  });

  it('rejects a weakened same-repository condition or concurrency cancellation', () => {
    expect(
      findWorkflowCoverageFindings(
        workflow().replace(
          'github.event.pull_request.head.repo.full_name == github.repository',
          'true',
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/same-repository/) }),
      ]),
    );
    expect(
      findWorkflowCoverageFindings(workflow().replace('cancel-in-progress: true', 'false')),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/cancel-in-progress/) }),
      ]),
    );
  });

  it('rejects a decoy action name after the real reviewer step is removed', () => {
    const source = workflow()
      .replace('- uses: anthropics/claude-code-action@v1', '- uses: example/not-a-reviewer@v1')
      .concat('\n# anthropics/claude-code-action is mentioned only as history\n');
    expect(findWorkflowCoverageFindings(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/no actual.*action step/i) }),
      ]),
    );
  });

  it('does not accept verdict markers outside the reviewer step prompt', () => {
    const source = workflow()
      .replace('REVIEWED BASE:', 'MISSING BASE:')
      .replace('REVIEWED HEAD:', 'MISSING HEAD:')
      .concat(
        '\n# REVIEWED BASE: ${{ github.event.pull_request.base.sha }}\n' +
          '# REVIEWED HEAD: ${{ github.event.pull_request.head.sha }}\n',
      );
    expect(findWorkflowCoverageFindings(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining('REVIEWED BASE') }),
        expect.objectContaining({ detail: expect.stringContaining('REVIEWED HEAD') }),
      ]),
    );
  });

  it('requires edited events to run only for a base retarget', () => {
    expect(
      findWorkflowCoverageFindings(
        workflow().replace(
          " && (github.event.action != 'edited' || github.event.changes.base != null)",
          '',
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/edited.*base retarget/i) }),
      ]),
    );
  });

  it('rejects review conditions moved from the job if field into a comment', () => {
    const source = workflow().replace(
      "    if: ${{ github.event.pull_request.head.repo.full_name == github.repository && (github.event.action != 'edited' || github.event.changes.base != null) }}",
      "    # if: ${{ github.event.pull_request.head.repo.full_name == github.repository && (github.event.action != 'edited' || github.event.changes.base != null) }}",
    );
    expect(findWorkflowCoverageFindings(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/job-level `if`/) }),
      ]),
    );
  });

  it('rejects a job condition neutralized by an always-true disjunction', () => {
    const source = workflow().replace(
      'github.event.changes.base != null) }}',
      'github.event.changes.base != null) || true }}',
    );
    expect(findWorkflowCoverageFindings(source)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/exact guarded condition/i) }),
      ]),
    );
  });

  it('composes the existing token and permission owners without copying their parsers', () => {
    const source = workflow();
    expect(findTokenlessActionSteps(source)).toEqual([]);
    expect(parsePermissions(source)).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(findTokenlessActionSteps(source.replace(/\s+github_token:.*\n/, '\n'))).toHaveLength(1);
    expect(parsePermissions(source.replace('contents: read', 'contents: write'))).toMatchObject({
      contents: 'write',
    });
  });

  it('fails closed when no governed workflow exists', () => {
    const root = fixture('name: unrelated\njobs: {}\n');
    expect(findClaudeReviewCoverageFindings(root).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringMatching(/no workflow/i) }),
      ]),
    );
  });

  it('reports the exact governed-workflow count and resets it on the next walk', () => {
    const root = fixture(workflow());
    findClaudeReviewCoverageFindings(root);
    expect(readExamined()).toBe(1);
    findClaudeReviewCoverageFindings(root);
    expect(readExamined()).toBe(1);
  });

  it('is registered and passes on the live repository', () => {
    const registry = readFileSync(
      path.join(REPO_ROOT, 'scripts/harness/run-all-scans.mjs'),
      'utf8',
    );
    expect(registry).toContain('scan-claude-review-coverage.mjs');
    expect(findClaudeReviewCoverageFindings(REPO_ROOT).findings).toEqual([]);
  });
});
