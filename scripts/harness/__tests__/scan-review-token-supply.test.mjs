/**
 * INFRA-062 — token-less, `anthropics/claude-code-action` authenticates through an OIDC exchange
 * that validates the invoking workflow byte-for-byte against the default branch and SILENTLY skips
 * the review (exit 0) on any divergence — the INFRA-048 failure mode. Supplying `github_token`
 * returns before that exchange (src/github/token.ts @ v1.0.183), making the skip unreachable —
 * which is the ground on which INFRA-048's parity scan was retired. This guard is what keeps that
 * ground solid: every step invoking the action must supply `github_token`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findReviewTokenSupplyFindings,
  findTokenlessActionSteps,
  hasNonEmptyTokenValue,
  listGovernedWorkflows,
} from '../scan-review-token-supply.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function workflow({ token = true, nameForm = false } = {}) {
  return [
    'name: Claude Code Review',
    'on:',
    '  pull_request:',
    '    branches: [main, develop]',
    'jobs:',
    '  review:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    ...(nameForm
      ? ['      - name: Review', '        uses: anthropics/claude-code-action@v1']
      : ['      - uses: anthropics/claude-code-action@v1']),
    '        with:',
    ...(token ? ['          github_token: ${{ secrets.GITHUB_TOKEN }}'] : []),
    '          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}',
    '          prompt: |',
    '            review the diff',
    '      - uses: actions/upload-artifact@v4',
    '        with:',
    '          name: log',
    '',
  ].join('\n');
}

async function createFixture(content) {
  const root = makeTemp('robota-review-token-');
  const workflowPath = path.join(root, '.github/workflows/claude-code-review.yml');
  mkdirSync(path.dirname(workflowPath), { recursive: true });
  writeFileSync(workflowPath, content, 'utf8');
  return root;
}

describe('scan-review-token-supply', () => {
  it('discovers governed workflows by the action they invoke, not by a hardcoded name', async () => {
    const root = await createFixture(workflow());
    expect(listGovernedWorkflows(root)).toEqual(['.github/workflows/claude-code-review.yml']);
  });

  it('RED: a step invoking the action without github_token is a finding', async () => {
    const root = await createFixture(workflow({ token: false }));
    const { findings } = findReviewTokenSupplyFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].workflow).toBe('.github/workflows/claude-code-review.yml');
    expect(findings[0].detail).toMatch(/SILENTLY SKIPS/);
  });

  it('GREEN: a step supplying github_token in its with-block passes', async () => {
    const root = await createFixture(workflow({ token: true }));
    expect(findReviewTokenSupplyFindings(root).findings).toEqual([]);
  });

  it('handles the `- name:` + `uses:` step shape in both directions', () => {
    expect(findTokenlessActionSteps(workflow({ token: true, nameForm: true }))).toEqual([]);
    expect(findTokenlessActionSteps(workflow({ token: false, nameForm: true }))).toHaveLength(1);
  });

  it('does not let a github_token on a DIFFERENT step satisfy this step', () => {
    const content = [
      'jobs:',
      '  review:',
      '    steps:',
      '      - uses: anthropics/claude-code-action@v1',
      '        with:',
      '          prompt: review',
      '      - uses: some/other-action@v1',
      '        with:',
      '          github_token: ${{ secrets.GITHUB_TOKEN }}',
      '',
    ].join('\n');
    expect(findTokenlessActionSteps(content)).toHaveLength(1);
  });

  it('does not let a github_token under env: (outside with:) satisfy the guard', () => {
    const content = [
      'jobs:',
      '  review:',
      '    steps:',
      '      - uses: anthropics/claude-code-action@v1',
      '        env:',
      '          github_token: ${{ secrets.GITHUB_TOKEN }}',
      '        with:',
      '          prompt: review',
      '',
    ].join('\n');
    expect(findTokenlessActionSteps(content)).toHaveLength(1);
  });

  it('an empty github_token value does not satisfy the guard', () => {
    const content = [
      'jobs:',
      '  review:',
      '    steps:',
      '      - uses: anthropics/claude-code-action@v1',
      '        with:',
      '          github_token:',
      '          prompt: review',
      '',
    ].join('\n');
    expect(findTokenlessActionSteps(content)).toHaveLength(1);
  });

  /**
   * Found by the LIVE reviewer on this scan's own PR (#1478, run 30195313198): the original
   * `/^github_token:\s*\S/` accepted `github_token: ''` because the quote matches `\S`. The action
   * gates on truthiness (`if (providedToken)`), so an empty value falls through to the OIDC
   * exchange and restores the silent skip — the guard's own bypass.
   */
  it.each(["''", '""', "  ''  ", '" "'])(
    'RED: a quoted-empty github_token value (%s) does not satisfy the guard',
    (value) => {
      expect(hasNonEmptyTokenValue(`github_token: ${value}`)).toBe(false);
      const content = [
        'jobs:',
        '  review:',
        '    steps:',
        '      - uses: anthropics/claude-code-action@v1',
        '        with:',
        `          github_token: ${value}`,
        '          prompt: review',
        '',
      ].join('\n');
      expect(findTokenlessActionSteps(content)).toHaveLength(1);
    },
  );

  /**
   * The reviewer's SECOND catch on this scan's own PR, same class as the first: YAML resolves
   * `github_token: # TODO` to null, but capturing everything after the colon reads the COMMENT as
   * the value. The action gates on truthiness, so null falls through to the OIDC exchange.
   */
  it.each([
    'github_token: # TODO fill in',
    'github_token:   # comment',
    "github_token: '' # left blank on purpose",
    'github_token: "" # ditto',
  ])('RED: a comment is not a value (%s)', (line) => {
    expect(hasNonEmptyTokenValue(line)).toBe(false);
    const content = [
      'jobs:',
      '  review:',
      '    steps:',
      '      - uses: anthropics/claude-code-action@v1',
      '        with:',
      `          ${line}`,
      '          prompt: review',
      '',
    ].join('\n');
    expect(findTokenlessActionSteps(content)).toHaveLength(1);
  });

  it.each([
    '${{ secrets.GITHUB_TOKEN }}',
    "'${{ secrets.GITHUB_TOKEN }}'",
    // Deliberately NOT token-shaped: a literal here only needs to be a non-empty plain scalar, and
    // a realistic-looking credential in a fixture is what secret scanners exist to catch.
    'a-plain-scalar',
    '${{ secrets.GITHUB_TOKEN }} # the load-bearing input',
    "'tok#en'",
  ])('GREEN: a real github_token value (%s) satisfies the guard', (value) => {
    expect(hasNonEmptyTokenValue(`github_token: ${value}`)).toBe(true);
  });

  it('holds on the real repository', () => {
    const { findings, checked } = findReviewTokenSupplyFindings(REPO_ROOT);
    // The guard must actually be guarding something here: the review workflow exists and passes.
    expect(checked).toContain(path.join('.github', 'workflows', 'claude-code-review.yml'));
    expect(findings).toEqual([]);
  });
});
