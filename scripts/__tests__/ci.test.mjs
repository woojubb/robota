import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { afterEach, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { assertBuild, assertGate, assertNativeGate, selectScope } from '../ci.mjs';

const selectionFault = vi.hoisted(() => ({ empty: false }));
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    spawnSync: (bin, args, options) =>
      selectionFault.empty && args.includes('--filter') && args.includes('list')
        ? { status: 0, stdout: '[]', stderr: '' }
        : original.spawnSync(bin, args, options),
  };
});

const roots = [];
afterEach(() => {
  selectionFault.empty = false;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function exec(cwd, bin, args) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function write(root, file, contents) {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), contents);
}
function fixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'ci-scope-'));
  roots.push(cwd);
  write(cwd, 'package.json', JSON.stringify({ private: true, packageManager: 'pnpm@8.15.4' }));
  write(
    cwd,
    'pnpm-workspace.yaml',
    'packages:\n - packages/*\n - apps/*\n - examples/capabilities/*\n',
  );
  const members = {
    'packages/core': { name: 'core' },
    'packages/framework': { name: 'framework', dependencies: { core: 'workspace:*' } },
    'packages/unrelated': { name: 'unrelated' },
    'apps/consumer': { name: 'consumer', dependencies: { framework: 'workspace:*' } },
    'apps/docs': { name: 'docs', private: true },
    'examples/capabilities/agent-eval': {
      name: 'eval',
      private: true,
      dependencies: { framework: 'workspace:*' },
    },
  };
  for (const [dir, data] of Object.entries(members)) {
    write(
      cwd,
      `${dir}/package.json`,
      JSON.stringify({ ...data, scripts: { build: 'echo build', test: 'echo test' } }),
    );
    write(cwd, `${dir}/src/index.ts`, 'export const value = 1;');
  }
  write(cwd, 'content/guide/cli.md', '# CLI');
  write(cwd, 'AGENTS.md', '# Base instructions');
  write(cwd, 'HARNESS.md', '# Base harness');
  write(cwd, 'examples/capabilities/agent-eval/README.md', '# Eval');
  write(cwd, '.github/workflows/ci.yml', 'name: old');
  exec(cwd, 'git', ['init', '-q']);
  exec(cwd, 'git', ['add', '.']);
  exec(cwd, 'git', [
    '-c',
    'user.name=CI fixture',
    '-c',
    'user.email=ci@example.test',
    'commit',
    '-qm',
    'base',
  ]);
  const base = exec(cwd, 'git', ['rev-parse', 'HEAD']);
  return { cwd, base, event: 'pull_request' };
}
function commit(cwd) {
  exec(cwd, 'git', ['add', '-A']);
  exec(cwd, 'git', [
    '-c',
    'user.name=CI fixture',
    '-c',
    'user.email=ci@example.test',
    'commit',
    '-qm',
    'change',
  ]);
}

const fixtureChecks = [
  'packages/core',
  'packages/framework',
  'packages/unrelated',
  'apps/consumer',
  'apps/docs',
  'examples/capabilities/agent-eval',
];
const fixtureBuild = ['packages/core', 'packages/framework', 'packages/unrelated'];
function expectFullCoverage(plan, checks = fixtureChecks, build = fixtureBuild) {
  expect(plan).toMatchObject({ full: true, developerDocs: false, release: true, docs: true });
  expect([...plan.checks].sort()).toEqual([...checks].sort());
  expect([...plan.build].sort()).toEqual([...build].sort());
}

