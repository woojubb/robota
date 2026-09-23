import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const CI = readFileSync(path.join(WORKFLOWS, 'ci.yml'), 'utf8');
const REQUIRED = JSON.parse(
  readFileSync(path.join(ROOT, '.github', 'required-status-checks.json'), 'utf8'),
);

function workflowSources() {
  return readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, source: readFileSync(path.join(WORKFLOWS, name), 'utf8') }));
}

describe('GitHub Actions runtime maintenance', () => {
  it('uses the current v6 major for every retained setup and cache reference', () => {
    const references = workflowSources().flatMap(({ name, source }) =>
      [
        ...source.matchAll(
          /uses:\s+(actions\/setup-node|pnpm\/action-setup|actions\/cache)@(v\d+)/gu,
        ),
      ].map(([, action, version]) => ({ name, action, version })),
    );

    expect(references.length).toBeGreaterThan(0);
    expect(references.filter(({ version }) => version !== 'v6')).toEqual([]);
    expect(references.some(({ action }) => action === 'actions/setup-node')).toBe(true);
    expect(references.some(({ action }) => action === 'pnpm/action-setup')).toBe(true);
  });
});

describe('develop verification interface', () => {
  it('accepts explicit refs for a PR-free benchmark run', () => {
    const trigger = CI.slice(CI.indexOf('\non:\n'), CI.indexOf('\nconcurrency:\n'));
    expect(trigger).toContain('\n  pull_request:\n');
    expect(trigger).toContain('\n  workflow_dispatch:\n');
    expect(trigger).toContain('\n      base_ref:\n');
    expect(trigger).toContain('\n      head_ref:\n');
    expect(trigger).toContain('\n      pr_body:\n');
  });

  it('declares exactly four stable develop decisions', () => {
    expect(REQUIRED.branches.develop.required_status_checks.map(({ context }) => context)).toEqual([
      'pr-validation',
      'security',
      'review-policy',
      'workflow provenance',
    ]);
    expect(REQUIRED.branches.develop.strict_required_status_checks_policy).toBe(false);
    expect(CI).toMatch(/^  pr-validation:\n    name: pr-validation$/m);
    expect(CI).toMatch(/^  security:\n    name: security$/m);
  });

  it('keeps normal PR-only review and provenance workflows free of manual bypass contexts', () => {
    for (const file of ['review-gate.yml', 'workflow-provenance-gate.yml']) {
      const source = readFileSync(path.join(WORKFLOWS, file), 'utf8');
      expect(source).not.toMatch(/^  workflow_dispatch:/mu);
    }
  });

  it('does not recreate removed required contexts as benchmark companions', () => {
    for (const removed of [
      'quality',
      'scans',
      'commitlint',
      'dependency audit',
      'benchmark review-gate',
      'benchmark workflow provenance',
    ]) {
      expect(CI).not.toMatch(new RegExp(`^    name: ${removed}$`, 'm'));
    }
  });
});
