import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

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
  const dir = makeTemp('infra-097-');
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
            { context: 'security', workflow: '.github/workflows/ci.yml', job: 'security' },
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
  writeFileSync(path.join(dir, '.gitleaks.toml'), '[allowlist]\n');
  writeFileSync(path.join(dir, '.github/actionlint.yaml'), 'self-hosted-runner: {}\n');
  writeFileSync(path.join(dir, 'osv-scanner.toml'), '[IgnoredVulns]\n');
  mkdirSync(path.join(dir, 'scripts/harness'), { recursive: true });
  writeFileSync(
    path.join(dir, 'scripts/harness/generate-dependency-review-license-exemptions.mjs'),
    'export {};\n',
  );
  for (const entry of [
    'classify-changed-paths.mjs',
    'product-integration-tests.mjs',
    'review-verdict-projection.mjs',
    'harness-test-tiers.mjs',
    'run-all-scans.mjs',
  ]) {
    writeFileSync(path.join(dir, 'scripts/harness', entry), 'export {};\n');
  }
  writeFileSync(
    path.join(dir, 'scripts/harness/scan-workflow-provenance.mjs'),
    "import './provenance-policy.mjs';\n",
  );
  writeFileSync(path.join(dir, 'scripts/harness/provenance-policy.mjs'), 'export {};\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '--quiet', '-m', 'chore: base');
  return dir;
}

describe('workflow-provenance — criteria are READ from the registry (INFRA-097)', () => {
  it('derives the guarded set from the repository SSOT', () => {
    const { workflows } = readGuardedWorkflows(WORKSPACE_ROOT);

    // Exactly the files that provide a required context today. Adding a required check in a new
    // workflow must govern that workflow with no code change here — and INFRA-097 step 5 is the
    // demonstration: registering `workflow provenance` put the gate itself into this set, derived,
    // with nothing edited here.
    expect(workflows).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/dependency-review.yml',
      '.github/workflows/gitleaks.yml',
      '.github/workflows/review-gate.yml',
      '.github/workflows/workflow-provenance-gate.yml',
    ]);
  });

  it('names which contexts each guarded workflow provides', () => {
    const { contextsByWorkflow } = readGuardedWorkflows(WORKSPACE_ROOT);
    const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
    const directWorkflows = new Set();
    const total = Object.values(registry.branches).reduce(
      (n, b) =>
        n +
        b.required_status_checks.filter((check) => {
          if (check.workflow) directWorkflows.add(check.workflow);
          return check.workflow;
        }).length,
      0,
    );

    expect(
      [...contextsByWorkflow]
        .filter(([workflow]) => directWorkflows.has(workflow))
        .flatMap(([, contexts]) => contexts),
    ).toHaveLength(total);
    expect(contextsByWorkflow.get('.github/workflows/gitleaks.yml')).toContain(
      'security (develop)',
    );
    expect(contextsByWorkflow.get('.github/workflows/dependency-review.yml')).toContain(
      'security (develop)',
    );
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
    const empty = makeTemp('infra-097-empty-');
    scratch.push(empty);

    expect(() => findWorkflowProvenanceFindings(empty)).toThrow(/missing from/);
  });

  it('fails closed when the registry names no workflow', () => {
    const dir = makeTemp('infra-097-bare-');
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

  it('flags the guarded source when its workflow is renamed', () => {
    const dir = repoWithGuardedWorkflow();
    const source = '.github/workflows/ci.yml';
    const destination = '.github/workflows/ci-renamed.yml';
    git(dir, 'mv', source, destination);
    writeFileSync(
      path.join(dir, destination),
      `${readFileSync(path.join(dir, destination), 'utf8')}# renamed control plane\n`,
    );
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'ci: rename guarded workflow');

    const renameDiff = git(dir, 'diff', '--name-status', '-M', 'HEAD~1...HEAD');
    expect(renameDiff.stdout).toMatch(/^R\d+\s+\.github\/workflows\/ci\.yml\s+/mu);

    const { findings } = findWorkflowProvenanceFindings(dir, 'HEAD~1');

    expect(findings.map((finding) => finding.file)).toContain(source);
    expect(findings.find((finding) => finding.file === source)?.problem).toMatch(
      /can move its own gate/,
    );
  });

  it('flags the registry carrier so a change cannot silently shrink the next guarded set', () => {
    const dir = repoWithGuardedWorkflow();
    const registryFile = path.join(dir, '.github/required-status-checks.json');
    const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
    registry.branches.develop = structuredClone(registry.branches.main);
    writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'ci: adjust required checks');

    const { findings } = findWorkflowProvenanceFindings(dir, 'HEAD~1');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.github/required-status-checks.json');
    expect(findings[0].problem).toMatch(/guarded workflow set/);
    expect(findings[0].problem).toMatch(/live ruleset/);
  });

  it('flags a verdict-controlling security policy edit before it can allow a secret', () => {
    const dir = repoWithGuardedWorkflow();
    writeFileSync(
      path.join(dir, '.gitleaks.toml'),
      '[[allowlists]]\nregexTarget = "match"\nregexes = [".*"]\n',
    );
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'security: relax secret policy');

    const { findings } = findWorkflowProvenanceFindings(dir, 'HEAD~1');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.gitleaks.toml');
    expect(findings[0].problem).toMatch(/controls required check\(s\): security \(main\)/);
    expect(findings[0].problem).toMatch(/make the security scan green over a secret/);
  });

  it('flags an actionlint policy edit before it can suppress required workflow diagnostics', () => {
    const dir = repoWithGuardedWorkflow();
    writeFileSync(
      path.join(dir, '.github/actionlint.yaml'),
      'paths:\n  ignore:\n    - .github/workflows/ci.yml\n',
    );
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'ci: suppress workflow diagnostics');

    const { findings } = findWorkflowProvenanceFindings(dir, 'HEAD~1');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.github/actionlint.yaml');
    expect(findings[0].problem).toMatch(/actionlint|required/i);
  });

  it('flags a permissive edit anywhere in the trusted implementation import closure', () => {
    const dir = repoWithGuardedWorkflow();
    writeFileSync(
      path.join(dir, 'scripts/harness/provenance-policy.mjs'),
      'export const findings = []; // unconditional pass\n',
    );
    git(dir, 'add', '-A');
    git(dir, 'commit', '--quiet', '-m', 'ci: weaken provenance policy');

    const { findings } = findWorkflowProvenanceFindings(dir, 'HEAD~1');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('scripts/harness/provenance-policy.mjs');
    expect(findings[0].problem).toMatch(/trusted required-check implementation/);
    expect(findings[0].problem).toMatch(/later pull request/);
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

    // EXACT value against a fixture of known size — one registry, one guarded workflow, three
    // required-security policy inputs, one actionlint policy, six trusted entries, and one
    // transitive helper. The counter is asserted after a second run so accumulation behind a bound
    // would hide it.
    findWorkflowProvenanceFindings(dir);

    expect(readExaminedWorkflowCount(dir)).toBe(13);

    findWorkflowProvenanceFindings(dir);

    expect(readExaminedWorkflowCount(dir)).toBe(13);
  });
});

