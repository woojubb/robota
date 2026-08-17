import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  findWorkflowProvenanceFindings,
  readExaminedWorkflowCount,
  readGuardedWorkflows,
  triggersFromPullRequest,
} from '../scan-workflow-provenance.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const REGISTRY = fileURLToPath(
  new URL('../../../.github/required-status-checks.json', import.meta.url),
);

const scratch = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function git(dir, ...args) {
  return spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

/**
 * A repository carrying the registry and one guarded workflow, with a base commit to diff against.
 *
 * Built as a real git repository because the scan judges a CHANGE: a fixture that only writes files
 * would exercise the registry read and never the thing the issue is about.
 */
function repoWithGuardedWorkflow() {
  const dir = mkdtempSync(path.join(tmpdir(), 'infra-097-'));
  scratch.push(dir);
  spawnSync('git', ['init', '--quiet', '--initial-branch=main', dir]);
  git(dir, 'config', 'user.email', 'harness@example.test');
  git(dir, 'config', 'user.name', 'Harness');
  mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(
    path.join(dir, '.github/required-status-checks.json'),
    JSON.stringify({
      branches: {
        main: {
          required_status_checks: [
            { context: 'build', workflow: '.github/workflows/ci.yml', job: 'build' },
          ],
        },
      },
    }),
  );
  writeFileSync(
    path.join(dir, '.github/workflows/ci.yml'),
    [
      'name: CI',
      '',
      'on:',
      '  pull_request:',
      '    branches: [main]',
      '',
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '',
    ].join('\n'),
  );
  writeFileSync(path.join(dir, 'README.md'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'chore: base');
  return dir;
}

describe('workflow-provenance — criteria are READ from the registry (INFRA-097)', () => {
  it('derives the guarded set from the repository SSOT', () => {
    const { workflows } = readGuardedWorkflows(WORKSPACE_ROOT);

    // Exactly the files that provide a required context today. Adding a required check in a new
    // workflow must govern that workflow with no code change here.
    expect(workflows).toEqual(['.github/workflows/ci.yml', '.github/workflows/review-gate.yml']);
  });

  it('names which contexts each guarded workflow provides', () => {
    const { contextsByWorkflow } = readGuardedWorkflows(WORKSPACE_ROOT);
    const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
    const total = Object.values(registry.branches).reduce(
      (n, b) => n + b.required_status_checks.filter((c) => c.workflow).length,
      0,
    );

    expect([...contextsByWorkflow.values()].flat()).toHaveLength(total);
  });

  it('reads the trigger off the `on:` block, not off any mention of the string', () => {
    expect(triggersFromPullRequest('on:\n  pull_request:\n    branches: [main]\n')).toBe(true);
    // The shapes a trusted design moves toward — these load from the base, not from the PR.
    expect(triggersFromPullRequest('on:\n  pull_request_target:\n    branches: [main]\n')).toBe(
      false,
    );
    expect(triggersFromPullRequest('on:\n  workflow_run:\n    workflows: [CI]\n')).toBe(false);
    // A step that merely names it is not a trigger.
    expect(
      triggersFromPullRequest(
        'on:\n  schedule:\n    - cron: 0 0 * * *\njobs:\n  a:\n    steps:\n      - run: echo pull_request:\n',
      ),
    ).toBe(false);
  });

  it('fails closed when the registry is absent', () => {
    const empty = mkdtempSync(path.join(tmpdir(), 'infra-097-empty-'));
    scratch.push(empty);

    expect(() => findWorkflowProvenanceFindings(empty)).toThrow(/missing from/);
  });

  it('fails closed when the registry names no workflow', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'infra-097-bare-'));
    scratch.push(dir);
    mkdirSync(path.join(dir, '.github'), { recursive: true });
    writeFileSync(
      path.join(dir, '.github/required-status-checks.json'),
      JSON.stringify({ branches: { main: { required_status_checks: [] } } }),
    );

    expect(() => findWorkflowProvenanceFindings(dir)).toThrow(/names no workflow/);
  });
});

describe('workflow-provenance — a change that moves its own gate (INFRA-097)', () => {
  it('flags a change that edits the workflow reporting its own required check', () => {
    // The adversarial case the issue asks for: a pull request replacing its own required gate.
    const dir = repoWithGuardedWorkflow();
    writeFileSync(
      path.join(dir, '.github/workflows/ci.yml'),
      [
        'name: CI',
        '',
        'on:',
        '  pull_request:',
        '    branches: [main]',
        '',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: exit 0   # unconditional pass',
        '',
      ].join('\n'),
    );
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'ci: adjust build');

    const { findings } = findWorkflowProvenanceFindings(dir, 'HEAD~1');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.github/workflows/ci.yml');
    expect(findings[0].problem).toMatch(/build \(main\)/);
    expect(findings[0].problem).toMatch(/can move its own gate/);
  });

  it('says nothing about a change that leaves the control plane alone', () => {
    // The property that keeps the guard readable: ordinary work draws no comment.
    const dir = repoWithGuardedWorkflow();
    writeFileSync(path.join(dir, 'README.md'), 'ordinary work\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'docs: readme');

    expect(findWorkflowProvenanceFindings(dir, 'HEAD~1').findings).toEqual([]);
  });

  it('says nothing about an UNGUARDED workflow', () => {
    // Only workflows that provide a required context are the control plane. Flagging every
    // workflow edit would make the finding meaningless.
    const dir = repoWithGuardedWorkflow();
    writeFileSync(
      path.join(dir, '.github/workflows/nightly.yml'),
      'name: Nightly\n\non:\n  schedule:\n    - cron: 0 0 * * *\n',
    );
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'ci: nightly');

    expect(findWorkflowProvenanceFindings(dir, 'HEAD~1').findings).toEqual([]);
  });

  it('reports which guarded workflows load themselves from the pull request', () => {
    const dir = repoWithGuardedWorkflow();

    const { selfLoading } = findWorkflowProvenanceFindings(dir);

    // This is the standing exposure, reported even with no diff — the situation is visible on
    // every run rather than only when someone touches the file.
    expect(selfLoading).toEqual(['.github/workflows/ci.yml']);
  });

  it('errors rather than reporting clean when the diff cannot be read', () => {
    const dir = repoWithGuardedWorkflow();

    expect(() => findWorkflowProvenanceFindings(dir, 'no/such/ref')).toThrow(/measurement/i);
  });

  it('reports the size it examined, and does not accumulate across runs', () => {
    const dir = repoWithGuardedWorkflow();

    // EXACT value against a fixture of known size — one guarded workflow. The counter is asserted
    // AFTER a second run of the finder, because a counter that accumulated would read 2 there and
    // a bound would hide it.
    findWorkflowProvenanceFindings(dir);

    expect(readExaminedWorkflowCount(dir)).toBe(1);

    findWorkflowProvenanceFindings(dir);

    expect(readExaminedWorkflowCount(dir)).toBe(1);
  });
});

describe('workflow-provenance — this repository (INFRA-097)', () => {
  it('reports both guarded workflows as PR-loaded, which is the exposure INFRA-097 tracks', () => {
    const { selfLoading, examined } = findWorkflowProvenanceFindings(WORKSPACE_ROOT);

    // If this ever shrinks, a trusted-provenance design landed and INFRA-097 should be revisited —
    // which is exactly the signal the issue wants kept visible.
    expect(examined).toBe(2);
    expect(selfLoading).toHaveLength(2);
  });
});
