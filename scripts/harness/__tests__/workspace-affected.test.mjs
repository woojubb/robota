import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  createWorkspaceAffectedPlan,
  formatWorkspaceAffectedPlan,
  parseCliArgs,
  parseNameStatusDiff,
  parseWorkspacePatterns,
  planWorkspaceAffected,
  readWorkspaceGraph,
  resolveChangedFiles,
} from '../workspace-affected.mjs';
import { workspaceDependenciesForOperation } from '../workspace-graph.mjs';

function writeJson(root, relative, value) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture({ cycle = false } = {}) {
  const root = makeTemp('robota-workspace-affected-');
  writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    [
      'packages:',
      "  - 'packages/*'",
      "  - 'packages/groups/*'",
      "  - 'apps/*'",
      "  - 'examples/*'",
      '',
    ].join('\n'),
  );
  writeJson(root, 'packages/core/package.json', {
    name: '@fixture/core',
    scripts: { build: 'build', test: 'test', typecheck: 'typecheck', lint: 'lint' },
    ...(cycle ? { dependencies: { '@fixture/web': 'workspace:*' } } : {}),
  });
  writeJson(root, 'packages/util/package.json', {
    name: '@fixture/util',
    dependencies: { '@fixture/core': 'workspace:*' },
  });
  writeJson(root, 'packages/groups/plugin/package.json', {
    name: '@fixture/plugin',
    peerDependencies: { '@fixture/util': 'workspace:^' },
  });
  mkdirSync(path.join(root, 'packages/groups/plugin/src'), { recursive: true });
  writeFileSync(
    path.join(root, 'packages/groups/plugin/src/index.ts'),
    "export { util } from '@fixture/util';\n",
  );
  writeJson(root, 'apps/web/package.json', {
    name: '@fixture/web',
    dependencies: { '@fixture/plugin': 'workspace:*' },
    scripts: { test: 'vitest', typecheck: 'tsc' },
  });
  mkdirSync(path.join(root, 'apps/web/src'), { recursive: true });
  writeFileSync(
    path.join(root, 'apps/web/src/index.ts'),
    "import { plugin } from '@fixture/plugin';\n",
  );
  writeJson(root, 'examples/demo/package.json', {
    name: '@fixture/demo',
    devDependencies: { '@fixture/core': 'workspace:*' },
  });
  mkdirSync(path.join(root, 'examples/demo/src'), { recursive: true });
  writeFileSync(
    path.join(root, 'examples/demo/src/index.ts'),
    "import { core } from '@fixture/core';\n",
  );
  return root;
}

