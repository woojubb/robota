/**
 * INFRA-151 — keep the security gate while avoiding unconditional heavyweight work.
 *
 * These assertions target workflow text because trigger and action configuration are the runtime
 * surface. They deliberately inspect executable keys/action references rather than comments.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const readWorkflow = (name) => readFileSync(path.join(ROOT, '.github/workflows', name), 'utf8');

const REVIEW_GATE = readWorkflow('review-gate.yml');
const CODEQL = readWorkflow('codeql.yml');
const SCANS_FULL = readWorkflow('scans-full.yml');
const CI = readWorkflow('ci.yml');

function executableLines(source) {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

function extractPushPaths(source) {
  const lines = source.split('\n');
  const pathsStart = lines.findIndex(
    (line, index) => line === '    paths:' && lines[index - 1]?.trim(),
  );
  if (pathsStart < 0) return [];

  const paths = [];
  for (const line of lines.slice(pathsStart + 1)) {
    if (/^  \S/.test(line) || /^    \S/.test(line)) break;
    const match = /^      - ['"]?([^'"\n]+)['"]?$/.exec(line);
    if (match) paths.push(match[1]);
  }
  return paths;
}

function githubPathMatches(pattern, candidate) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0')
    .replaceAll('*', '[^/]*')
    .replaceAll('\0', '.*')
    .replaceAll('?', '[^/]');
  return new RegExp(`^${escaped}$`).test(candidate);
}

describe('CodeQL remains required but uses the JavaScript no-build path', () => {
  it('retains pull-request analysis as a prerequisite of the required review-gate job', () => {
    const live = executableLines(REVIEW_GATE);
    expect(live).toMatch(/^  analyze:\n/m);
    expect(live).toContain('uses: github/codeql-action/analyze@v4');
    expect(live).toMatch(/^    needs: \[classify, analyze\]$/m);
    expect(live).toMatch(/^  review-gate:\n/m);
    expect(REVIEW_GATE).not.toContain('queries: security-and-quality');
    expect(CODEQL).toContain('queries: security-and-quality');
  });

  it.each([
    ['review-gate.yml', REVIEW_GATE],
    ['codeql.yml', CODEQL],
  ])('%s explicitly selects build-mode none and has no Autobuild action', (_name, source) => {
    const live = executableLines(source);
    expect(live).toMatch(/^\s+languages: javascript-typescript$/m);
    expect(live).toMatch(/^\s+build-mode: none$/m);
    expect(live).not.toContain('github/codeql-action/autobuild');
  });

  it('keeps standalone main/develop analyses to seed the overlay-base cache', () => {
    const live = executableLines(CODEQL);
    expect(live).toMatch(/^  push:\n    branches: \[main, develop\]$/m);
    expect(live).toContain('uses: github/codeql-action/analyze@v4');
  });
});

describe('scans-full only auto-runs for verification ownership changes', () => {
  const pushPaths = extractPushPaths(SCANS_FULL);

  it('retains manual dispatch and fail-closed full integration execution', () => {
    const live = executableLines(SCANS_FULL);
    expect(live).toMatch(/^  workflow_dispatch:$/m);
    expect(live).toContain(
      'pnpm harness:scan -- --context integration --skip dist --skip build-contracts',
    );
    expect(live).toMatch(
      /^      - name: File or update the red-suite issue\n        if: failure\(\)$/m,
    );
  });

  it('includes verification control-plane, governance, and root configuration owners', () => {
    expect(pushPaths).toEqual(
      expect.arrayContaining([
        'scripts/harness/**',
        '.github/workflows/**',
        '.agents/rules/**',
        '.agents/specs/**',
        'AGENTS.md',
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'vitest.config.ts',
      ]),
    );
  });

  it('does not auto-trigger for an ordinary package source change', () => {
    expect(pushPaths.length).toBeGreaterThan(0);
    expect(
      pushPaths.some((pattern) => githubPathMatches(pattern, 'packages/agent-core/src/index.ts')),
    ).toBe(false);
  });
});

describe('required scans has a bounded process envelope', () => {
  it('times out the aggregate instead of waiting forever for a hung child', () => {
    const scans = CI.slice(CI.indexOf('\n  scans:\n'), CI.indexOf('\n  dependency-audit:\n'));
    expect(scans).toContain('timeout-minutes: 10');
  });
});
