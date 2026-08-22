import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import * as plan from '../check-plan.mjs';
import {
  BUILD_DEFINING_ROOT_SCRIPTS,
  extractScriptFileReferences,
  findBuildToolingScopeFindings,
  main,
} from '../scan-build-tooling-scope.mjs';

/**
 * INFRA-060 D4 — the guard's own tests.
 *
 * Each rule is exercised SEPARATELY against a live defect, because HARNESS-052's own guard shipped
 * with three instances of the shape it audited: two of its defects masked each other exactly, and
 * a suite that only ever asserted the aggregate verdict would not have separated them.
 */

const DECLARED = [...plan.WORKSPACE_WIDE_BUILD_TOOLING_PATHS];

afterEach(() => {
  plan.WORKSPACE_WIDE_BUILD_TOOLING_PATHS.length = 0;
  plan.WORKSPACE_WIDE_BUILD_TOOLING_PATHS.push(...DECLARED);
});

const temporaryRoots = [];
afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

/** A miniature workspace: two packages, a root manifest, and the declared tooling files. */
function makeRoot({ buildScript, files = DECLARED } = {}) {
  const root = makeTemp('build-tooling-scope-');
  temporaryRoots.push(root);

  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
  mkdirSync(path.join(root, 'packages', 'alpha'), { recursive: true });
  mkdirSync(path.join(root, 'packages', 'beta'), { recursive: true });
  for (const name of ['alpha', 'beta']) {
    writeFileSync(
      path.join(root, 'packages', name, 'package.json'),
      JSON.stringify({ name: `@x/${name}`, scripts: { build: 'tsdown', test: 'vitest run' } }),
    );
  }

  for (const file of files) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '{}\n');
  }

  // Last, so it survives a declared list that (correctly) contains `package.json` itself.
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'root',
      scripts: { build: buildScript ?? 'node scripts/build-types-ordered.mjs' },
    }),
  );

  return root;
}

/** Two fixture scopes, standing in for the 86 real ones. */
const FIXTURE_SCOPES = ['alpha', 'beta'].map((name) => ({
  kind: 'package',
  relativeDir: `packages/${name}`,
  shortName: name,
  workspaceName: `@x/${name}`,
  scripts: { build: 'tsdown', test: 'vitest run', lint: 'eslint src' },
  hasTsconfig: true,
  workspaceDependencies: [],
}));

const listFixtureScopes = async () => FIXTURE_SCOPES;

function rules(findings) {
  return findings.map((finding) => finding.rule.split(' ')[0]).sort();
}

describe('extractScriptFileReferences', () => {
  it('finds a repo-root file the root build invokes', () => {
    const root = makeRoot();
    expect(
      extractScriptFileReferences('pnpm -r build:js && node scripts/build-types-ordered.mjs', root),
    ).toEqual(['scripts/build-types-ordered.mjs']);
  });

  it('ignores globs, flag values and package-local paths', () => {
    const root = makeRoot();
    mkdirSync(path.join(root, 'packages', 'alpha'), { recursive: true });
    writeFileSync(path.join(root, 'packages', 'alpha', 'tsdown.config.ts'), '');

    expect(
      extractScriptFileReferences(
        'pnpm --filter "./packages/**" build:js --ext .ts,.tsx --config packages/alpha/tsdown.config.ts',
        root,
      ),
    ).toEqual([]);
  });

  it('ignores a token that names no file on disk', () => {
    const root = makeRoot();
    expect(extractScriptFileReferences('node scripts/does-not-exist.mjs', root)).toEqual([]);
  });

  it('governs the verbs a scope is verified by', () => {
    for (const verb of ['build', 'typecheck', 'lint', 'test']) {
      expect(BUILD_DEFINING_ROOT_SCRIPTS).toContain(verb);
    }
  });
});