describe('workspace affected planner', () => {
  it('reassembles only transitive copied consumers and their prerequisites on an asset change', () => {
    const packages = [
      { name: 'assets', buildDependencies: [] },
      { name: 'test-helper', buildDependencies: [] },
      {
        name: 'cli',
        buildDependencies: ['assets'],
        verificationDependencies: ['test-helper'],
        artifact: { builder: 'tsdown', copies: [{ package: 'assets', target: 'web' }] },
      },
      {
        name: 'bundle',
        buildDependencies: ['cli'],
        artifact: { builder: 'tsdown', copies: [{ package: 'cli', target: 'cli' }] },
      },
      { name: 'ordinary-consumer', buildDependencies: ['assets'] },
    ].map((entry) => ({
      ...entry,
      directory: `packages/${entry.name}`,
      dependencies: entry.buildDependencies,
      scripts: { build: 'build' },
    }));
    const graph = { packages };
    const plan = createWorkspaceAffectedPlan({
      graph,
      operation: 'build',
      changedFiles: ['packages/assets/src/index.ts'],
    });
    expect(plan.packages.map((entry) => entry.name)).toEqual([
      'assets',
      'bundle',
      'cli',
      'test-helper',
    ]);
    expect(plan.dependentClosure.map((entry) => entry.name)).toEqual(['bundle', 'cli']);
    expect(plan.packages.find((entry) => entry.name === 'cli').reasons).toContain(
      'copied-artifact-consumer-of:assets',
    );
    expect(
      createWorkspaceAffectedPlan({
        graph,
        operation: 'test',
        changedFiles: ['packages/assets/src/index.ts'],
      }).packages.map((entry) => entry.name),
    ).toEqual(['assets']);
  });

  it.each(['@fixture/missing', '@fixture/core'])(
    'rejects an unavailable copied producer %s',
    (producer) => {
      const root = fixture();
      writeJson(root, 'packages/cli/package.json', {
        name: '@fixture/cli',
        scripts: { build: 'build' },
        robota: { artifact: { builder: 'tsdown', copies: [{ package: producer, target: 'web' }] } },
      });
      expect(() => readWorkspaceGraph(root)).toThrow(/copied artifact producer/);
    },
  );

  it.each([
    { builder: 'unknown' },
    { builder: 'tsdown', copies: null },
    { builder: 'tsdown', copies: [{ package: '@fixture/core', target: '../web' }] },
    { builder: 'tsdown', copies: [{ package: '@fixture/core', target: 'C:/web' }] },
    { builder: 'tsdown', copies: [{ package: '@fixture/core', target: 'web\\assets' }] },
    { builder: 'tsdown', copies: [{ package: '', target: 'web' }] },
    {
      builder: 'tsdown',
      copies: [
        { package: '@fixture/core', target: 'web' },
        { package: '@fixture/core', target: 'web/assets' },
      ],
    },
  ])('rejects malformed artifact declarations: %j', (artifact) => {
    const root = fixture();
    writeJson(root, 'packages/cli/package.json', {
      name: '@fixture/cli',
      scripts: { build: 'build' },
      robota: { artifact },
    });
    expect(() => readWorkspaceGraph(root)).toThrow(/robota\.artifact/);
  });

  it('discovers copied artifact producers without adding test or typecheck edges', () => {
    const root = fixture();
    writeJson(root, 'packages/assets/package.json', {
      name: '@fixture/assets',
      private: true,
      scripts: { build: 'build' },
      robota: { artifact: { builder: 'vite' } },
    });
    writeJson(root, 'packages/cli/package.json', {
      name: '@fixture/cli',
      scripts: { build: 'build' },
      robota: {
        artifact: { builder: 'tsdown', copies: [{ package: '@fixture/assets', target: 'web' }] },
      },
    });
    const cli = readWorkspaceGraph(root).packages.find((entry) => entry.name === '@fixture/cli');
    expect(cli.artifact).toEqual({
      builder: 'tsdown',
      copies: [{ package: '@fixture/assets', target: 'web' }],
    });
    expect(cli.buildDependencies).toEqual(['@fixture/assets']);
    expect(cli.typecheckDependencies).toEqual([]);
    expect(cli.testDependencies).toEqual([]);
  });

  it("accepts pnpm's explicit argument separator", () => {
    expect(parseCliArgs(['--', '--operation', 'build']).operation).toBe('build');
  });

  it('parses declared workspace patterns without hardcoded package families', () => {
    expect(
      parseWorkspacePatterns(
        "catalog:\n  react: 1\npackages:\n  - 'modules/*' # owned\n  - tools\nonlyBuiltDependencies:\n  - x\n",
      ),
    ).toEqual(['modules/*', 'tools']);
    const graph = readWorkspaceGraph(fixture());
    expect(graph.packages.map((entry) => entry.directory)).toEqual([
      'apps/web',
      'examples/demo',
      'packages/core',
      'packages/groups/plugin',
      'packages/util',
    ]);
  });

  it('separates production build edges from dev-only verification imports', () => {
    const root = fixture();
    writeJson(root, 'packages/dev-only/package.json', {
      name: '@fixture/dev-only',
      devDependencies: { '@fixture/core': 'workspace:*' },
      scripts: { build: 'build', test: 'test', typecheck: 'typecheck' },
    });
    mkdirSync(path.join(root, 'packages/dev-only/src/__tests__'), { recursive: true });
    writeFileSync(
      path.join(root, 'packages/dev-only/src/__tests__/core.test.ts'),
      "import { core } from '@fixture/core';\n",
    );
    const graph = readWorkspaceGraph(root);
    const devOnly = graph.packages.find((entry) => entry.name === '@fixture/dev-only');
    const example = graph.packages.find((entry) => entry.name === '@fixture/demo');
    expect(devOnly.buildDependencies).toEqual([]);
    expect(devOnly.typecheckDependencies).toEqual([]);
    expect(devOnly.testDependencies).toEqual(['@fixture/core']);
    expect(workspaceDependenciesForOperation(devOnly, 'build')).toEqual(['@fixture/core']);
    expect(workspaceDependenciesForOperation(devOnly, 'consumer-build')).toEqual([]);
    expect(example.buildDependencies).toEqual(['@fixture/core']);
    expect(example.typecheckDependencies).toEqual(['@fixture/core']);
    expect(example.testDependencies).toEqual(['@fixture/core']);
    expect(
      createWorkspaceAffectedPlan({
        root,
        graph,
        operation: 'build',
        changedFiles: ['packages/dev-only/src/index.ts'],
      }).packages.map((entry) => entry.name),
    ).toEqual(['@fixture/core', '@fixture/dev-only']);
    expect(
      createWorkspaceAffectedPlan({
        root,
        graph,
        operation: 'typecheck',
        changedFiles: ['packages/core/src/index.ts'],
      }).packages.map((entry) => entry.name),
    ).not.toContain('@fixture/dev-only');
    expect(
      createWorkspaceAffectedPlan({
        root,
        graph,
        operation: 'test',
        changedFiles: ['packages/core/src/index.ts'],
      }).packages.map((entry) => entry.name),
    ).toEqual(['@fixture/core']);
  });

  it('isolates lint to the owning package and returns deterministic owners', () => {
    const root = fixture();
    const first = planWorkspaceAffected({
      root,
      operation: 'lint',
      changedFiles: ['packages/util/src/z.ts', 'packages/core/src/a.ts'],
    });
    const second = planWorkspaceAffected({
      root,
      operation: 'lint',
      changedFiles: ['packages/core/src/a.ts', 'packages/util/src/z.ts'],
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      mode: 'packages',
      packageDistributable: true,
      globalFallback: false,
    });
    expect(first.owners.map((entry) => entry.directory)).toEqual([
      'packages/core',
      'packages/util',
    ]);
    expect(first.packages.map((entry) => entry.directory)).toEqual([
      'packages/core',
      'packages/util',
    ]);
  });

  it('keeps tests on changed owners unless integration owners are explicitly registered', () => {
    const plan = planWorkspaceAffected({
      root: fixture(),
      operation: 'test',
      changedFiles: ['packages/core/src/index.ts'],
    });
    expect(plan.owners.map((entry) => entry.name)).toEqual(['@fixture/core']);
    expect(plan.packages.map((entry) => entry.name)).toEqual(['@fixture/core']);
    expect(plan.dependentClosure).toEqual([]);
    expect(plan.dependencyClosure).toEqual([]);

    const integrated = planWorkspaceAffected({
      root: fixture(),
      operation: 'test',
      changedFiles: ['packages/core/src/index.ts'],
      integrationOwners: { '@fixture/core': ['@fixture/web'] },
    });
    expect(integrated.packages.map((entry) => entry.name)).toEqual([
      '@fixture/web',
      '@fixture/core',
    ]);
  });

  it('does not infer integration ownership from dependent imports', () => {
    const root = fixture();
    writeJson(root, 'packages/util/package.json', {
      name: '@fixture/util',
      dependencies: { '@fixture/core': 'workspace:*' },
      scripts: { test: 'vitest' },
    });
    writeFileSync(
      path.join(root, 'packages/util/imports-core.test.ts'),
      "import { core } from '@fixture/core';\n",
    );
    writeJson(root, 'packages/side/package.json', {
      name: '@fixture/side',
      dependencies: { '@fixture/core': 'workspace:*' },
      scripts: { test: 'vitest' },
    });
    writeFileSync(
      path.join(root, 'packages/side/unrelated.test.ts'),
      "import { other } from '@fixture/other';\n",
    );
    writeJson(root, 'packages/groups/plugin/package.json', {
      name: '@fixture/plugin',
      peerDependencies: { '@fixture/util': 'workspace:^' },
      scripts: { test: 'vitest' },
    });
    writeFileSync(
      path.join(root, 'packages/groups/plugin/transitive.test.ts'),
      "const util = require('@fixture/util');\n",
    );

    const plan = planWorkspaceAffected({
      root,
      operation: 'test',
      changedFiles: ['packages/core/src/index.ts'],
    });
    expect(plan.packages.map((entry) => entry.name)).toEqual(['@fixture/core']);
  });

  it('does not treat a direct dependent runtime import as an owned integration test', () => {
    const root = fixture();
    writeJson(root, 'packages/util/package.json', {
      name: '@fixture/util',
      dependencies: { '@fixture/core': 'workspace:*' },
      scripts: { test: 'vitest' },
    });
    mkdirSync(path.join(root, 'packages/util/src'), { recursive: true });
    writeFileSync(
      path.join(root, 'packages/util/src/runtime.ts'),
      "import { core } from '@fixture/core';\n",
    );
    writeFileSync(
      path.join(root, 'packages/util/runtime.test.ts'),
      "import { describe } from 'vitest';\n",
    );

    const plan = planWorkspaceAffected({
      root,
      operation: 'test',
      changedFiles: ['packages/core/src/index.ts'],
    });
    expect(plan.packages.map((entry) => entry.name)).toEqual(['@fixture/core']);
  });

  it('uses operation-specific dependency directions', () => {
    const root = fixture();
    const build = planWorkspaceAffected({
      root,
      operation: 'build',
      changedFiles: ['apps/web/src/index.ts'],
    });
    expect(build.dependencyClosure.map((entry) => entry.name)).toEqual([
      '@fixture/core',
      '@fixture/plugin',
      '@fixture/util',
    ]);
    expect(build.dependentClosure).toEqual([]);

    const typecheck = planWorkspaceAffected({
      root,
      operation: 'typecheck',
      changedFiles: ['packages/util/src/index.ts'],
    });
    expect(typecheck.dependencyClosure).toEqual([]);
    expect(typecheck.dependentClosure).toEqual([]);
    expect(typecheck.packages.map((entry) => entry.name)).toEqual(['@fixture/util']);

    const explicitTypecheck = planWorkspaceAffected({
      root,
      operation: 'typecheck',
      changedFiles: ['packages/core/src/index.ts'],
      typecheckIntegrationOwners: { '@fixture/core': ['@fixture/web'] },
    });
    expect(explicitTypecheck.packages.map((entry) => entry.name)).toEqual([
      '@fixture/web',
      '@fixture/core',
    ]);

    const consumerBuild = planWorkspaceAffected({
      root,
      operation: 'consumer-build',
      changedFiles: ['packages/core/src/index.ts'],
    });
    expect(consumerBuild.packages.map((entry) => entry.name)).toEqual([
      '@fixture/web',
      '@fixture/demo',
      '@fixture/core',
      '@fixture/plugin',
      '@fixture/util',
    ]);
  });

  it('fails closed on workspace dependency cycles', () => {
    const plan = planWorkspaceAffected({
      root: fixture({ cycle: true }),
      operation: 'build',
      changedFiles: ['packages/core/src/index.ts'],
    });
    expect(plan).toMatchObject({
      mode: 'global',
      globalFallback: true,
      reason: expect.stringContaining('workspace dependency cycle'),
    });
  });

  it('selects only directly changed example owners', () => {
    const sdkPlan = planWorkspaceAffected({
      root: fixture(),
      operation: 'examples-typecheck',
      changedFiles: ['packages/core/src/index.ts'],
    });
    expect(sdkPlan).toMatchObject({ mode: 'none', packages: [] });

    const examplePlan = planWorkspaceAffected({
      root: fixture(),
      operation: 'examples-typecheck',
      changedFiles: ['examples/demo/src/index.ts'],
    });
    expect(examplePlan.packages.map((entry) => entry.name)).toEqual(['@fixture/demo']);
  });

  it('returns none when no example is reachable from a source change', () => {
    const plan = planWorkspaceAffected({
      root: fixture(),
      operation: 'examples-typecheck',
      changedFiles: ['apps/web/src/index.ts'],
    });
    expect(plan).toMatchObject({
      mode: 'none',
      globalFallback: false,
      reason: expect.stringContaining('no changed workspace package is an example owner'),
      packages: [],
    });
  });

  it('retains rename sides from every merge base', () => {
    expect(parseNameStatusDiff('R100\0packages/old/a.ts\0packages/core/a.ts\0')).toEqual([
      'packages/core/a.ts',
      'packages/old/a.ts',
    ]);
    const calls = [];
    const result = resolveChangedFiles({
      root: '/repo',
      baseRef: 'develop',
      environment: { CI: 'true' },
      runGit: (args) => {
        calls.push(args);
        if (args[0] === 'merge-base') return { status: 0, stdout: 'base-b\nbase-a\n' };
        if (args.includes('base-a')) return { status: 0, stdout: 'M\0packages/core/a.ts\0' };
        return {
          status: 0,
          stdout: 'R100\0packages/util/old.ts\0packages/util/new.ts\0',
        };
      },
    });
    expect(result).toEqual({
      ok: true,
      mergeBases: ['base-a', 'base-b'],
      files: ['packages/core/a.ts', 'packages/util/new.ts', 'packages/util/old.ts'],
    });
    expect(calls.filter((args) => args[0] === 'diff')).toHaveLength(2);
  });

  it('adds local staged, unstaged, and untracked paths while preserving rename sides', () => {
    const calls = [];
    const result = resolveChangedFiles({
      root: '/repo',
      baseRef: 'develop',
      environment: {},
      runGit: (args) => {
        calls.push(args);
        if (args[0] === 'merge-base') return { status: 0, stdout: 'base\n' };
        if (args.includes('base')) return { status: 0, stdout: 'M\0packages/core/head.ts\0' };
        if (args.includes('--cached')) {
          return {
            status: 0,
            stdout: 'R100\0packages/core/staged-old.ts\0packages/core/staged-new.ts\0',
          };
        }
        if (args[0] === 'diff') return { status: 0, stdout: 'M\0packages/util/worktree.ts\0' };
        return { status: 0, stdout: 'packages/core/untracked.ts\0' };
      },
    });
    expect(result.files).toEqual([
      'packages/core/head.ts',
      'packages/core/staged-new.ts',
      'packages/core/staged-old.ts',
      'packages/core/untracked.ts',
      'packages/util/worktree.ts',
    ]);
    expect(calls).toContainEqual(['diff', '--name-status', '-z', '-M', '-C', '--cached']);
    expect(calls).toContainEqual(['diff', '--name-status', '-z', '-M', '-C']);
    expect(calls).toContainEqual(['ls-files', '--others', '--exclude-standard', '-z']);
  });

  it('fails closed when a local change command is unreadable and skips local state in CI', () => {
    const local = resolveChangedFiles({
      root: '/repo',
      baseRef: 'develop',
      environment: {},
      runGit: (args) => {
        if (args[0] === 'merge-base') return { status: 0, stdout: 'base\n' };
        if (args.includes('base')) return { status: 0, stdout: 'M\0packages/core/head.ts\0' };
        if (args.includes('--cached')) return { status: 1, stdout: '' };
        return { status: 0, stdout: '' };
      },
    });
    expect(local).toMatchObject({ ok: false, reason: 'staged diff failed' });

    const calls = [];
    const ci = resolveChangedFiles({
      root: '/repo',
      baseRef: 'develop',
      environment: { GITHUB_ACTIONS: 'true' },
      runGit: (args) => {
        calls.push(args);
        if (args[0] === 'merge-base') return { status: 0, stdout: 'base\n' };
        return { status: 0, stdout: 'M\0packages/core/head.ts\0' };
      },
    });
    expect(ci.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it.each([
    [['pnpm-lock.yaml'], 'workspace-wide input changed'],
    [['pnpm-workspace.yaml'], 'workspace-wide input changed'],
    [['package.json'], 'workspace-wide input changed'],
    [['mystery/file.ts'], 'unknown changed path'],
  ])('uses an explicit global fallback for %j', (changedFiles, reason) => {
    const plan = planWorkspaceAffected({ root: fixture(), operation: 'test', changedFiles });
    expect(plan).toMatchObject({
      mode: 'global',
      packageDistributable: false,
      globalFallback: true,
    });
    expect(plan.reason).toContain(reason);
  });

  it('keeps a workspace package manifest package-owned while root graph inputs remain global', () => {
    const root = fixture();
    const packageManifest = planWorkspaceAffected({
      root,
      operation: 'test',
      changedFiles: ['packages/core/package.json'],
    });
    expect(packageManifest).toMatchObject({ mode: 'packages', globalFallback: false });
    expect(packageManifest.owners.map((entry) => entry.name)).toEqual(['@fixture/core']);
    for (const rootInput of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
      expect(
        planWorkspaceAffected({ root, operation: 'test', changedFiles: [rootInput] }),
      ).toMatchObject({ mode: 'global', globalFallback: true });
    }
  });

  it('fails closed for unreadable graph and diff state', () => {
    const missing = makeTemp('robota-workspace-missing-');
    expect(
      planWorkspaceAffected({
        root: missing,
        operation: 'test',
        changedFiles: ['packages/a/src/a.ts'],
      }),
    ).toMatchObject({ mode: 'global', reason: expect.stringContaining('graph is unreadable') });
    expect(
      planWorkspaceAffected({
        root: fixture(),
        operation: 'test',
        baseRef: 'develop',
        runGit: () => ({ status: 1, stdout: '' }),
      }),
    ).toMatchObject({
      mode: 'global',
      reason: expect.stringContaining('merge-base lookup failed'),
    });
  });

  it('returns an explicit no-package plan for recognized docs and governance', () => {
    const plan = planWorkspaceAffected({
      root: fixture(),
      operation: 'typecheck',
      changedFiles: ['docs/design.md', '.agents/rules/example.md'],
    });
    expect(plan).toMatchObject({
      mode: 'none',
      packageDistributable: true,
      globalFallback: false,
      owners: [],
      packages: [],
    });
  });

  it('resolves an ordinary scripts/harness/*.mjs change as no-package, not an unknown-path global fallback', () => {
    // Regression: no `packages/*`/`apps/*` build/test/typecheck graph reaches scripts/harness/ (it
    // is harness tooling, the same reasoning already applied to `.agents/`), so before this an
    // unrelated harness-script change resolved to neither an owner nor a no-package path and fell
    // through to `unknown changed path`, forcing a full-workspace verification (process-overhead
    // policy, 2026-09).
    const plan = planWorkspaceAffected({
      root: fixture(),
      operation: 'test',
      changedFiles: ['scripts/harness/allocate-work-item-id.mjs'],
    });
    expect(plan).toMatchObject({
      mode: 'none',
      packageDistributable: true,
      globalFallback: false,
      owners: [],
      packages: [],
    });
  });

  it('still resolves the scope-mapping harness files themselves as global, not no-package', () => {
    // GLOBAL_PREFIXES is checked before NO_PACKAGE_PREFIXES — widening the latter for
    // scripts/harness/ generally must not swallow the specific files that ARE the scope-mapping
    // mechanism, which legitimately need full verification when they change.
    const plan = planWorkspaceAffected({
      root: fixture(),
      operation: 'test',
      changedFiles: ['scripts/harness/workspace-affected-plan.mjs'],
    });
    expect(plan).toMatchObject({ mode: 'global', globalFallback: true });
  });

  it('maps rename ownership when both paths remain in known package trees', () => {
    const root = fixture();
    const plan = createWorkspaceAffectedPlan({
      root,
      operation: 'lint',
      graph: readWorkspaceGraph(root),
      changedFiles: ['packages/core/old.ts', 'packages/util/new.ts'],
    });
    expect(plan.owners.map((entry) => entry.name)).toEqual(['@fixture/core', '@fixture/util']);
  });

  it('renders stable machine-readable and human-readable dry plans', () => {
    const plan = planWorkspaceAffected({
      root: fixture(),
      operation: 'lint',
      changedFiles: ['packages/core/src/index.ts'],
    });
    expect(JSON.parse(formatWorkspaceAffectedPlan(plan, 'json'))).toEqual(plan);
    expect(formatWorkspaceAffectedPlan(plan)).toContain('package-distributable: yes');
    expect(formatWorkspaceAffectedPlan(plan)).toContain('packages: packages/core');
  });

  it('turns explicit full mode into a full fail-closed plan without a git diff', () => {
    const plan = planWorkspaceAffected({ root: fixture(), operation: 'build', full: true });
    expect(plan).toMatchObject({
      mode: 'global',
      globalFallback: true,
      reason: 'full mode requested',
      changedFiles: [],
    });
  });

  it('ratchets affected-build prerequisite fanout for current CI synthetic targets', () => {
    const root = process.cwd();
    const graph = readWorkspaceGraph(root);
    const providerTypecheck = createWorkspaceAffectedPlan({
      root,
      graph,
      operation: 'typecheck',
      changedFiles: ['packages/agent-provider-openai/src/__changed__.ts'],
    });
    const providerBuild = createWorkspaceAffectedPlan({
      root,
      graph,
      operation: 'build',
      changedFiles: providerTypecheck.packages.map(
        (entry) => `${entry.directory}/__ci_typecheck_target__.ts`,
      ),
    });
    const cliBuild = createWorkspaceAffectedPlan({
      root,
      graph,
      operation: 'build',
      changedFiles: [
        'packages/agent-cli/src/__ci_binary_target__.ts',
        'packages/agent-cli-web/src/__ci_binary_target__.ts',
      ],
    });
    const tuiBuild = createWorkspaceAffectedPlan({
      root,
      graph,
      operation: 'build',
      changedFiles: [
        'packages/agent-cli/src/__ci_consumer_target__.ts',
        'packages/agent-transport-tui/src/__ci_consumer_target__.ts',
      ],
    });
    expect(providerTypecheck.packages).toHaveLength(1);
    expect(providerBuild.packages.length).toBeLessThanOrEqual(3);
    expect(cliBuild.packages.length).toBeLessThanOrEqual(67);
    // ARTIFACT-2655: CLI assembly now owns the previously omitted web producer + GUI prerequisite.
    const copiedPrerequisites = ['@robota-sdk/agent-cli-web', '@robota-sdk/agent-transport-gui'];
    expect(tuiBuild.packages.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(copiedPrerequisites),
    );
    expect(
      tuiBuild.packages.filter((entry) => !copiedPrerequisites.includes(entry.name)).length,
    ).toBeLessThanOrEqual(65);
  });
});
