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
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

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
    expect(
      reviewGate.match(/^\s*node scripts\/harness\/classify-changed-paths\.mjs/gm),
    ).toHaveLength(1);
  });

  it('every declared docs path is classified docs-only, and code paths are not', () => {
    expect(DOCS_ONLY_GLOBS).toEqual(['**/*.md', '**/*.mdx', 'docs/**', 'content/**']);
    for (const file of ['README.md', '.agents/tasks/X.md', 'docs/a/b.mdx', 'content/post.md']) {
      expect(isDocsOnlyPath(file), file).toBe(true);
    }
    for (const file of [
      'packages/agent-core/src/index.ts',
      'scripts/harness/check-review-gate.mjs',
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
    'scripts/harness/check-review-gate.mjs',
    '.github/workflows/ci.yml',
    '.agents/harness.config.json',
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
    expect(classifyFiles(['scripts/harness/check-review-gate.mjs'])).toMatchObject({
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
      resolveCapabilityReachability(['packages/agent-transport-tui/src/App.tsx'], {
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
  ])('keeps harness/control-plane input %s out of product-full verification', (file) => {
    expect(isFullVerificationPath(file)).toBe(false);
    expect(classifyFiles([file])).toMatchObject({
      code: true,
      product: false,
      full: false,
      harness: true,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
    });
  });

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

  it('keeps this infrastructure change shape on explicit product N/A paths', () => {
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
      product: false,
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
      return ok(args[3] === 'base1' ? 'README.md\n' : 'packages/a/src/x.ts\n');
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
    expect(calls[1]).toEqual(['diff', '--name-only', '--diff-filter=ACMRD', 'base1', 'HEAD']);
    expect(result).toMatchObject({ harness: true, files: ['scripts/harness/deleted.mjs'] });
  });

  it('classifies a harness-only root manifest from immutable Git objects', () => {
    const before = JSON.stringify({ scripts: { build: 'pnpm -r build' } });
    const after = JSON.stringify({
      scripts: {
        build: 'pnpm -r build',
        'harness:work-run': 'node scripts/harness/work-run.mjs',
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
    });
  });

  it('classifies any root scripts-only manifest edit as harness work, not product-full', () => {
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
      product: false,
      full: false,
      harness: true,
      tui: false,
      examples: false,
      windows: false,
      cli: false,
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
  it('keeps all 11 declared develop required contexts and their workflow job names', () => {
    const declaration = JSON.parse(
      readFileSync(path.join(REPO_ROOT, '.github/required-status-checks.json'), 'utf8'),
    );
    const required = declaration.branches.develop.required_status_checks;

    expect(required).toHaveLength(11);
    for (const item of required) {
      const workflow = readFileSync(path.join(REPO_ROOT, item.workflow), 'utf8');
      expect(workflow, item.context).toContain(`\n  ${item.job}:\n`);
      expect(workflow, item.context).toMatch(
        new RegExp(`^    name: ['"]?${item.context.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`, 'mu'),
      );
    }
  });

  it('publishes capability outputs and keeps expensive required jobs present with explicit N/A results', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

    expect(workflow).toContain('product: ${{ steps.filter.outputs.product }}');
    expect(workflow).toContain('tui: ${{ steps.filter.outputs.tui }}');
    expect(workflow).toContain('examples: ${{ steps.filter.outputs.examples }}');
    expect(workflow).toContain('windows: ${{ steps.filter.outputs.windows }}');
    expect(workflow).toContain('cli: ${{ steps.filter.outputs.cli }}');
    expect(workflow).toContain('harness: ${{ steps.filter.outputs.harness }}');
    expect(workflow).toContain('full: ${{ steps.filter.outputs.full }}');
    expect(workflow).toContain('name: Product verification not applicable');
    expect(workflow).toContain('name: TUI verification not applicable');
    expect(workflow).toContain('name: Examples verification not applicable');
    expect(workflow).toContain('name: Windows verification not applicable');
    expect(workflow).toContain("needs.changes.result != 'success'");
  });

  it('routes ordinary package work to affected scripts and full inputs to full scripts', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

    expect(workflow).toContain("needs.changes.outputs.full == 'true'");
    expect(workflow).toContain('pnpm build:affected');
    expect(workflow).toContain('pnpm test:affected');
    expect(workflow).toContain('pnpm typecheck:affected');
    expect(workflow).toContain('pnpm lint:affected');
    expect(workflow).toContain('pnpm examples:typecheck:affected');
    expect(workflow).toContain('pnpm build\n');
    expect(workflow).toContain('start_check test pnpm test\n');
    expect(workflow).toContain('start_check typecheck pnpm typecheck\n');
    expect(workflow).toContain('start_check lint pnpm lint\n');
    expect(workflow).toContain('pnpm examples:typecheck\n');
  });

  it('aggregates concurrent package quality children without dropping failures', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const quality = workflow.slice(
      workflow.indexOf('\n  quality:\n'),
      workflow.indexOf('\n  scans:\n'),
    );

    expect(quality).toContain('wait "${pids[$index]}" || status=$?');
    expect(quality).toContain('log is missing or unreadable');
    expect(quality).toContain('exit "$failed"');
    expect(quality).not.toContain('pnpm harness:verify --');
  });

  it('never treats a partial package-dist restore as a complete consumer build', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const quality = workflow.slice(
      workflow.indexOf('\n  quality:\n'),
      workflow.indexOf('\n  scans:\n'),
    );
    const examples = workflow.slice(
      workflow.indexOf('\n  examples-typecheck:\n'),
      workflow.indexOf('\n  windows-shell:\n'),
    );
    const tui = workflow.slice(
      workflow.indexOf('\n  tui-e2e:\n'),
      workflow.indexOf('\n  regression-red-proof:\n'),
    );
    const coverage = workflow.slice(workflow.indexOf('\n  patch-coverage:\n'));

    expect(workflow).toContain('package_dist_complete:');
    expect(quality).not.toContain('Guarantee selected typecheck target prerequisites');
    expect(quality).toContain('name: Guarantee CLI binary target dist');
    expect(quality).not.toContain('--operation consumer-build');
    expect(examples).toContain('name: Guarantee affected example consumer dist');
    expect(examples).toContain('args=(harness:workspace:run -- --operation build)');
    expect(examples).toContain('--changed-file "$target"');
    expect(tui).toContain('name: Guarantee CLI and TUI consumer dist');
    expect(tui).toContain('--changed-file packages/agent-cli/src/__ci_consumer_target__.ts');
    expect(tui).toContain(
      '--changed-file packages/agent-transport-tui/src/__ci_consumer_target__.ts',
    );
    expect(coverage).toContain('name: Guarantee affected coverage dist');
    expect(coverage).toContain('run: pnpm build:affected');
    expect(examples).not.toContain("steps.restore.outputs.restored != 'true'");
    expect(tui).not.toContain("steps.restore.outputs.restored != 'true'");
  });

  it('runs CLI binary e2e only for CLI-reachable changes and guarantees its dist first', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const quality = workflow.slice(
      workflow.indexOf('\n  quality:\n'),
      workflow.indexOf('\n  scans:\n'),
    );
    const cliBuild = quality.indexOf('name: Guarantee CLI binary target dist');
    const binaryE2e = quality.indexOf('name: Binary e2e (agent-cli bintests, dist-dependent)');

    expect(quality).toContain("CLI_APPLICABLE: ${{ needs.changes.result != 'success'");
    expect(quality).toContain("if: env.CLI_APPLICABLE == 'true'");
    expect(quality).toContain('name: Binary e2e not applicable');
    expect(cliBuild).toBeGreaterThanOrEqual(0);
    expect(binaryE2e).toBeGreaterThan(cliBuild);
  });

  it('restores content-validated contract and lint caches across heads', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

    expect(workflow).toContain('name: Restore cross-head contract-test content cache');
    expect(workflow).toContain(
      'key: robota-contract-tests-v1-${{ runner.os }}-node22-${{ github.event.pull_request.head.sha || inputs.head_ref }}-${{ github.run_id }}-${{ github.run_attempt }}',
    );
    expect(workflow).toContain('robota-contract-tests-v1-${{ runner.os }}-node22-\n');
    expect(workflow).toContain('name: Restore cross-head ESLint content cache');
    expect(workflow).toContain('--cache-strategy content');
    expect(workflow).toContain('start_check lint pnpm lint:affected');
    expect(workflow).toContain('start_check lint-ceiling pnpm exec eslint packages apps');
  });

  it('archives only after every planned dist contract is present', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const build = workflow.slice(
      workflow.indexOf('\n  build:\n'),
      workflow.indexOf('\n  quality:\n'),
    );

    expect(build).toContain('name: Plan package-dist artifact membership');
    expect(build).toContain('workspace-build-plan.json');
    expect(build).toContain('planned build output is missing: ${dist}');
    expect(build).toContain('package-dist-membership.bin');
    expect(build.indexOf('planned build output is missing')).toBeLessThan(
      build.indexOf('tar --null -czf package-dist.tgz'),
    );
  });

  it('assigns the harness suite to scans instead of rerunning it in quality', () => {
    const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    const qualityStart = workflow.indexOf('\n  quality:\n');
    const scansStart = workflow.indexOf('\n  scans:\n');
    const quality = workflow.slice(qualityStart, scansStart);
    const scans = workflow.slice(scansStart, workflow.indexOf('\n  dependency-audit:\n'));

    expect(quality).not.toContain('harness:test');
    expect(scans).toContain('pnpm harness:test:contracts:affected');
    expect(scans).toContain('pnpm harness:test:hermetic');
    expect(scans).toContain("needs.changes.outputs.harness != 'false'");
    expect(scans).toContain('pnpm harness:scan -- --skip dist --skip build-contracts');
    expect(scans).toContain('wait "${pids[$index]}" || status=$?');
    expect(scans).not.toMatch(/scripts\/harness\/\*\*/);
  });
});

describe('the harness records under .agents/ are infrastructure, not product (PROC-016)', () => {
  it('a ledger append plus a harness script is code but not product', () => {
    const verdict = classifyFiles([
      '.agents/loop-runs/user-execution-scenario.jsonl',
      'scripts/harness/loop-run.mjs',
    ]);
    expect(verdict.code).toBe(true);
    expect(verdict.product).toBe(false);
  });

  it('a package source file is still product', () => {
    expect(classifyFiles(['packages/agent-core/src/index.ts']).product).toBe(true);
  });
});