it('runs tests separately from static and generated-release checks and always evaluates the merge gate', () => {
  const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  expect(workflow.jobs.tests).toBeDefined();
  expect(workflow.jobs['static-checks']).toBeDefined();
  for (const job of ['tests', 'static-checks']) {
    expect([...workflow.jobs[job].needs].sort()).toEqual(['scope', 'workspace-build']);
  }
  expect(workflow.jobs['workspace-build'].if).toBe("needs.scope.outputs.developer_docs != 'true'");
  expect(workflow.jobs['static-checks'].if).toBe("needs.scope.outputs.developer_docs != 'true'");
  expect(workflow.jobs.tests.if).toBe(
    "${{ !cancelled() && needs.scope.result == 'success' && (needs.scope.outputs.developer_docs == 'true' || needs.workspace-build.result == 'success') }}",
  );
  expect(workflow.jobs['release-checks'].needs).toBe('scope');
  expect(workflow.jobs['pr-validation'].if).toBe('${{ always() }}');
  expect(workflow.jobs['pr-validation'].needs).toEqual(
    expect.arrayContaining([
      'scope',
      'workspace-build',
      'static-checks',
      'tests',
      'release-checks',
    ]),
  );
  const check = parse(readFileSync('.github/workflows/ci-check.yml', 'utf8'));
  const download = check.jobs.check.steps.find((step) =>
    step.uses?.startsWith('actions/download-artifact'),
  );
  expect(download.if).toBe(
    "(inputs.kind == 'static' || inputs.kind == 'tests') && !fromJSON(inputs.plan).developerDocs",
  );
  expect(download.with['artifact-ids']).toBe('${{ inputs.artifact-id }}');
  for (const job of ['tests', 'static-checks']) {
    expect(workflow.jobs[job].with['artifact-id']).toBe(
      '${{ needs.workspace-build.outputs.artifact-id }}',
    );
  }
});

it('replaces the full-suite trigger for the exact mixed docs/private-example paths in PR #17', () => {
  const options = fixture();
  for (const file of [
    'content/guide/cli.md',
    'examples/capabilities/agent-eval/README.md',
    'examples/capabilities/agent-eval/src/index.ts',
    'examples/capabilities/agent-eval/src/index.test.ts',
  ])
    write(options.cwd, file, 'changed');
  const file = 'examples/capabilities/agent-eval/package.json';
  const manifest = JSON.parse(readFileSync(path.join(options.cwd, file), 'utf8'));
  manifest.scripts.test = 'vitest run';
  write(options.cwd, file, JSON.stringify(manifest));
  commit(options.cwd);
  const oldScope = exec(options.cwd, 'bash', [
    '-c',
    `if ! git diff --name-only '${options.base}...HEAD' | grep -qvE '^(packages|apps|examples)/'; then echo scoped; else echo full; fi`,
  ]);
  expect(oldScope).toBe('full');
  const plan = selectScope(options);
  expect(plan.full).toBe(false);
  expect(plan.release).toBe(false);
  expect(plan.docs).toBe(true);
  expect(plan.checks.sort()).toEqual(['apps/docs', 'examples/capabilities/agent-eval']);
  expect(plan.build.sort()).toEqual(['packages/core', 'packages/framework']);
});

it('uses pnpm 8 to select transitive dependents and their build dependencies without unrelated tests', () => {
  const options = fixture();
  write(options.cwd, 'packages/framework/src/index.ts', 'changed');
  commit(options.cwd);
  const plan = selectScope(options);
  expect(plan.full).toBe(false);
  expect(plan.checks.sort()).toEqual([
    'apps/consumer',
    'examples/capabilities/agent-eval',
    'packages/framework',
  ]);
  expect(plan.build.sort()).toEqual(['packages/core', 'packages/framework']);
  expect(plan.release).toBe(true);
});

it('maps docs-only changes to a real consumer with no unnecessary SDK build', () => {
  const options = fixture();
  write(options.cwd, 'content/guide/cli.md', 'changed');
  commit(options.cwd);
  expect(selectScope(options)).toMatchObject({
    full: false,
    checks: ['apps/docs'],
    build: [],
    docs: true,
    release: false,
  });
});

it('selects only root script validation for the exact developer documents from PR #26', () => {
  const options = fixture();
  write(options.cwd, 'AGENTS.md', '# Instructions');
  write(options.cwd, 'HARNESS.md', '# Developer harness');
  commit(options.cwd);
  expect(selectScope(options)).toMatchObject({
    full: false,
    developerDocs: true,
    checks: [],
    build: [],
    docs: false,
    release: false,
  });
});

function nativeBuildSelected(plan, result = 'success', event = 'pull_request', cancelled = false) {
  const workflow = parse(readFileSync('.github/workflows/release-bun-binaries.yml', 'utf8'));
  const condition = workflow.jobs['build-bun'].if;
  return (
    condition === undefined ||
    Function(
      'github',
      'needs',
      'fromJSON',
      'always',
      'cancelled',
      `return (${condition.replace(/^\s*\$\{\{/, '').replace(/\}\}\s*$/, '')});`,
    )(
      { event_name: event },
      {
        scope: {
          result,
          outputs: { plan: JSON.stringify(plan) },
        },
      },
      JSON.parse,
      () => true,
      () => cancelled,
    )
  );
}