describe('workflow-provenance — this repository (INFRA-097)', () => {
  it('reports only the PR-loaded guarded workflows; reusable children stay in the guarded set', () => {
    const { selfLoading, examined } = findWorkflowProvenanceFindings(WORKSPACE_ROOT);

    // The earlier case asserted 2 of 2 and said: "if this ever shrinks, a trusted-provenance design
    // landed and INFRA-097 should be revisited." It has. `workflow provenance` became a required
    // context in step 5, which pulled its own workflow into the guarded set — and that workflow is
    // the one file here that does NOT load from the pull request, because it runs on
    // `pull_request_target`. So the ratio, not the count, is the live signal: the exposure is now
    // named as two specific files rather than as "everything required".
    expect(examined).toBe(57);
    expect(selfLoading).toHaveLength(2);
    expect(selfLoading.map((finding) => finding.workflow ?? finding)).not.toContain(
      '.github/workflows/workflow-provenance-gate.yml',
    );
  });
});

describe('judging a change from a checkout that is NOT that change (INFRA-097, issue #1719)', () => {
  /*
   * The trusted plane checks out the BASE, fetches the pull request head without checking it out,
   * and asks about `FETCH_HEAD`. So the compared head has to be an ARGUMENT — a scan that always
   * diffed `HEAD` would report on the base against itself, which is empty, and a gate reporting
   * "nothing touched" while sitting on the wrong tree is a green that measured nothing.
   *
   * Driven against real history rather than a fixture, because the property under test is what the
   * `git diff` range does, and a stubbed git would be asserting the stub.
   */
  const TOUCHED_CI = '024ca7128dda01e5470b14eb27aeaa3bc65a1995';

  it('reports a guarded workflow touched by the NAMED head', () => {
    const { findings } = findWorkflowProvenanceFindings(
      WORKSPACE_ROOT,
      `${TOUCHED_CI}~1`,
      TOUCHED_CI,
    );
    expect(findings.map((f) => f.file)).toContain('.github/workflows/ci.yml');
  });

  it('reports nothing for the same base when the head is that base', () => {
    // The paired direction. Without it the case above could be passing on a scan that reports every
    // guarded workflow regardless of the range.
    const { findings } = findWorkflowProvenanceFindings(
      WORKSPACE_ROOT,
      `${TOUCHED_CI}~1`,
      `${TOUCHED_CI}~1`,
    );
    expect(findings).toEqual([]);
  });

  it('defaults to HEAD when no head is named, so existing callers are unchanged', () => {
    // `--base-ref` alone has one caller already (the pre-push scan suite). The argument was ADDED,
    // and a default that silently changed what those callers compare would be a migration nobody
    // asked for.
    const named = findWorkflowProvenanceFindings(WORKSPACE_ROOT, 'HEAD~1', 'HEAD').findings;
    const defaulted = findWorkflowProvenanceFindings(WORKSPACE_ROOT, 'HEAD~1').findings;
    expect(defaulted).toEqual(named);
  });
});
