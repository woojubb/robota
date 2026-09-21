import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const CI_PATH = path.join(WORKFLOWS, 'ci.yml');

function workflowSources() {
  return readdirSync(WORKFLOWS)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => ({ name, source: readFileSync(path.join(WORKFLOWS, name), 'utf8') }));
}

function jobBlock(source, jobId) {
  const start = source.indexOf(`\n  ${jobId}:\n`);
  if (start < 0) throw new Error(`missing job ${jobId}`);
  const next = source.slice(start + 1).search(/\n  [a-zA-Z0-9_-]+:\n/u);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

/**
 * jobId → [required context, the display name the job publishes]. Nine jobs ARE the required
 * context and publish its name. The two `workflow_dispatch`-only companions stand in for gates owned
 * by other workflows and MUST publish a different name: a job whose `if:` is false is still
 * registered as a `skipped` check-run under its display name on every commit, so a companion named
 * after the required context put two rows under one required name on every pull request
 * (CHECKS-2664). `benchmark-summary` maps the context to the companion name instead.
 */
const REQUIRED_BENCHMARK_JOBS = new Map([
  ['build', ['build', 'build']],
  ['quality', ['quality', 'quality']],
  ['scans', ['scans', 'scans']],
  ['dependency-audit', ['dependency audit', 'dependency audit']],
  ['commitlint', ['commitlint', 'commitlint']],
  ['tui-e2e', ['tui-e2e', 'tui-e2e']],
  ['examples-typecheck', ['examples-typecheck', 'examples-typecheck']],
  ['windows-shell', ['windows-shell', 'windows-shell']],
  ['benchmark-review-gate', ['review-gate', 'benchmark review-gate']],
  ['benchmark-workflow-provenance', ['workflow provenance', 'benchmark workflow provenance']],
  [
    'regression-red-proof',
    [
      'regression-red-proof (enforcing: accidental-green only)',
      'regression-red-proof (enforcing: accidental-green only)',
    ],
  ],
]);

const REQUIRED_CONTEXTS = new Set(
  [...REQUIRED_BENCHMARK_JOBS.values()].map(([context]) => context),
);

describe('GitHub Actions runtime maintenance', () => {
  it('uses the current v6 majors for setup-node, pnpm setup, and cache references', () => {
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
    expect(references.some(({ action }) => action === 'actions/cache')).toBe(true);
  });
});

describe('PR-free develop required-context benchmark', () => {
  const ci = readFileSync(CI_PATH, 'utf8');

  it('accepts an explicit base, head, and synthetic PR body from one workflow dispatch', () => {
    const trigger = ci.slice(ci.indexOf('\non:\n'), ci.indexOf('\nconcurrency:\n'));
    expect(trigger).toContain('\n  pull_request:\n');
    expect(trigger).toContain('\n  workflow_dispatch:\n');
    expect(trigger).toContain('\n      base_ref:\n');
    expect(trigger).toContain('\n      head_ref:\n');
    expect(trigger).toContain('\n      pr_body:\n');
  });

  it('runs and measures exactly one job for each of the 11 required contexts', () => {
    for (const [jobId, [, jobName]] of REQUIRED_BENCHMARK_JOBS) {
      const block = jobBlock(ci, jobId);
      const escaped = jobName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
      expect(block).toMatch(new RegExp(`^    name: ['"]?${escaped}['"]?$`, 'mu'));
      expect(block).toContain('Refuse unsafe benchmark check attachment');
    }

    const summary = jobBlock(ci, 'benchmark-summary');
    expect(summary).toContain('Measure all 11 develop-required contexts');
    expect(summary).toContain('/actions/runs/${RUN_ID}/jobs?per_page=100');
    expect(summary).toContain('duration_seconds');
    expect(summary).toContain('elapsed_seconds');
    expect(summary).toContain('map(.elapsed_seconds) | max) <= 128');
    expect(summary).toContain('length == 11');
    // The summary's map is keyed by the required context and resolves to the measuring job.
    for (const [context, jobName] of REQUIRED_BENCHMARK_JOBS.values()) {
      expect(summary).toContain(`${JSON.stringify(context)}:${JSON.stringify(jobName)}`);
    }
  });

  it('never lets a workflow_dispatch-only companion publish a required context name (CHECKS-2664)', () => {
    // The red-proof for the collision: a job that exists only for the dispatch benchmark is still
    // registered as a `skipped` check-run on every pull request, so the display name the FILE gives
    // it must not be one branch protection matches on. Read from the block, not from the map above,
    // so a companion renamed back to the context is caught by the file and not excused by the table.
    let companions = 0;
    for (const jobId of REQUIRED_BENCHMARK_JOBS.keys()) {
      const block = jobBlock(ci, jobId);
      if (!/^    if: github\.event_name == 'workflow_dispatch'$/mu.test(block)) continue;
      companions += 1;
      const published = /^    name: ['"]?(.+?)['"]?$/mu.exec(block)?.[1] ?? jobId;
      expect(REQUIRED_CONTEXTS.has(published), `${jobId} publishes \`${published}\``).toBe(false);
    }
    expect(companions).toBe(2);
  });

  it('attaches manual check runs only to develop, never to a feature PR head', () => {
    for (const jobId of REQUIRED_BENCHMARK_JOBS.keys()) {
      const block = jobBlock(ci, jobId);
      expect(block).toContain("github.ref != 'refs/heads/develop'");
      expect(block).toContain('core.setFailed');
    }
    expect(ci).toContain(
      "ref: ${{ github.event_name == 'workflow_dispatch' && inputs.head_ref || '' }}",
    );
  });

  it('keeps normal PR-only review and provenance workflows free of manual bypass contexts', () => {
    for (const file of ['review-gate.yml', 'workflow-provenance-gate.yml']) {
      const source = readFileSync(path.join(WORKFLOWS, file), 'utf8');
      expect(source).not.toMatch(/^  workflow_dispatch:/mu);
    }
  });

  it('measures the required PR policy gate while CodeQL runs post-merge', () => {
    const review = jobBlock(ci, 'benchmark-review-gate');
    expect(review).not.toContain('github/codeql-action/');
    expect(review).toContain('CodeQL runs after merge on develop/main');
    expect(review).toContain('N/A without a pull request');
  });

  it('marks PR-only governance scans N/A during a manual benchmark', () => {
    const scans = jobBlock(ci, 'scans');
    expect(scans).toContain("BENCHMARK_MODE: ${{ github.event_name == 'workflow_dispatch' }}");
    expect(scans).toContain(
      'scan_args+=(--skip lane-declaration --skip user-execution-plan-order)',
    );
  });
});