it('does not schedule native builds for a proven developer-document-only PR', () => {
  const options = fixture();
  write(options.cwd, 'AGENTS.md', '# Revised instructions');
  write(options.cwd, 'HARNESS.md', '# Revised developer harness');
  commit(options.cwd);
  expect(nativeBuildSelected(selectScope(options))).toBe(false);
});

it.each([
  'packages/core/src/index.ts',
  'packages/framework/src/index.ts',
  'apps/consumer/src/index.ts',
  'pnpm-lock.yaml',
  'scripts/product/generate-workspace.mjs',
  '.github/workflows/release-bun-binaries.yml',
  'unknown/file.md',
])('keeps native validation when developer documents accompany %s', (file) => {
  const options = fixture();
  write(options.cwd, 'AGENTS.md', '# Revised instructions');
  write(options.cwd, file, 'changed');
  commit(options.cwd);
  const plan = selectScope(options);
  expect(nativeBuildSelected(plan)).toBe(true);
  expect(() =>
    assertNativeGate({
      scope: { result: 'success', outputs: { plan: JSON.stringify(plan) } },
      'build-bun': { result: 'skipped' },
    }),
  ).toThrow('expected success');
});

it('fails closed on invalid native selection and retains release builds', () => {
  const plan = JSON.parse(developerDocumentNeeds().scope.outputs.plan);
  for (const result of ['failure', 'cancelled', 'skipped']) {
    expect(nativeBuildSelected(plan, result)).toBe(true);
    expect(() =>
      assertNativeGate({ scope: { result }, 'build-bun': { result: 'success' } }),
    ).toThrow();
  }
  for (const event of ['push', 'workflow_dispatch'])
    expect(nativeBuildSelected(undefined, 'skipped', event)).toBe(true);
  expect(nativeBuildSelected({ developerDocs: false }, 'success', 'pull_request', true)).toBe(
    false,
  );
  for (const invalid of [undefined, '{invalid', '{}', '{"developerDocs":"true"}'])
    expect(() =>
      assertNativeGate({
        scope: { result: 'success', outputs: { plan: invalid } },
        'build-bun': { result: 'skipped' },
      }),
    ).toThrow();
});

it('requires successful native builds or the validated document-only omission', () => {
  const docs = JSON.parse(developerDocumentNeeds().scope.outputs.plan);
  const full = { developerDocs: false };
  for (const [plan, expected] of [
    [docs, 'skipped'],
    [full, 'success'],
  ]) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', undefined]) {
      const needs = {
        scope: { result: 'success', outputs: { plan: JSON.stringify(plan) } },
        'build-bun': { result },
      };
      if (result === expected) expect(() => assertNativeGate(needs)).not.toThrow();
      else expect(() => assertNativeGate(needs)).toThrow();
    }
  }
  for (const field of ['full', 'docs', 'release', 'checks', 'build']) {
    const invalid = {
      ...docs,
      [field]: ['checks', 'build'].includes(field) ? ['packages/core'] : true,
    };
    expect(() =>
      assertNativeGate({
        scope: { result: 'success', outputs: { plan: JSON.stringify(invalid) } },
        'build-bun': { result: 'skipped' },
      }),
    ).toThrow();
  }
  const workflow = parse(readFileSync('.github/workflows/release-bun-binaries.yml', 'utf8'));
  expect(workflow.jobs.scope.if).toBe("github.event_name == 'pull_request'");
  expect(workflow.jobs['build-bun'].needs).toBe('scope');
  expect(workflow.jobs['native-validation'].needs).toEqual(['scope', 'build-bun']);
  expect(workflow.jobs['native-validation'].if).toBe(
    "${{ !cancelled() && github.event_name == 'pull_request' }}",
  );
});

it('publishes successful release builds despite the intentionally skipped PR scope ancestor', () => {
  const workflow = parse(readFileSync('.github/workflows/release-bun-binaries.yml', 'utf8'));
  const condition = workflow.jobs['publish-bun'].if;
  expect(condition).toContain('!cancelled()');
  const selected = Function(
    'github',
    'needs',
    'cancelled',
    `return (${condition.replace(/^\s*\$\{\{/, '').replace(/\}\}\s*$/, '')});`,
  );
  for (const event of ['push', 'workflow_dispatch', 'pull_request']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      const needs = { scope: { result: 'skipped' }, 'build-bun': { result } };
      expect(selected({ event_name: event }, needs, () => false)).toBe(
        event !== 'pull_request' && result === 'success',
      );
      expect(selected({ event_name: event }, needs, () => true)).toBe(false);
    }
  }
});

