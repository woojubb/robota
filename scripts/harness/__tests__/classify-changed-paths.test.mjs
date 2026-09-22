/**
 * The changed-path classifier is the SINGLE mechanism deciding whether a PR contains code. Two
 * consumers depend on it and must not be able to disagree:
 *
 *   - ci.yml `changes` — whether the required build/test matrix runs.
 *   - review-gate.yml — whether a code-scanning analysis is expected at all (#1436: a docs-only PR
 *     was blocked for 15 m 23 s waiting for an analysis CodeQL never schedules).
 *
 * Two properties are load-bearing and both are asserted mechanically here: workflows consume this
 * classifier instead of copying the docs set, and every undeterminable case answers CODE.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { makeTemp } from './make-temp.mjs';

import {
  DOCS_ONLY_GLOBS,
  classifyFiles,
  classifyRange,
  isFullVerificationPath,
  isDocsOnlyPath,
  isHarnessOwnerPath,
  resolveCapabilityReachability,
} from '../classify-changed-paths.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCRIPT = path.resolve(import.meta.dirname, '../classify-changed-paths.mjs');

describe('the classifier owns the docs-only set', () => {
  it('workflows do not carry a second paths-ignore list', () => {
    const reviewGate = readFileSync(
      path.join(REPO_ROOT, '.github/workflows/review-gate.yml'),
      'utf8',
    );
    const codeql = readFileSync(path.join(REPO_ROOT, '.github/workflows/codeql.yml'), 'utf8');
    expect(reviewGate).not.toContain('paths-ignore:');
    expect(codeql).not.toContain('paths-ignore:');
    expect(reviewGate).not.toContain('classify-changed-paths.mjs');
  });

  it('every declared docs path is classified docs-only, and code paths are not', () => {
    expect(DOCS_ONLY_GLOBS).toEqual(['**/*.md', '**/*.mdx', 'docs/**', 'content/**']);
    for (const file of ['README.md', '.agents/tasks/X.md', 'docs/a/b.mdx', 'content/post.md']) {
      expect(isDocsOnlyPath(file), file).toBe(true);
    }
    for (const file of [
      'packages/agent-core/src/index.ts',
      'scripts/harness/check-pr-body.mjs',
      '.github/workflows/ci.yml',
      'package.json',
      'apps/agent-app/src/main.tsx',
    ]) {
      expect(isDocsOnlyPath(file), file).toBe(false);
    }
  });
});

describe('classifyFiles', () => {
  it.each([
    'scripts/harness/check-pr-body.mjs',
    '.github/workflows/ci.yml',
    '.github/PULL_REQUEST_TEMPLATE.md',
    '.claude/agents/package-code-reviewer.md',
    '.claude/hooks/merge-gate.sh',
    '.claude/settings.json',
    '.husky/pre-commit',
    '.agents/harness.config.json',
    '.agents/project-structure.md',
    '.agents/rules/verification.md',
    '.agents/skills/harness-governance/SKILL.md',
    '.agents/specs/orchestration-map.md',
    '.agents/tasks/README.md',
    '.agents/tasks/completed/RULE-021-close-parent-on-decomposition.md',
    '.agents/templates/spec-template.md',
    'AGENTS.md',
    'package.json',
    'pnpm-lock.yaml',
    'vitest.config.ts',
    'vitest.shared.ts',
    '.npmrc',
  ])('classifies harness owner path %s as harness-applicable', (file) => {
    expect(isHarnessOwnerPath(file)).toBe(true);
    expect(classifyFiles([file]).harness).toBe(true);
  });

  it('treats documentation under a harness owner directory as harness-applicable', () => {
    expect(classifyFiles(['scripts/harness/README.md']).harness).toBe(true);
    expect(classifyFiles(['.agents/rules/verification.md'])).toMatchObject({
      code: false,
      harness: true,
      hermetic: false,
    });
    expect(classifyFiles(['.claude/agents/package-code-reviewer.md'])).toMatchObject({
      code: false,
      product: false,
      harness: true,
      hermetic: false,
    });
    expect(classifyFiles(['.github/PULL_REQUEST_TEMPLATE.md'])).toMatchObject({
      code: false,
      product: false,
      harness: true,
      hermetic: false,
    });
    expect(classifyFiles(['.agents/project-structure.md'])).toMatchObject({
      code: false,
      product: false,
      harness: true,
      hermetic: false,
    });
    expect(classifyFiles(['.agents/tasks/README.md'])).toMatchObject({
      code: false,
      product: false,
      harness: true,
      hermetic: false,
    });
  });

  it.each([
    'packages/agent-core/src/index.ts',
    'apps/agent-app/src/main.tsx',
    'README.md',
    'docs/guide.mdx',
  ])('does not classify non-owner path %s as harness-applicable', (file) => {
    expect(isHarnessOwnerPath(file)).toBe(false);
    expect(classifyFiles([file]).harness).toBe(false);
  });

  it('classifies a markdown-only change as docs-only — the #1436 shape', () => {
    const result = classifyFiles(['.agents/tasks/INFRA-053-review-turn-budget.md']);
    expect(result.code).toBe(false);
  });

  it('one code file among many docs files is CODE', () => {
    const result = classifyFiles(['README.md', 'docs/guide.mdx', 'packages/a/src/x.ts']);
    expect(result.code).toBe(true);
  });

  it('a workflow or harness script change is CODE, not docs', () => {
    expect(classifyFiles(['.github/workflows/review-gate.yml'])).toMatchObject({
      code: true,
      product: false,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
      full: false,
      harness: true,
    });
    expect(classifyFiles(['scripts/harness/check-pr-body.mjs'])).toMatchObject({
      code: true,
      product: false,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
      full: false,
      harness: true,
    });
  });

  it('selects hermetic only for its tests and shared execution owners', () => {
    expect(classifyFiles(['scripts/harness/check-pr-body.mjs'])).toMatchObject({
      harness: true,
      hermetic: false,
    });
    expect(classifyFiles(['scripts/harness/harness-vitest-process.mjs'])).toMatchObject({
      harness: true,
      hermetic: true,
    });
    expect(classifyFiles(['scripts/harness/harness-test-classification.mjs'])).toMatchObject({
      harness: true,
      hermetic: true,
    });
    expect(
      classifyFiles(['scripts/harness/__tests__/canonical-temporary-directory.test.mjs']),
    ).toMatchObject({
      harness: true,
      hermetic: true,
    });
  });

  it('does not fan every product change out to every expensive capability', () => {
    expect(classifyFiles(['apps/blog/src/page.tsx'], { capabilities: {} })).toMatchObject({
      code: true,
      product: true,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
      full: false,
    });
  });

  it('routes expensive capabilities by direct owner instead of dependency fanout', () => {
    const capabilities = resolveCapabilityReachability(['packages/agent-core/src/index.ts'], {
      cwd: REPO_ROOT,
    });
    expect(capabilities).toEqual({ tui: false, examples: false, windows: false, cli: false });
    expect(classifyFiles(['packages/agent-core/src/index.ts'], { capabilities })).toMatchObject({
      tui: false,
      examples: false,
      windows: false,
      cli: false,
      full: false,
    });

    expect(resolveCapabilityReachability(['apps/blog/src/page.tsx'], { cwd: REPO_ROOT })).toEqual({
      tui: false,
      examples: false,
      windows: false,
      cli: false,
    });

    expect(
      resolveCapabilityReachability(['packages/agent-cli-web/src/main.tsx'], { cwd: REPO_ROOT }),
    ).toMatchObject({ tui: false, cli: true });

    expect(
      resolveCapabilityReachability(['packages/agent-cli/src/bin.ts'], { cwd: REPO_ROOT }),
    ).toMatchObject({ tui: true, cli: true });
    expect(
      resolveCapabilityReachability(['packages/agent-ui-terminal/src/App.tsx'], {
        cwd: REPO_ROOT,
      }),
    ).toMatchObject({ tui: true, cli: false });
    expect(
      resolveCapabilityReachability(['examples/cli/src/index.ts'], { cwd: REPO_ROOT }),
    ).toMatchObject({ examples: true, tui: false, cli: false });
    expect(
      resolveCapabilityReachability(['packages/agent-tools/src/index.ts'], { cwd: REPO_ROOT }),
    ).toMatchObject({ windows: false });
    expect(
      resolveCapabilityReachability(['packages/agent-tools/src/builtins/shell-tool.ts'], {
        cwd: REPO_ROOT,
      }),
    ).toMatchObject({ windows: true });

    expect(
      resolveCapabilityReachability(['packages/agent-provider-openai/src/index.ts'], {
        cwd: REPO_ROOT,
      }),
    ).toMatchObject({ tui: false, cli: false });
  });

  it('fails closed when a workspace path has no resolvable direct owner', () => {
    expect(
      resolveCapabilityReachability(['packages/definitely-missing/src/index.ts'], {
        cwd: REPO_ROOT,
      }),
    ).toMatchObject({ error: expect.stringContaining('workspace owner is unknown') });
  });

  it.each([
    'packages/agent-core/package.json',
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'tsconfig.base.json',
  ])('routes control-plane or graph input %s to full verification', (file) => {
    expect(isFullVerificationPath(file)).toBe(true);
    expect(classifyFiles([file])).toMatchObject({
      code: true,
      full: true,
      tui: true,
      examples: true,
      windows: true,
      cli: true,
    });
  });

  it.each([
    '.github/workflows/ci.yml',
    'scripts/harness/workspace-affected.mjs',
    'scripts/build-types-ordered.mjs',
  ])(
    'runs build machinery regressions for %s without promoting every capability to full',
    (file) => {
      expect(isFullVerificationPath(file)).toBe(false);
      expect(classifyFiles([file])).toMatchObject({
        code: true,
        product: true,
        full: false,
        harness: true,
        tui: false,
        examples: false,
        windows: false,
        cli: false,
      });
    },
  );

  it('treats a semantically proven harness-only root manifest as infrastructure', () => {
    expect(
      classifyFiles(['package.json'], {
        rootManifestChange: { kind: 'developer-quality-only', workspaceWide: false },
      }),
    ).toMatchObject({
      code: true,
      product: false,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
      full: false,
      harness: true,
    });
    expect(
      isFullVerificationPath('package.json', {
        rootManifestChange: { kind: 'developer-quality-only', workspaceWide: false },
      }),
    ).toBe(false);
  });

  it('keeps build machinery applicable even alongside a harness-only manifest edit', () => {
    const capabilities = resolveCapabilityReachability(
      [
        '.github/workflows/ci.yml',
        'scripts/harness/classify-changed-paths.mjs',
        'scripts/build-types-ordered.mjs',
        'package.json',
      ],
      { cwd: REPO_ROOT },
    );
    expect(
      classifyFiles(
        [
          '.github/workflows/ci.yml',
          'scripts/harness/classify-changed-paths.mjs',
          'scripts/build-types-ordered.mjs',
          'package.json',
        ],
        {
          rootManifestChange: { kind: 'developer-quality-only', workspaceWide: false },
          capabilities,
        },
      ),
    ).toMatchObject({
      product: true,
      full: false,
      harness: true,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
    });
  });

  it('keeps root manifest classification fail-closed without proof or with product files', () => {
    const developerQualityOnly = {
      rootManifestChange: { kind: 'developer-quality-only', workspaceWide: false },
    };

    expect(classifyFiles(['package.json']).product).toBe(true);
    expect(classifyFiles(['package.json', 'pnpm-lock.yaml'], developerQualityOnly).product).toBe(
      true,
    );
    expect(
      classifyFiles(['package.json', 'packages/agent-core/src/index.ts'], developerQualityOnly)
        .product,
    ).toBe(true);
    expect(
      classifyFiles(['package.json'], {
        rootManifestChange: { kind: 'workspace-wide', workspaceWide: true },
      }).product,
    ).toBe(true);
  });

  it('treats dependency policy as infrastructure while selecting the security owner', () => {
    for (const file of [
      'osv-scanner.toml',
      '.github/workflows/dependency-review.yml',
      '.github/workflows/security-scheduled.yml',
      'scripts/harness/generate-dependency-review-license-exemptions.mjs',
    ]) {
      expect(classifyFiles([file]), file).toMatchObject({
        code: true,
        product: false,
        dependencies: true,
      });
    }
  });

  // "Nothing classified" must run the checks, not skip them.
  it('FAIL-CLOSED: an empty file list is CODE', () => {
    expect(classifyFiles([])).toMatchObject({
      code: true,
      product: true,
      tui: true,
      examples: true,
      windows: true,
      cli: true,
      harness: true,
      hermetic: true,
      full: true,
    });
    expect(classifyFiles(undefined)).toMatchObject({
      code: true,
      product: true,
      tui: true,
      examples: true,
      harness: true,
    });
  });
});

describe('classifyRange (fail-closed on git)', () => {
  const ok = (stdout) => ({ ok: true, stdout, stderr: '' });
  const fail = () => ({ ok: false, stdout: '', stderr: 'fatal' });

  it('FAIL-CLOSED: no merge base classifies as CODE and reports the reason', () => {
    const result = classifyRange({ baseRef: 'origin/develop', runGit: () => fail() });
    expect(result.code).toBe(true);
    expect(result).toMatchObject({ product: true, tui: true, examples: true });
    expect(result).toMatchObject({ windows: true, full: true });
    expect(result.harness).toBe(true);
    expect(result.error).toContain('no merge base');
  });

  it('FAIL-CLOSED: a failed diff classifies as CODE', () => {
    const runGit = (args) => (args[0] === 'merge-base' ? ok('abc123\n') : fail());
    const result = classifyRange({ baseRef: 'origin/develop', runGit });
    expect(result.code).toBe(true);
    expect(result.harness).toBe(true);
    expect(result.error).toContain('git diff against merge base abc123 failed');
  });

  // A criss-cross history (this repo back-merges main <-> develop) can have several merge bases.
  // Taking the UNION can only over-report code, never silently under-report it.
  it('unions the diff over every merge base', () => {
    const runGit = (args) => {
      if (args[0] === 'merge-base') return ok('base1\nbase2\n');
      return ok(args.at(-2) === 'base1' ? 'README.md\n' : 'packages/a/src/x.ts\n');
    };
    const result = classifyRange({ baseRef: 'origin/develop', runGit });
    expect(result.bases).toEqual(['base1', 'base2']);
    expect(result.files).toEqual(['README.md', 'packages/a/src/x.ts']);
    expect(result.code).toBe(true);
  });

  it('classifies rename/delete paths from the canonical ACMRD diff', () => {
    const calls = [];
    const runGit = (args) => {
      calls.push(args);
      return args[0] === 'merge-base' ? ok('base1\n') : ok('scripts/harness/deleted.mjs\n');
    };
    const result = classifyRange({ baseRef: 'origin/develop', runGit });
    expect(calls[1]).toEqual([
      'diff',
      '--name-only',
      '--no-renames',
      '--diff-filter=ACMRD',
      'base1',
      'HEAD',
    ]);
    expect(result).toMatchObject({ harness: true, files: ['scripts/harness/deleted.mjs'] });
  });

  it('retains the product-owned source when a file is renamed outside its workspace', () => {
    const root = makeTemp('robota-classify-rename-source-');
    for (const directory of ['apps', 'examples', 'packages/agent-ui-terminal/src']) {
      mkdirSync(path.join(root, directory), { recursive: true });
    }
    writeFileSync(
      path.join(root, 'packages/agent-ui-terminal/package.json'),
      '{"name":"@robota-sdk/agent-ui-terminal","version":"1.0.0"}\n',
    );
    writeFileSync(path.join(root, 'packages/agent-ui-terminal/src/x.ts'), 'export const x = 1;\n');
    spawnSync('git', ['init', '--quiet', '--initial-branch=main', root]);
    const run = (...args) =>
      spawnSync('git', [
        '-C',
        root,
        '-c',
        'user.name=Harness',
        '-c',
        'user.email=h@example.test',
        ...args,
      ]);
    run('add', '-A');
    run('commit', '--quiet', '-m', 'base');
    mkdirSync(path.join(root, '.agents/archive'), { recursive: true });
    run('mv', 'packages/agent-ui-terminal/src/x.ts', '.agents/archive/x.ts');
    run('commit', '--quiet', '-m', 'move source outside product workspace');

    const rename = spawnSync('git', ['-C', root, 'diff', '--name-status', '-M', 'HEAD~1...HEAD'], {
      encoding: 'utf8',
    });
    expect(rename.stdout).toMatch(/^R\d+\s+packages\/agent-ui-terminal\/src\/x\.ts\s+/mu);

    const result = classifyRange({ baseRef: 'HEAD~1', cwd: root });

    expect(result.files).toContain('packages/agent-ui-terminal/src/x.ts');
    expect(result).toMatchObject({ code: true, product: true, tui: true });
  });

  it('classifies a harness-only root manifest from immutable Git objects', () => {
    const before = JSON.stringify({ scripts: { build: 'pnpm -r build' } });
    const after = JSON.stringify({
      scripts: {
        build: 'pnpm -r build',
        'harness:review': 'node scripts/harness/review-change.mjs',
      },
    });
    const runGit = (args) => {
      if (args[0] === 'merge-base') return ok('base1\n');
      if (args[0] === 'diff') return ok('package.json\n');
      if (args[0] === 'show') return ok(args[1] === 'base1:package.json' ? before : after);
      return fail();
    };

    expect(classifyRange({ baseRef: 'origin/develop', runGit })).toMatchObject({
      code: true,
      product: false,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
      full: false,
      harness: true,
      buildMachinery: false,
      dependencies: false,
    });
  });

  it('routes package manifests by semantic fields instead of fanning metadata to every surface', () => {
    const classifyManifest = (before, after) => {
      const runGit = (args) => {
        if (args[0] === 'merge-base') return ok('base1\n');
        if (args[0] === 'diff') return ok('packages/agent-core/package.json\n');
        if (args[0] === 'show') return ok(args[1].startsWith('base1:') ? before : after);
        return fail();
      };
      return classifyRange({ baseRef: 'origin/develop', runGit });
    };

    const versionOnly = classifyManifest(
      JSON.stringify({ name: '@robota-sdk/agent-core', version: '1.0.0' }),
      JSON.stringify({ name: '@robota-sdk/agent-core', version: '1.0.1' }),
    );
    expect(versionOnly).toMatchObject({
      product: false,
      dependencies: false,
      buildMachinery: false,
      full: false,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
    });

    const testScriptOnly = classifyManifest(
      JSON.stringify({ scripts: { test: 'vitest run' } }),
      JSON.stringify({ scripts: { test: 'vitest run --passWithNoTests' } }),
    );
    expect(testScriptOnly).toMatchObject({
      product: true,
      dependencies: false,
      buildMachinery: false,
      full: false,
    });

    const engineOnly = classifyManifest(
      JSON.stringify({ engines: { node: '>=20' } }),
      JSON.stringify({ engines: { node: '>=22' } }),
    );
    expect(engineOnly).toMatchObject({
      product: true,
      dependencies: false,
      buildMachinery: false,
      full: false,
    });

    const dependency = classifyManifest(
      JSON.stringify({ dependencies: { effect: '^3.0.0' } }),
      JSON.stringify({ dependencies: { effect: '^3.1.0' } }),
    );
    expect(dependency).toMatchObject({
      product: true,
      dependencies: true,
      buildMachinery: false,
      full: false,
    });

    const buildScript = classifyManifest(
      JSON.stringify({ scripts: { build: 'tsdown' } }),
      JSON.stringify({ scripts: { build: 'tsdown --clean' } }),
    );
    expect(buildScript).toMatchObject({
      product: true,
      dependencies: false,
      buildMachinery: true,
      full: false,
    });
  });

  it('classifies a root build-script edit as product-full build machinery', () => {
    const before = JSON.stringify({ scripts: { build: 'pnpm -r build', test: 'pnpm -r test' } });
    const after = JSON.stringify({
      scripts: { build: 'node scripts/build-types-ordered.mjs', test: 'pnpm -r test' },
    });
    const runGit = (args) => {
      if (args[0] === 'merge-base') return ok('base1\n');
      if (args[0] === 'diff') return ok('package.json\n');
      if (args[0] === 'show') return ok(args[1] === 'base1:package.json' ? before : after);
      return fail();
    };

    expect(classifyRange({ baseRef: 'origin/develop', runGit })).toMatchObject({
      product: true,
      full: true,
      harness: true,
      buildMachinery: true,
      tui: true,
      examples: true,
      windows: true,
      cli: true,
    });
  });

  it('fails closed when root manifest Git content is malformed or unreadable', () => {
    const run = (headResult) => (args) => {
      if (args[0] === 'merge-base') return ok('base1\n');
      if (args[0] === 'diff') return ok('package.json\n');
      if (args[0] === 'show' && args[1] === 'base1:package.json') {
        return ok('{"scripts":{"build":"pnpm -r build"}}');
      }
      if (args[0] === 'show') return headResult;
      return fail();
    };

    expect(classifyRange({ baseRef: 'origin/develop', runGit: run(ok('{bad')) }).product).toBe(
      true,
    );
    expect(classifyRange({ baseRef: 'origin/develop', runGit: run(fail()) }).product).toBe(true);
  });
});

describe('CLI (the shape both workflows call)', () => {
  it('prints a `code=` line and exits 0 against the real repository', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--base-ref', 'origin/develop', '--head', 'HEAD'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^code=(true|false)$/m);
    expect(result.stdout).toMatch(/^product=(true|false)$/m);
    expect(result.stdout).toMatch(/^tui=(true|false)$/m);
    expect(result.stdout).toMatch(/^examples=(true|false)$/m);
    expect(result.stdout).toMatch(/^windows=(true|false)$/m);
    expect(result.stdout).toMatch(/^cli=(true|false)$/m);
    expect(result.stdout).toMatch(/^harness=(true|false)$/m);
    expect(result.stdout).toMatch(/^hermetic=(true|false)$/m);
    expect(result.stdout).toMatch(/^build_machinery=(true|false)$/m);
    expect(result.stdout).toMatch(/^full=(true|false)$/m);
  });

  it('FAIL-CLOSED: an unresolvable base ref still answers code=true', () => {
    const result = spawnSync(
      process.execPath,
      [SCRIPT, '--base-ref', 'origin/definitely-no-such-ref'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('code=true');
    expect(result.stdout).toContain('::error::changes:');
  });
});

describe('CI capability wiring', () => {
  it('declares four stable required decisions backed by real jobs', () => {
    const declaration = JSON.parse(
      readFileSync(path.join(REPO_ROOT, '.github/required-status-checks.json'), 'utf8'),
    );
    const required = declaration.branches.develop.required_status_checks;
    expect(required.map(({ context }) => context)).toEqual([
      'pr-validation',
      'security',
      'review-policy',
      'workflow provenance',
    ]);
    for (const item of required) {
      const workflow = readFileSync(path.join(REPO_ROOT, item.workflow), 'utf8');
      expect(workflow, item.context).toContain(`\n  ${item.job}:\n`);
    }
  });

  it('publishes selectors and skips unrelated child runners at the job boundary', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    for (const output of ['tui', 'examples', 'windows', 'cli', 'build_machinery']) {
      expect(workflow).toContain(`${output}: \${{ steps.filter.outputs.${output} }}`);
    }
    for (const output of ['product', 'harness', 'hermetic', 'workflow', 'dependencies', 'full']) {
      expect(workflow).toContain(`steps.control-plane.outputs.${output}`);
    }
    expect(workflow).not.toContain('verification not applicable');
    expect(workflow).toContain("needs.changes.outputs.harness == 'true'");
    expect(workflow).toContain("needs.changes.outputs.hermetic == 'true'");
    expect(workflow).toContain("needs.changes.outputs.examples == 'true'");
    expect(workflow).toContain("needs.changes.outputs.windows == 'true'");
    expect(workflow).toContain("needs.changes.outputs.tui == 'true'");
  });

  it('splits repository, contract and hermetic responsibilities with one non-executing aggregate', () => {
    const workflow = parse(readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8'));
    expect(workflow.jobs).toHaveProperty('repo-checks');
    expect(workflow.jobs).toHaveProperty('harness-contracts');
    expect(workflow.jobs).toHaveProperty('harness-hermetic');
    expect(workflow.jobs).not.toHaveProperty('scans');
    expect(workflow.jobs).not.toHaveProperty('quality');
    expect(workflow.jobs['pr-validation'].needs).toEqual(
      expect.arrayContaining(['repo-checks', 'harness-contracts', 'harness-hermetic']),
    );
    const aggregate = workflow.jobs['pr-validation'].steps.map((step) => step.run ?? '').join('\n');
    expect(aggregate).not.toMatch(/pnpm|vitest|harness:scan/u);
  });
});

describe('harness records under .agents/ are infrastructure, not product', () => {
  it('a harness record plus a harness script is code but not product', () => {
    const verdict = classifyFiles(['.agents/tasks/README.md', 'scripts/harness/run-all-scans.mjs']);
    expect(verdict.code).toBe(true);
    expect(verdict.product).toBe(false);
  });

  it('a package source file is still product', () => {
    expect(classifyFiles(['packages/agent-core/src/index.ts']).product).toBe(true);
  });
});
