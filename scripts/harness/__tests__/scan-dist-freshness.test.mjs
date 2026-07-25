import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectDistFreshnessResults } from '../scan-dist-freshness.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-dist-freshness.mjs', import.meta.url));

function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
}

function scope(relativeDir, workspaceName, scripts = { build: 'tsc' }) {
  return { relativeDir, workspaceName, scripts };
}

function pkgJson(overrides = {}) {
  // NOTE: `exports` (not just `main`) is what marks a package as dist-exporting for this scan —
  // with only `main`, the scan's hasDistExport expression stringifies the (empty) `exports`.
  return JSON.stringify({
    name: '@fixture/pkg',
    exports: { '.': './dist/index.js' },
    ...overrides,
  });
}

async function createRoot(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-dist-freshness-'));
  writeFiles(root, files);
  return root;
}

describe('collectDistFreshnessResults', () => {
  it('passes a publishable package with a non-empty dist/', async () => {
    const root = await createRoot({
      'packages/pkg-a/package.json': pkgJson({ name: '@fixture/pkg-a' }),
      'packages/pkg-a/dist/index.js': 'export {};\n',
    });

    const { results, buildableCount } = await collectDistFreshnessResults(root, [
      scope('packages/pkg-a', '@fixture/pkg-a'),
    ]);
    expect(buildableCount).toBe(1);
    expect(results).toEqual([{ kind: 'ok', message: '@fixture/pkg-a: dist/ present' }]);
  });

  it('flags a publishable package whose dist/ is missing (RED)', async () => {
    const root = await createRoot({
      'packages/pkg-a/package.json': pkgJson({ name: '@fixture/pkg-a' }),
    });

    const { results } = await collectDistFreshnessResults(root, [
      scope('packages/pkg-a', '@fixture/pkg-a'),
    ]);
    expect(results).toEqual([
      {
        kind: 'error',
        message:
          '@fixture/pkg-a (packages/pkg-a): dist/ is missing or empty — run pnpm build first',
      },
    ]);
  });

  it('flags a publishable package whose dist/ exists but is empty (RED)', async () => {
    const root = await createRoot({
      'packages/pkg-a/package.json': pkgJson({ name: '@fixture/pkg-a' }),
    });
    mkdirSync(path.join(root, 'packages/pkg-a/dist'), { recursive: true });

    const { results } = await collectDistFreshnessResults(root, [
      scope('packages/pkg-a', '@fixture/pkg-a'),
    ]);
    expect(results[0].kind).toBe('error');
  });

  it('flags a bin-only package without dist/ (RED)', async () => {
    const root = await createRoot({
      'packages/cli/package.json': JSON.stringify({
        name: '@fixture/cli',
        bin: { fixture: 'dist/cli.js' },
      }),
    });

    const { results } = await collectDistFreshnessResults(root, [
      scope('packages/cli', '@fixture/cli'),
    ]);
    expect(results[0].kind).toBe('error');
  });

  it('warns (not errors) for a private package without dist/', async () => {
    const root = await createRoot({
      'apps/app-a/package.json': pkgJson({ name: '@fixture/app-a', private: true }),
    });

    const { results } = await collectDistFreshnessResults(root, [
      scope('apps/app-a', '@fixture/app-a'),
    ]);
    expect(results).toEqual([
      { kind: 'warn', message: '@fixture/app-a: no dist/ (private, not published — not blocking)' },
    ]);
  });

  it('warns (not errors) for an internal package with no dist exports and no bin', async () => {
    const root = await createRoot({
      'packages/internal/package.json': JSON.stringify({
        name: '@fixture/internal',
        main: 'dist/index.js', // main alone does not mark a package dist-exporting (see pkgJson note)
      }),
    });

    const { results } = await collectDistFreshnessResults(root, [
      scope('packages/internal', '@fixture/internal'),
    ]);
    expect(results).toEqual([
      { kind: 'warn', message: '@fixture/internal: no dist/ (app/internal, not blocking)' },
    ]);
  });

  it('skips scopes without a build script entirely', async () => {
    const root = await createRoot({
      'packages/no-build/package.json': pkgJson({ name: '@fixture/no-build' }),
    });

    const { results, buildableCount } = await collectDistFreshnessResults(root, [
      scope('packages/no-build', '@fixture/no-build', {}),
    ]);
    expect(buildableCount).toBe(0);
    expect(results).toEqual([]);
  });
});

describe('scan-dist-freshness CLI', () => {
  const WORKSPACE_YAML = "packages:\n  - 'packages/*'\n";

  function cliFixtureFiles() {
    return {
      'pnpm-workspace.yaml': WORKSPACE_YAML,
      'packages/pkg-a/package.json': JSON.stringify({
        name: '@fixture/pkg-a',
        exports: { '.': './dist/index.js' },
        scripts: { build: 'tsc' },
      }),
      'packages/pkg-a/dist/index.js': 'export {};\n',
    };
  }

  function runScan(cwd) {
    try {
      const stdout = execFileSync(process.execPath, [SCAN_SCRIPT], { cwd, encoding: 'utf8' });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      return {
        status: error.status,
        stdout: `${error.stdout ?? ''}`,
        stderr: `${error.stderr ?? ''}`,
      };
    }
  }

  it('exits 0 on a workspace whose buildable package has dist/', async () => {
    const root = await createRoot(cliFixtureFiles());
    const result = runScan(root);
    expect(result.stdout).toContain('All 1 buildable packages have dist/.');
    expect(result.status).toBe(0);
  });

  it('exits 1 when a publishable package is missing dist/ (RED)', async () => {
    const root = await createRoot(cliFixtureFiles());
    rmSync(path.join(root, 'packages/pkg-a/dist'), { recursive: true });

    const result = runScan(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dist/ is missing or empty — run pnpm build first');
  });
});