it('executes the native aggregate command and rejects an omitted required build', () => {
  const script = fileURLToPath(new URL('../ci.mjs', import.meta.url));
  for (const [developerDocs, result, expected] of [
    [false, 'success', 0],
    [false, 'skipped', 1],
    [true, 'skipped', 0],
  ]) {
    const plan = developerDocs
      ? JSON.parse(developerDocumentNeeds().scope.outputs.plan)
      : { developerDocs };
    const child = spawnSync(process.execPath, [script, 'native-gate'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CI_NEEDS: JSON.stringify({
          scope: { result: 'success', outputs: { plan: JSON.stringify(plan) } },
          'build-bun': { result },
        }),
      },
    });
    expect(child.status, child.stderr).toBe(expected);
  }
});

it('keeps affected code checks when developer documents accompany a code change', () => {
  const options = fixture();
  write(options.cwd, 'AGENTS.md', '# Instructions');
  write(options.cwd, 'packages/framework/src/index.ts', 'changed');
  commit(options.cwd);
  const plan = selectScope(options);
  expect(plan.developerDocs).toBe(false);
  expect(plan.checks.sort()).toEqual([
    'apps/consumer',
    'examples/capabilities/agent-eval',
    'packages/framework',
  ]);
});

it('executes root scripts without selecting every workspace or requiring an archive for developer documents', () => {
  const options = fixture();
  const { cwd } = options;
  write(cwd, 'AGENTS.md', '# Instructions');
  commit(cwd);
  const plan = selectScope(options);
  write(
    cwd,
    'package.json',
    JSON.stringify({
      private: true,
      packageManager: 'pnpm@8.15.4',
      scripts: { 'test:scripts': 'node -e "console.log(\'root checked\')"' },
    }),
  );
  write(
    cwd,
    'packages/core/package.json',
    JSON.stringify({
      name: 'core',
      scripts: { test: 'node -e "process.exit(9)"' },
    }),
  );
  const script = fileURLToPath(new URL('../ci.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'tests'], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      RUNNER_TEMP: cwd,
      CI_PLAN: JSON.stringify(plan),
    },
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('root checked');
  expect(result.stdout).not.toContain('Scope:');
});

it.each(['AGENTS.md', 'HARNESS.md'])(
  'retains full validation for deleted developer document %s',
  (file) => {
    const options = fixture();
    rmSync(path.join(options.cwd, file));
    commit(options.cwd);
    expectFullCoverage(selectScope(options));
  },
);

it('allows an added root HARNESS.md', () => {
  const options = fixture();
  rmSync(path.join(options.cwd, 'HARNESS.md'));
  commit(options.cwd);
  const base = exec(options.cwd, 'git', ['rev-parse', 'HEAD']);
  write(options.cwd, 'HARNESS.md', '# New developer harness');
  commit(options.cwd);
  expect(selectScope({ ...options, base }).developerDocs).toBe(true);
});

it.each([
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'vitest.shared.ts',
  '.github/workflows/ci.yml',
  'scripts/product/generate-workspace.mjs',
  'unknown/file.md',
  'README.md',
  'nested/AGENTS.md',
  '.agents/skills/example/SKILL.md',
])('retains full coverage for global or unknown input %s', (file) => {
  const options = fixture();
  write(
    options.cwd,
    file,
    file === 'pnpm-workspace.yaml'
      ? 'packages:\n - packages/*\n - apps/*\n - examples/capabilities/*\n# changed'
      : 'changed',
  );
  commit(options.cwd);
  expectFullCoverage(selectScope(options));
});

it.each(['push', 'workflow_dispatch'])('keeps %s full even for developer documents', (event) => {
  const options = fixture();
  write(options.cwd, 'AGENTS.md', '# Updated instructions');
  commit(options.cwd);
  expectFullCoverage(selectScope({ ...options, event }));
});

it('falls back for empty changes and an invalid base', () => {
  const options = fixture();
  expectFullCoverage(selectScope(options));
  expectFullCoverage(selectScope({ ...options, base: 'missing-ref' }));
});

it('retains full validation when pnpm returns no affected workspaces for a valid change', () => {
  const options = fixture();
  write(options.cwd, 'packages/framework/src/index.ts', 'changed');
  commit(options.cwd);
  selectionFault.empty = true;
  const plan = selectScope(options);
  expectFullCoverage(plan);
  expect(plan.reason).toBe('incomplete selection');
});

it.each(['new', 'removed', 'renamed'])('falls back independently for a %s workspace', (change) => {
  const options = fixture();
  let checks = [...fixtureChecks];
  let build = [...fixtureBuild];
  if (change === 'new') {
    write(options.cwd, 'packages/new/package.json', JSON.stringify({ name: 'new' }));
    checks.push('packages/new');
  } else if (change === 'removed') {
    rmSync(path.join(options.cwd, 'packages/core'), { recursive: true });
    checks = checks.filter((dir) => dir !== 'packages/core');
    build = build.filter((dir) => dir !== 'packages/core');
  } else {
    exec(options.cwd, 'git', ['mv', 'packages/framework', 'packages/renamed']);
    checks = checks.map((dir) => (dir === 'packages/framework' ? 'packages/renamed' : dir));
    build = build.map((dir) => (dir === 'packages/framework' ? 'packages/renamed' : dir));
  }
  commit(options.cwd);
  expectFullCoverage(selectScope(options), checks, build);
});

it('requires full validation if a private example changes its dependency graph', () => {
  const options = fixture();
  const file = 'examples/capabilities/agent-eval/package.json';
  const manifest = JSON.parse(readFileSync(path.join(options.cwd, file), 'utf8'));
  manifest.dependencies.unrelated = 'workspace:*';
  write(options.cwd, file, JSON.stringify(manifest));
  commit(options.cwd);
  expectFullCoverage(selectScope(options));
});

function successfulNeeds(release = true) {
  return Object.fromEntries([
    ['scope', { result: 'success', outputs: { plan: JSON.stringify({ release }) } }],
    ...['workspace-build', 'static-checks', 'tests', 'release-checks'].map((job) => [
      job,
      { result: job === 'release-checks' && !release ? 'skipped' : 'success' },
    ]),
  ]);
}
it('accepts complete success and only the deliberate release omission', () => {
  expect(() => assertGate(successfulNeeds())).not.toThrow();
  expect(() => assertGate(successfulNeeds(false))).not.toThrow();
});
it.each(['scope', 'workspace-build', 'static-checks', 'tests', 'release-checks'])(
  'rejects failure, cancellation, and unexpected skip in %s',
  (job) => {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const needs = successfulNeeds();
      needs[job].result = result;
      expect(() => assertGate(needs)).toThrow();
    }
  },
);
it('does not hide dependency failures behind an explicitly omitted release job', () => {
  const needs = successfulNeeds(false);
  needs['workspace-build'].result = 'failure';
  needs.tests.result = 'skipped';
  expect(() => assertGate(needs)).toThrow();
});