describe('findBuildToolingScopeFindings', () => {
  it('passes on a workspace whose declared tooling is live and wired', async () => {
    const result = await findBuildToolingScopeFindings(makeRoot(), {
      listScopes: listFixtureScopes,
    });

    expect(result.findings).toEqual([]);
    expect(result.scopeCount).toBe(2);
    expect(result.declaredCount).toBe(DECLARED.length);
    expect(result.referencesExamined).toBe(1);
  });

  it('R1: reports a declared path that no longer exists', async () => {
    const root = makeRoot();
    plan.WORKSPACE_WIDE_BUILD_TOOLING_PATHS.push('scripts/build-types-renamed.mjs');

    const result = await findBuildToolingScopeFindings(root, { listScopes: listFixtureScopes });

    expect(rules(result.findings)).toEqual(['R1']);
    expect(result.findings[0].detail).toContain('scripts/build-types-renamed.mjs');
  });

  it('R2: fires against a calculator that has stopped honouring the declared list', async () => {
    const root = makeRoot();
    // The pre-fix calculator exactly: path-prefix mapping only, no workspace-wide branch. It is
    // the shape the live red proof used (INFRA-060 D4), reproduced here per-rule.
    const preFixPlanner = ({ scopes, changedFiles }) => ({
      scopes: scopes.filter((scope) =>
        changedFiles.some((file) => file.startsWith(`${scope.relativeDir}/`)),
      ),
    });

    const result = await findBuildToolingScopeFindings(root, {
      planner: preFixPlanner,
      listScopes: listFixtureScopes,
    });

    expect(new Set(rules(result.findings))).toEqual(new Set(['R2']));
    expect(result.findings).toHaveLength(DECLARED.length);
    expect(result.findings[0].detail).toContain('resolves to 0 of 2 workspace scopes');
  });

  it('R2: passes on the real calculator for every declared path', async () => {
    const result = await findBuildToolingScopeFindings(makeRoot(), {
      listScopes: listFixtureScopes,
    });

    expect(result.findings).toEqual([]);
    expect(result.declaredCount).toBe(DECLARED.length);
  });

  it('R3: reports a file joining root build without joining the declared list', async () => {
    const root = makeRoot({
      buildScript: 'node scripts/build-types-ordered.mjs && node scripts/build-next-thing.mjs',
    });
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    writeFileSync(path.join(root, 'scripts', 'build-next-thing.mjs'), '');

    const result = await findBuildToolingScopeFindings(root, { listScopes: listFixtureScopes });

    expect(rules(result.findings)).toEqual(['R3']);
    expect(result.findings[0].detail).toContain('scripts/build-next-thing.mjs');
  });

  it('R4: reports over-correction that would redden documentation PRs', async () => {
    const root = makeRoot();
    plan.WORKSPACE_WIDE_BUILD_TOOLING_PATHS.push('README.md');
    writeFileSync(path.join(root, 'README.md'), '');

    const result = await findBuildToolingScopeFindings(root, { listScopes: listFixtureScopes });

    expect(rules(result.findings)).toEqual(['R4']);
    expect(result.findings[0].detail).toContain('must stay a pass');
  });

  it('reports zero counts rather than a pass when its subject is missing', async () => {
    const root = makeTemp('build-tooling-scope-bare-');
    temporaryRoots.push(root);
    writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    mkdirSync(path.join(root, 'packages'), { recursive: true });

    const result = await findBuildToolingScopeFindings(root, { listScopes: async () => [] });

    expect(result.scopeCount).toBe(0);
    expect(result.buildScriptCount).toBe(0);
    expect(result.referencesExamined).toBe(0);
  });

  it('main() refuses to print a pass when it enumerated nothing', async () => {
    const written = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalExitCode = process.exitCode;
    plan.WORKSPACE_WIDE_BUILD_TOOLING_PATHS.length = 0;

    process.stdout.write = (chunk) => {
      written.push(String(chunk));
      return true;
    };
    try {
      await main();
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(written.join('')).toContain('ZERO declared workspace-wide paths');
    expect(written.join('')).not.toContain('scan passed');
    expect(process.exitCode).toBe(1);
    process.exitCode = originalExitCode;
  });
});
