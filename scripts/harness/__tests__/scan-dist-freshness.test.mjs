import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTemp } from './make-temp.mjs';

import { describe, expect, it } from 'vitest';

import {
  collectDistFreshnessResults,
  freshnessVerdict,
  isEmittedSourceFile,
  presenceResults,
  walkTree,
} from '../scan-dist-freshness.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-dist-freshness.mjs', import.meta.url));

function writeFiles(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
}

// `build:js` is in the default because freshness is only compared for packages the ROOT build
// rebuilds — `pnpm --filter "./packages/**" build:js`. Presence checks apply to every buildable
// scope, so `build` alone still exercises those; the freshness half needs both halves of that
// filter, which is why fixtures asserting freshness live under `packages/`.
function scope(relativeDir, workspaceName, scripts = { build: 'tsc', 'build:js': 'tsdown' }) {
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
  const root = makeTemp('robota-dist-freshness-');
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

  it('errors for a package whose `main` points at dist with no exports block', async () => {
    // HARNESS-052 recorded this line as an operator-precedence bug: `pkg.main?.includes('dist') ||
    // pkg.exports ? JSON.stringify(pkg.exports ?? {}).includes('dist') : false` parses as
    // `(a || b) ? c : false`, so a `main`-only package took the `exports` branch, stringified an
    // EMPTY object, and had its genuine missing-dist ERROR downgraded to a non-blocking warning.
    // A package that publishes `main: dist/index.js` and ships no dist is broken, not internal.
    // Measured on this repo: 3 packages change classification, all `private: true` and therefore
    // short-circuited before this branch — the repair alters no live verdict here.
    const root = await createRoot({
      'packages/internal/package.json': JSON.stringify({
        name: '@fixture/internal',
        main: 'dist/index.js',
      }),
    });

    const { results } = await collectDistFreshnessResults(root, [
      scope('packages/internal', '@fixture/internal'),
    ]);
    expect(results).toEqual([
      {
        kind: 'error',
        message:
          '@fixture/internal (packages/internal): dist/ is missing or empty — run pnpm build first',
      },
    ]);
  });

  it('warns (not errors) for an internal package with neither dist exports nor bin', async () => {
    const root = await createRoot({
      'packages/internal/package.json': JSON.stringify({ name: '@fixture/internal' }),
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
        // `build:js` under `packages/` is what the root build actually rebuilds, and freshness is
        // only claimed for those. Without it this fixture is correctly reported unmeasurable.
        scripts: { build: 'tsc', 'build:js': 'tsdown' },
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
    // The banner states the count it ACTUALLY asserted, not the buildable total: a private or
    // non-dist-exporting package that has a dist produces no presence result at all, so
    // "All 86 buildable packages have dist/" was a universal claim over 43 of them (HARNESS-053).
    expect(result.stdout).toContain('dist/ present on all 1 package(s) required to have one');
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

// ---------------------------------------------------------------------------------------------
// HARNESS-053 — the FRESHNESS rule. Each rule is tested SEPARATELY, because HARNESS-052's own
// guard shipped three defects of which two masked each other, and only per-rule falsification
// would have separated them.
// ---------------------------------------------------------------------------------------------

/** Stamp an absolute mtime (seconds since epoch) so fixtures never depend on wall-clock ordering. */
function setMtime(absolutePath, epochSeconds) {
  utimesSync(absolutePath, epochSeconds, epochSeconds);
}

describe('isEmittedSourceFile', () => {
  it.each(['index.ts', 'nested/deep/foo.tsx', 'schema.json', 'legacy.mjs', 'types/index.d.ts'])(
    'accepts %s — it can move the emitted type surface',
    (relativePath) => {
      expect(isEmittedSourceFile(relativePath)).toBe(true);
    },
  );

  it.each(['README.md', 'notes.txt', 'logo.svg'])(
    'rejects %s — a non-source file beside the code emits no declaration',
    (relativePath) => {
      expect(isEmittedSourceFile(relativePath)).toBe(false);
    },
  );

  it.each([
    'robota.test.ts',
    'nested/robota.test.tsx',
    'parser.spec.ts',
    // `.json` IS an emitted source extension, so a JS/TS-only test pattern let a test fixture count
    // as a source and touching it marked the package stale. Found in review; measured before the
    // fix — `isEmittedSourceFile('src/a.test.json')` returned true.
    'payload.test.json',
    'payload.spec.json',
    '__tests__/helper.ts',
    '__mocks__/provider.ts',
    '__fixtures__/payload.json',
    '__snapshots__/render.ts',
  ])('rejects %s — tsconfig.build.json keeps it out of the build', (relativePath) => {
    expect(isEmittedSourceFile(relativePath)).toBe(false);
  });

  it('rejects an empty path rather than treating it as source', () => {
    expect(isEmittedSourceFile('')).toBe(false);
    expect(isEmittedSourceFile(undefined)).toBe(false);
  });
});

describe('walkTree', () => {
  it('reports nothing for a directory that does not exist', async () => {
    const root = await createRoot({});
    expect(walkTree(path.join(root, 'nope'))).toEqual({ fileCount: 0, newest: null });
  });

  it('finds the newest file across nested directories', async () => {
    const root = await createRoot({
      'tree/a.ts': 'a',
      'tree/deep/b.ts': 'b',
      'tree/deep/deeper/c.ts': 'c',
    });
    setMtime(path.join(root, 'tree/a.ts'), 1000);
    setMtime(path.join(root, 'tree/deep/b.ts'), 3000);
    setMtime(path.join(root, 'tree/deep/deeper/c.ts'), 2000);

    const walk = walkTree(path.join(root, 'tree'));
    expect(walk.fileCount).toBe(3);
    expect(walk.newest.path.split(path.sep).join('/')).toBe('deep/b.ts');
    expect(walk.newest.mtimeMs).toBe(3_000_000);
  });

  it('never lets a rejected file become the newest (RED without the filter)', async () => {
    const root = await createRoot({ 'tree/a.ts': 'a', 'tree/a.test.ts': 'test' });
    setMtime(path.join(root, 'tree/a.ts'), 1000);
    setMtime(path.join(root, 'tree/a.test.ts'), 9000);

    const filtered = walkTree(path.join(root, 'tree'), isEmittedSourceFile);
    expect(filtered.fileCount).toBe(1);
    expect(filtered.newest.mtimeMs).toBe(1_000_000);

    // Without the filter the very same tree answers with the test file — this is the rule the
    // assertion above depends on, pinned rather than assumed.
    expect(walkTree(path.join(root, 'tree')).newest.mtimeMs).toBe(9_000_000);
  });
});

describe('freshnessVerdict', () => {
  const src = (mtimeMs) => ({ path: 'index.ts', mtimeMs });
  const dist = (mtimeMs) => ({ path: 'index.d.ts', mtimeMs });

  it('is unmeasurable — never "fresh" — when there is no source to compare', () => {
    expect(freshnessVerdict(null, dist(10)).state).toBe('unmeasurable');
  });

  it('is unmeasurable — never "stale" — on a cold checkout with no dist at all', () => {
    // The case that separates a freshness check from the presence check it replaces. A fresh clone
    // has every source stamped at checkout time and no dist; reporting that as stale would redden
    // correct state, which is the one outcome this item forbids.
    expect(freshnessVerdict(src(10), null)).toEqual({
      state: 'unmeasurable',
      reason: 'no artefacts under dist/',
    });
  });

  it('reports STALE when the newest source is newer than the newest artefact', () => {
    const verdict = freshnessVerdict(src(5_000), dist(2_000));
    expect(verdict.state).toBe('stale');
    expect(verdict.lagMs).toBe(3_000);
  });

  it('reports FRESH when the newest artefact is newer than the newest source', () => {
    expect(freshnessVerdict(src(2_000), dist(5_000)).state).toBe('fresh');
  });

  it('reports FRESH — not stale — on an exact mtime tie', () => {
    // A build reads src then writes dist, so equal stamps mean the artefact is not older. Strict
    // `>` keeps a same-millisecond tie out of the advisory.
    expect(freshnessVerdict(src(4_000), dist(4_000)).state).toBe('fresh');
  });
});

describe('presenceResults (pure branch table)', () => {
  const scopeA = scope('packages/pkg-a', '@fixture/pkg-a');

  it('asserts presence for a dist-exporting package that has one', () => {
    const pkg = { exports: { '.': './dist/index.js' } };
    expect(presenceResults(scopeA, pkg, true)).toEqual([
      { kind: 'ok', message: '@fixture/pkg-a: dist/ present' },
    ]);
  });

  it('errors for a dist-exporting package that has none', () => {
    const pkg = { exports: { '.': './dist/index.js' } };
    expect(presenceResults(scopeA, pkg, false)[0].kind).toBe('error');
  });

  it('errors for a `main`-only package with no exports block (precedence, HARNESS-052)', () => {
    // The original expression was `pkg.main?.includes('dist') || pkg.exports ? … : false`, which
    // downgraded this genuine missing-dist ERROR to a non-blocking warning.
    expect(presenceResults(scopeA, { main: 'dist/index.js' }, false)[0].kind).toBe('error');
  });

  it('errors for a bin-only package with no dist', () => {
    expect(presenceResults(scopeA, { bin: { fx: 'dist/cli.js' } }, false)[0].kind).toBe('error');
  });

  it('warns, not errors, for a private package with no dist', () => {
    expect(presenceResults(scopeA, { private: true }, false)[0].kind).toBe('warn');
  });

  it('asserts nothing for a private package that has a dist', () => {
    expect(presenceResults(scopeA, { private: true }, true)).toEqual([]);
  });
});

describe('collectDistFreshnessResults — freshness integration', () => {
  function distExportingPackage(name) {
    return JSON.stringify({ name, exports: { '.': './dist/index.js' } });
  }

  it('reports STALE when src is newer than dist (RED)', async () => {
    const root = await createRoot({
      'packages/pkg-a/package.json': distExportingPackage('@fixture/pkg-a'),
      'packages/pkg-a/src/index.ts': 'export const a = 1;\n',
      'packages/pkg-a/dist/index.d.ts': 'export declare const a: number;\n',
    });
    setMtime(path.join(root, 'packages/pkg-a/dist/index.d.ts'), 1000);
    setMtime(path.join(root, 'packages/pkg-a/src/index.ts'), 5000);

    const { results, freshness } = await collectDistFreshnessResults(root, [
      scope('packages/pkg-a', '@fixture/pkg-a'),
    ]);
    expect(freshness).toEqual({ measured: 1, fresh: 0, stale: 1, unmeasurable: 0 });
    const stale = results.find((r) => r.kind === 'stale');
    expect(stale.message).toContain('@fixture/pkg-a: dist/ may be STALE');
    expect(stale.message).toContain('src/index.ts');
    expect(stale.message).toContain('dist/index.d.ts');
  });

  it('is silent on a genuinely fresh tree (no regression)', async () => {
    const root = await createRoot({
      'packages/pkg-a/package.json': distExportingPackage('@fixture/pkg-a'),
      'packages/pkg-a/src/index.ts': 'export const a = 1;\n',
      'packages/pkg-a/dist/index.d.ts': 'export declare const a: number;\n',
    });
    setMtime(path.join(root, 'packages/pkg-a/src/index.ts'), 1000);
    setMtime(path.join(root, 'packages/pkg-a/dist/index.d.ts'), 5000);

    const { results, freshness } = await collectDistFreshnessResults(root, [
      scope('packages/pkg-a', '@fixture/pkg-a'),
    ]);
    expect(freshness).toEqual({ measured: 1, fresh: 1, stale: 0, unmeasurable: 0 });
    expect(results.some((r) => r.kind === 'stale')).toBe(false);
  });

  it('is silent on a cold checkout with no dist at all (no regression)', async () => {
    const root = await createRoot({
      'packages/pkg-a/package.json': distExportingPackage('@fixture/pkg-a'),
      'packages/pkg-a/src/index.ts': 'export const a = 1;\n',
    });

    const { results, freshness } = await collectDistFreshnessResults(root, [
      scope('packages/pkg-a', '@fixture/pkg-a'),
    ]);
    expect(freshness).toEqual({ measured: 0, fresh: 0, stale: 0, unmeasurable: 1 });
    expect(results.some((r) => r.kind === 'stale')).toBe(false);
    // The presence rule still owns the missing dist — freshness adds no second verdict on top.
    expect(results.map((r) => r.kind)).toEqual(['error']);
  });

  it('does not report STALE when only a test file is newer than dist', async () => {
    const root = await createRoot({
      'packages/pkg-a/package.json': distExportingPackage('@fixture/pkg-a'),
      'packages/pkg-a/src/index.ts': 'export const a = 1;\n',
      'packages/pkg-a/src/index.test.ts': 'it("x", () => {});\n',
      'packages/pkg-a/dist/index.d.ts': 'export declare const a: number;\n',
    });
    setMtime(path.join(root, 'packages/pkg-a/src/index.ts'), 1000);
    setMtime(path.join(root, 'packages/pkg-a/dist/index.d.ts'), 5000);
    setMtime(path.join(root, 'packages/pkg-a/src/index.test.ts'), 9000);

    const { freshness } = await collectDistFreshnessResults(root, [
      scope('packages/pkg-a', '@fixture/pkg-a'),
    ]);
    expect(freshness.stale).toBe(0);
    expect(freshness.fresh).toBe(1);
  });

  it('assesses freshness for a private package too, when it has both src and dist', async () => {
    const root = await createRoot({
      'packages/pkg-private/package.json': JSON.stringify({
        name: '@fixture/pkg-private',
        private: true,
      }),
      'packages/pkg-private/src/index.ts': 'export const a = 1;\n',
      'packages/pkg-private/dist/index.js': 'export const a = 1;\n',
    });
    setMtime(path.join(root, 'packages/pkg-private/dist/index.js'), 1000);
    setMtime(path.join(root, 'packages/pkg-private/src/index.ts'), 5000);

    const { freshness } = await collectDistFreshnessResults(root, [
      scope('packages/pkg-private', '@fixture/pkg-private'),
    ]);
    expect(freshness.stale).toBe(1);
  });

  // Freshness is only claimed for what the ROOT build rebuilds — `pnpm --filter "./packages/**"
  // build:js`. Measured immediately after a clean `pnpm build`, three workspaces still reported
  // stale by 167-383 hours, and running the command the advisory recommends would never have
  // cleared any of them. An advisory that survives the action it advises trains people to ignore
  // the channel.
  it('does not claim staleness for an app, which the root build never rebuilds', async () => {
    const root = await createRoot({
      'apps/app-a/package.json': JSON.stringify({ name: '@fixture/app-a', private: true }),
      'apps/app-a/src/index.ts': 'export const a = 1;\n',
      'apps/app-a/dist/index.js': 'export const a = 1;\n',
    });
    setMtime(path.join(root, 'apps/app-a/dist/index.js'), 1000);
    setMtime(path.join(root, 'apps/app-a/src/index.ts'), 5000);

    // Declaring `build:js` is not enough — `apps/remote-signaling` declares it and is still outside
    // the `./packages/**` filter, which is the case that survived the first version of this rule.
    const { freshness } = await collectDistFreshnessResults(root, [
      scope('apps/app-a', '@fixture/app-a', { build: 'tsdown', 'build:js': 'tsdown' }),
    ]);
    expect(freshness.stale).toBe(0);
    expect(freshness.unmeasurable).toBe(1);
  });

  it('does not claim staleness for a package the root build skips (no build:js)', async () => {
    const root = await createRoot({
      'packages/pkg-vite/package.json': JSON.stringify({ name: '@fixture/pkg-vite' }),
      'packages/pkg-vite/src/main.tsx': 'export const a = 1;\n',
      'packages/pkg-vite/dist/index.html': '<html></html>\n',
    });
    setMtime(path.join(root, 'packages/pkg-vite/dist/index.html'), 1000);
    setMtime(path.join(root, 'packages/pkg-vite/src/main.tsx'), 5000);

    const { freshness } = await collectDistFreshnessResults(root, [
      scope('packages/pkg-vite', '@fixture/pkg-vite', { build: 'vite build' }),
    ]);
    expect(freshness.stale).toBe(0);
    expect(freshness.unmeasurable).toBe(1);
  });
});

describe('scan-dist-freshness CLI — freshness severity', () => {
  function staleFixtureFiles() {
    return {
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      'packages/pkg-a/package.json': JSON.stringify({
        name: '@fixture/pkg-a',
        exports: { '.': './dist/index.js' },
        // `build:js` under `packages/` is what the root build actually rebuilds, and freshness is
        // only claimed for those. Without it this fixture is correctly reported unmeasurable.
        scripts: { build: 'tsc', 'build:js': 'tsdown' },
      }),
      'packages/pkg-a/src/index.ts': 'export const a = 1;\n',
      'packages/pkg-a/dist/index.d.ts': 'export declare const a: number;\n',
    };
  }

  // spawnSync, not execFileSync: the advisory goes to stderr via console.warn, and execFileSync's
  // SUCCESS path returns stdout only — a helper that cannot see the advisory would make the
  // severity assertion below unfalsifiable, which is this item's own subject.
  function run(cwd) {
    const result = spawnSync(process.execPath, [SCAN_SCRIPT], { cwd, encoding: 'utf8' });
    return {
      status: result.status,
      stdout: `${result.stdout ?? ''}`,
      stderr: `${result.stderr ?? ''}`,
    };
  }

  it('reports staleness but EXITS 0 — the freshness rule is advisory, never blocking', async () => {
    const root = await createRoot(staleFixtureFiles());
    setMtime(path.join(root, 'packages/pkg-a/dist/index.d.ts'), 1000);
    setMtime(path.join(root, 'packages/pkg-a/src/index.ts'), 5000);

    const result = run(root);
    // This assertion IS the severity decision. mtime is evidence, not proof: a source reverted to
    // the exact content its dist was built from is fresh in content and stale in mtime. A blocking
    // gate that reddens on correct state gets `--skip`-ed, and ci.yml already carries `--skip dist`.
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('dist/ may be STALE');
    expect(result.stdout).toContain('freshness: 1 stale / 1 compared');
  });

  it('reports the freshness tally even when nothing is stale', async () => {
    const root = await createRoot(staleFixtureFiles());
    setMtime(path.join(root, 'packages/pkg-a/src/index.ts'), 1000);
    setMtime(path.join(root, 'packages/pkg-a/dist/index.d.ts'), 5000);

    const result = run(root);
    expect(result.status).toBe(0);
    // "ran and measured nothing" must not render as "ran and found nothing" (HARNESS-052).
    expect(result.stdout).toContain('freshness: 0 stale / 1 compared');
    expect(result.stdout).not.toContain('may be STALE');
  });

  it('states the count it ASSERTED, not the buildable total', async () => {
    // Pinned with the two numbers DIFFERENT on purpose. The first version of this suite exercised
    // only a 1-package fixture, where `presenceAsserted === buildableCount` — so reinstating the
    // "All N buildable packages have dist/" overclaim failed ZERO tests. Measured, not assumed:
    // that mutation was run and came back green, which is why this case exists.
    const root = await createRoot({
      ...staleFixtureFiles(),
      // Buildable and has a dist, but private — so it produces no presence result and the
      // universal claim must not count it.
      'packages/pkg-private/package.json': JSON.stringify({
        name: '@fixture/pkg-private',
        private: true,
        scripts: { build: 'tsc' },
      }),
      'packages/pkg-private/dist/index.js': 'export {};\n',
    });

    const result = run(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'dist/ present on all 1 package(s) required to have one (of 2 buildable',
    );
    expect(result.stdout).not.toContain('all 2 package(s) required');
  });

  it('exits 1 when the workspace enumerates ZERO buildable packages (fail closed)', async () => {
    // MEASURED before the guard existed: this fixture printed "dist/ present on all 0 package(s)"
    // and exited 0. That is HARNESS-052's audited defect — a pass over work never done — found
    // live inside HARNESS-053, the item written to fix an instance of it.
    const root = await createRoot({ 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n" });

    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('measured nothing');
  });

  it('still exits 1 for a missing dist even while a sibling is stale', async () => {
    const root = await createRoot({
      ...staleFixtureFiles(),
      'packages/pkg-b/package.json': JSON.stringify({
        name: '@fixture/pkg-b',
        exports: { '.': './dist/index.js' },
        scripts: { build: 'tsc' },
      }),
    });
    setMtime(path.join(root, 'packages/pkg-a/dist/index.d.ts'), 1000);
    setMtime(path.join(root, 'packages/pkg-a/src/index.ts'), 5000);

    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('dist/ is missing or empty');
  });
});