function developerDocumentNeeds() {
  const needs = successfulNeeds(false);
  needs.scope.outputs.plan = JSON.stringify({
    full: false,
    developerDocs: true,
    checks: [],
    build: [],
    docs: false,
    release: false,
  });
  for (const job of ['workspace-build', 'static-checks']) needs[job].result = 'skipped';
  return needs;
}
it('accepts only the deliberate document omissions with successful root scripts', () => {
  expect(() => assertGate(developerDocumentNeeds())).not.toThrow();
  for (const job of ['scope', 'tests']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const needs = developerDocumentNeeds();
      needs[job].result = result;
      expect(() => assertGate(needs)).toThrow();
    }
  }
  for (const job of ['workspace-build', 'static-checks', 'release-checks']) {
    for (const result of ['failure', 'cancelled', 'success']) {
      const needs = developerDocumentNeeds();
      needs[job].result = result;
      expect(() => assertGate(needs)).toThrow();
    }
  }
  for (const field of ['full', 'docs', 'release', 'checks', 'build', 'developerDocs']) {
    const needs = developerDocumentNeeds();
    const plan = JSON.parse(needs.scope.outputs.plan);
    plan[field] = ['checks', 'build'].includes(field) ? ['packages/core'] : true;
    if (field === 'developerDocs') plan[field] = 'true';
    needs.scope.outputs.plan = JSON.stringify(plan);
    expect(() => assertGate(needs)).toThrow();
  }
});

it('rejects stale, mismatched, and missing build outputs', () => {
  const { cwd } = fixture();
  write(cwd, 'packages/core/dist/bin.js', 'process.stdout.write("built");');
  chmodSync(path.join(cwd, 'packages/core/dist/bin.js'), 0o755);
  const metadata = { sha: 'current', build: ['packages/core'], product: 'cedar' };
  const plan = { build: ['packages/core'] };
  expect(() => assertBuild(metadata, plan, 'current', cwd)).not.toThrow();
  expect(() => assertBuild(metadata, plan, 'other', cwd)).toThrow();
  expect(() => assertBuild(metadata, { build: [] }, 'current', cwd)).toThrow();
  expect(() => assertBuild({ ...metadata, product: 'amber' }, plan, 'current', cwd)).toThrow();
  rmSync(path.join(cwd, 'packages/core/dist'), { recursive: true });
  expect(() => assertBuild(metadata, plan, 'current', cwd)).toThrow('Missing build output');
});

it('runs the production build and clean test consumer with executable outputs, rejecting stale and missing archives', () => {
  const { cwd } = fixture();
  const consumer = mkdtempSync(path.join(os.tmpdir(), 'ci-consumer-'));
  const transfer = mkdtempSync(path.join(os.tmpdir(), 'ci-transfer-'));
  roots.push(consumer, transfer);
  write(
    cwd,
    'packages/core/build.mjs',
    `
    import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/bin.js', '#!/usr/bin/env node\\nprocess.stdout.write("built");');
    chmodSync('dist/bin.js', 0o755);
  `,
  );
  write(
    cwd,
    'packages/core/package.json',
    JSON.stringify({
      name: 'core',
      scripts: { build: 'node build.mjs', test: './dist/bin.js' },
    }),
  );
  write(
    cwd,
    'package.json',
    JSON.stringify({
      private: true,
      packageManager: 'pnpm@8.15.4',
      scripts: { 'test:scripts': 'node -e "console.log(\'root checked\')"' },
    }),
  );
  commit(cwd);
  exec(consumer, 'git', ['clone', '-q', cwd, '.']);
  expect(() => statSync(path.join(consumer, 'packages/core/dist'))).toThrow();
  const plan = { build: ['packages/core'], checks: ['packages/core'], docs: false, release: false };
  const script = fileURLToPath(new URL('../ci.mjs', import.meta.url));
  const run = (dir, kind) =>
    spawnSync(process.execPath, [script, kind], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, RUNNER_TEMP: transfer, CI_PLAN: JSON.stringify(plan) },
    });
  const build = run(cwd, 'build');
  expect(build.status, build.stderr).toBe(0);
  const tests = run(consumer, 'tests');
  expect(tests.status, tests.stderr).toBe(0);
  expect(tests.stdout).toContain('built');
  expect(tests.stdout).toContain('root checked');
  expect(JSON.parse(readFileSync(path.join(consumer, '.ci-build.json'), 'utf8'))).toEqual({
    sha: exec(cwd, 'git', ['rev-parse', 'HEAD']),
    build: plan.build,
    product: 'cedar',
  });
  expect(statSync(path.join(consumer, 'packages/core/dist/bin.js')).mode & 0o777).toBe(0o755);
  write(
    cwd,
    '.ci-build.json',
    JSON.stringify({ sha: 'stale', build: plan.build, product: 'cedar' }),
  );
  exec(cwd, 'tar', [
    '-czf',
    path.join(transfer, 'workspace-build.tgz'),
    '.ci-build.json',
    'packages/core/dist',
  ]);
  const stale = run(consumer, 'tests');
  expect(stale.status).not.toBe(0);
  expect(stale.stderr).toContain('Build artifact does not match');
  expect(stale.stdout).not.toContain('root checked');
  rmSync(path.join(transfer, 'workspace-build.tgz'));
  const missing = run(consumer, 'tests');
  expect(missing.status).not.toBe(0);
  expect(missing.stderr).toContain('tar -xzf');
  expect(missing.stdout).not.toContain('root checked');
});

it('runs every selected workspace with at most two overlapping tests after restoring the build artifact', () => {
  const { cwd } = fixture();
  const transfer = mkdtempSync(path.join(os.tmpdir(), 'ci-test-schedule-'));
  roots.push(transfer);
  const checks = ['packages/core', 'packages/framework', 'apps/consumer'];
  write(
    cwd,
    'workspace-test.mjs',
    `import { appendFileSync, existsSync } from 'node:fs';
     import { setTimeout } from 'node:timers/promises';
     const name = process.argv[2];
     if (!existsSync(new URL('./packages/core/dist/ready', import.meta.url))) throw new Error('Build artifact unavailable');
     const log = (event) => appendFileSync(process.env.CI_TEST_LOG, JSON.stringify({ name, event }) + '\\n');
     log('start');
     await setTimeout(750);
     log('end');
     if (name === process.env.CI_FAIL_WORKSPACE) process.exitCode = 7;
    `,
  );
  for (const dir of checks) {
    const file = `${dir}/package.json`;
    const manifest = JSON.parse(readFileSync(path.join(cwd, file), 'utf8'));
    manifest.scripts.test = `node ../../workspace-test.mjs ${dir}`;
    write(cwd, file, JSON.stringify(manifest));
  }
  write(
    cwd,
    'package.json',
    JSON.stringify({
      private: true,
      packageManager: 'pnpm@8.15.4',
      scripts: { 'test:scripts': 'node workspace-test.mjs root' },
    }),
  );
  commit(cwd);
  const plan = { build: ['packages/core'], checks, docs: false, release: false };
  write(cwd, 'packages/core/dist/ready', 'built');
  write(
    cwd,
    '.ci-build.json',
    JSON.stringify({
      sha: exec(cwd, 'git', ['rev-parse', 'HEAD']),
      build: plan.build,
      product: 'cedar',
    }),
  );
  exec(cwd, 'tar', [
    '-czf',
    path.join(transfer, 'workspace-build.tgz'),
    '.ci-build.json',
    'packages/core/dist',
  ]);
  rmSync(path.join(cwd, 'packages/core/dist'), { recursive: true });
  const script = fileURLToPath(new URL('../ci.mjs', import.meta.url));
  const logFile = path.join(transfer, 'tests.jsonl');
  const run = (failure) => {
    rmSync(logFile, { force: true });
    const result = spawnSync(process.execPath, [script, 'tests'], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        RUNNER_TEMP: transfer,
        CI_PLAN: JSON.stringify(plan),
        CI_TEST_LOG: logFile,
        CI_FAIL_WORKSPACE: failure ?? '',
      },
    });
    const events = readFileSync(logFile, 'utf8').trim().split('\n').map(JSON.parse);
    return { result, events };
  };
  const success = run();
  expect(success.result.status, success.result.stderr).toBe(0);
  expect(
    success.events
      .filter(({ event }) => event === 'start')
      .map(({ name }) => name)
      .sort(),
  ).toEqual([...checks, 'root'].sort());
  let active = 0;
  let peak = 0;
  for (const { name, event } of success.events) {
    if (name === 'root') {
      expect(active).toBe(0);
      continue;
    }
    active += event === 'start' ? 1 : -1;
    peak = Math.max(peak, active);
    expect(active).toBeGreaterThanOrEqual(0);
  }
  expect(active).toBe(0);
  expect(peak).toBe(2);
  const failure = run('packages/framework');
  expect(failure.result.status).not.toBe(0);
  expect(failure.events.some(({ name }) => name === 'packages/framework')).toBe(true);
  expect(failure.events.some(({ name }) => name === 'root')).toBe(false);
});

function nativeMatrix(event) {
  const workflow = parse(readFileSync('.github/workflows/release-bun-binaries.yml', 'utf8'));
  const value = (source) =>
    typeof source !== 'string' || !source.startsWith('${{')
      ? source
      : Function(
          'github',
          'fromJSON',
          `return (${source.slice(3, -2)});`,
        )({ event_name: event }, JSON.parse);
  const matrix = workflow.jobs['build-bun'].strategy.matrix;
  const jobs = value(matrix.product).flatMap((product) =>
    value(matrix.target).map((target) => ({ product, target })),
  );
  for (const include of value(matrix.include)) {
    const matches = jobs.filter((job) => job.target === include.target);
    if (matches.length) for (const job of matches) Object.assign(job, include);
    else jobs.push(include);
  }
  return jobs;
}

it('temporarily validates only the owner macOS ARM64 platform for both PR fixture products', () => {
  expect(nativeMatrix('pull_request')).toEqual([
    { product: 'cedar', target: 'darwin-arm64', runner: 'macos-26' },
    { product: 'amber', target: 'darwin-arm64', runner: 'macos-26' },
  ]);
});

it.each(['push', 'workflow_dispatch'])(
  'retains all five configured native release targets on %s',
  (event) => {
    expect(nativeMatrix(event)).toEqual([
      { product: 'configured', target: 'linux-x64', runner: 'ubuntu-24.04' },
      { product: 'configured', target: 'linux-arm64', runner: 'ubuntu-24.04-arm' },
      { product: 'configured', target: 'darwin-x64', runner: 'macos-26-intel' },
      { product: 'configured', target: 'darwin-arm64', runner: 'macos-26' },
      { product: 'configured', target: 'windows-x64', runner: 'windows-2025' },
    ]);
  },
);

function nativeSetupFixture() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'native-preparation-'));
  roots.push(cwd);
  write(
    cwd,
    'package.json',
    JSON.stringify({
      private: true,
      name: 'native-preparation-fixture',
      packageManager: 'pnpm@8.15.4',
      devDependencies: { 'build-tool': 'file:tools/build-tool' },
      scripts: { build: 'pnpm -r --filter "./packages/**" run build' },
    }),
  );
  write(cwd, 'pnpm-workspace.yaml', 'packages:\n - packages/*\n - apps/*\n');
  write(
    cwd,
    'tools/build-tool/package.json',
    JSON.stringify({ name: 'build-tool', version: '1.0.0', main: 'index.cjs' }),
  );
  write(cwd, 'tools/build-tool/index.cjs', 'module.exports = "generator available";');
  write(
    cwd,
    'tools/unrelated-tool/package.json',
    JSON.stringify({ name: 'unrelated-tool', version: '1.0.0' }),
  );
  const members = {
    'packages/core': { name: 'core' },
    'packages/agent-cli': { name: 'cli', devDependencies: { core: 'workspace:*' } },
    'packages/gui': { name: 'gui', dependencies: { core: 'workspace:*' } },
    'apps/agent-app': { name: 'desktop', devDependencies: { gui: 'workspace:*' } },
    'packages/unrelated': {
      name: 'unrelated',
      dependencies: { 'unrelated-tool': 'file:../../tools/unrelated-tool' },
    },
  };
  for (const [dir, manifest] of Object.entries(members)) {
    write(
      cwd,
      `${dir}/package.json`,
      JSON.stringify({
        ...manifest,
        version: '1.0.0',
        scripts: {
          build: `node -e "require('fs').appendFileSync(process.env.FIXTURE_BUILD_LOG, '${manifest.name}\\n')"`,
        },
      }),
    );
  }
  exec(cwd, 'pnpm', ['install', '--lockfile-only', '--ignore-scripts']);
  return cwd;
}
function nativeCommand(name, event = 'pull_request') {
  const workflow = parse(readFileSync('.github/workflows/release-bun-binaries.yml', 'utf8'));
  const source = workflow.jobs['build-bun'].steps.find((step) => step.name === name).run;
  if (!source.startsWith('${{')) return source;
  return Function('github', `return (${source.slice(3, -2)});`)({ event_name: event });
}

it('installs generator tools without unrelated workspace dependencies before PR product generation', () => {
  const cwd = nativeSetupFixture();
  const lock = readFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'utf8');
  exec(cwd, 'bash', ['-c', nativeCommand('Install dependencies')]);
  expect(exec(cwd, 'node', ['-e', 'console.log(require("build-tool"))'])).toBe(
    'generator available',
  );
  expect(() =>
    statSync(path.join(cwd, 'packages/unrelated/node_modules/unrelated-tool')),
  ).toThrow();
  expect(readFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'utf8')).toBe(lock);
  // The generated product retains its complete install; the prerequisite omission is not validation omission.
  exec(cwd, 'pnpm', ['install', '--frozen-lockfile']);
  expect(
    statSync(path.join(cwd, 'packages/unrelated/node_modules/unrelated-tool')).isDirectory(),
  ).toBe(true);
});

it('builds native transitive and development dependencies while omitting unrelated packages and the later desktop build', () => {
  const cwd = nativeSetupFixture();
  const buildLog = path.join(cwd, 'built.txt');
  const result = spawnSync('bash', ['-c', nativeCommand('Build workspace')], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, FIXTURE_BUILD_LOG: buildLog },
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(readFileSync(buildLog, 'utf8').trim().split('\n').sort()).toEqual(['cli', 'core', 'gui']);
});

it.each(['push', 'workflow_dispatch'])(
  'preserves the full configured release installation and build on %s',
  (event) => {
    expect(nativeCommand('Install dependencies', event)).toBe('pnpm install --frozen-lockfile');
    expect(nativeCommand('Build workspace', event)).toBe(
      'pnpm install --frozen-lockfile && pnpm build',
    );
  },
);
