import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  createBuildTypeTiers,
  findBuildTypePackages,
  parseBuildTypeArgs,
  runBuildTypeTier,
  selectBuildTypePackages,
} from '../../build-types-ordered.mjs';

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

function packageInfo(name, manifest = {}) {
  return {
    name,
    dir: `/workspace/${name}`,
    manifest: {
      name,
      scripts: { 'build:types': 'tsdown --dts' },
      ...manifest,
    },
  };
}

describe('createBuildTypeTiers', () => {
  it('orders and deduplicates local prerequisites from every dependency field', () => {
    const packages = [
      packageInfo('@fixture/consumer', {
        dependencies: { '@fixture/a': 'workspace:*' },
        devDependencies: { '@fixture/b': 'workspace:*', '@fixture/a': 'workspace:*' },
        peerDependencies: { '@fixture/c': 'workspace:*' },
        optionalDependencies: { '@fixture/d': 'workspace:*' },
      }),
      packageInfo('@fixture/d'),
      packageInfo('@fixture/c'),
      packageInfo('@fixture/b'),
      packageInfo('@fixture/a'),
    ];

    const tiers = createBuildTypeTiers(packages);

    expect(tiers.map((tier) => tier.map((pkg) => pkg.name))).toEqual([
      ['@fixture/a', '@fixture/b', '@fixture/c', '@fixture/d'],
      ['@fixture/consumer'],
    ]);
    expect(tiers[1][0].deps).toEqual(['@fixture/a', '@fixture/b', '@fixture/c', '@fixture/d']);
  });

  it('ignores external and non-buildable names and reports cross-field cycles deterministically', () => {
    const cycle = [
      packageInfo('@fixture/b', {
        peerDependencies: { '@fixture/a': 'workspace:*', external: '^1.0.0' },
      }),
      packageInfo('@fixture/a', {
        optionalDependencies: {
          '@fixture/b': 'workspace:*',
          '@fixture/non-buildable': 'workspace:*',
        },
      }),
    ];

    const expected =
      'Circular dependencies detected:\n' +
      '  @fixture/a (waiting on: @fixture/b)\n' +
      '  @fixture/b (waiting on: @fixture/a)';

    expect(() => createBuildTypeTiers(cycle)).toThrow(expected);
    expect(() => createBuildTypeTiers([...cycle].reverse())).toThrow(expected);
  });

  it('produces the same sorted tiers for every discovery order', () => {
    const packages = [
      packageInfo('@fixture/c', { devDependencies: { '@fixture/a': 'workspace:*' } }),
      packageInfo('@fixture/b'),
      packageInfo('@fixture/a'),
    ];

    const names = (input) => createBuildTypeTiers(input).map((tier) => tier.map((pkg) => pkg.name));

    expect(names(packages)).toEqual([['@fixture/a', '@fixture/b'], ['@fixture/c']]);
    expect(names([...packages].reverse())).toEqual(names(packages));
  });

  it('covers the live declaration graph and keeps agent-cli after all local prerequisites', () => {
    const packages = findBuildTypePackages();
    const tiers = createBuildTypeTiers(packages);
    const tierByName = new Map(
      tiers.flatMap((tier, tierIndex) => tier.map((pkg) => [pkg.name, tierIndex])),
    );
    const cli = tiers.flat().find((pkg) => pkg.name === '@robota-sdk/agent-cli');

    // The COUNT changes on every contract-migration leaf under issue #2068 — each creates one owner
    // package — and is kept anyway, because it catches a package nobody meant to add. 76 before
    // ARCH-103, then 77, 78, 79, 80, and 81 after ARCH-107. One more if issue #2113 adds one.
    //
    // The ORDER mirrors the declared layers. agent-interface-transport sat at tier 3 rather than the 0
    // its four CONTRACT modules would allow, because its /testing subpath imported a session type:
    // build order sees the whole package, while a reader enumerating contract modules does not, and
    // that gap is what refuted ARCH-107's layer prediction. ARCH-108 moved the double to the package
    // that declares the contract it doubles, and the tier fell to 1 in the same change.
    //
    // Tier 1 rather than 0 because agent-core is tier 0 and transport still depends on it — this is
    // the build graph, not the interface-layer graph, and the two number different things. What makes
    // it corroboration is the DIRECTION and the cause: both fell to their floor from the same edge
    // removal, measured by tools that share no code. Had only one moved, that would be the finding.
    expect(packages).toHaveLength(81);
    expect(tiers).toHaveLength(11);
    expect(tierByName.get('@robota-sdk/agent-interface-analytics')).toBe(0);
    expect(tierByName.get('@robota-sdk/agent-interface-command')).toBe(1);
    expect(tierByName.get('@robota-sdk/agent-interface-execution')).toBe(1);
    expect(tierByName.get('@robota-sdk/agent-interface-session')).toBe(2);
    expect(tierByName.get('@robota-sdk/agent-interface-session-mobility')).toBe(3);
    expect(tierByName.get('@robota-sdk/agent-interface-transport')).toBe(1);
    expect(tierByName.get('@robota-sdk/agent-cli')).toBe(10);
    expect(cli).toBeDefined();
    for (const dependency of cli.deps) {
      expect(tierByName.get(dependency), dependency).toBeLessThan(
        tierByName.get('@robota-sdk/agent-cli'),
      );
    }
  });
});

describe('findBuildTypePackages', () => {
  it('discovers nested buildable packages and excludes workspaces without build:types', () => {
    const workspaceRoot = makeTemp('build-types-ordered-');
    temporaryRoots.push(workspaceRoot);
    const buildableDir = path.join(workspaceRoot, 'packages', 'nested', 'buildable');
    const skippedDir = path.join(workspaceRoot, 'packages', 'skipped');
    mkdirSync(buildableDir, { recursive: true });
    mkdirSync(skippedDir, { recursive: true });
    writeFileSync(
      path.join(buildableDir, 'package.json'),
      JSON.stringify({ name: '@fixture/buildable', scripts: { 'build:types': 'tsdown --dts' } }),
    );
    writeFileSync(
      path.join(skippedDir, 'package.json'),
      JSON.stringify({ name: '@fixture/skipped', scripts: { build: 'tsdown' } }),
    );

    expect(findBuildTypePackages(workspaceRoot).map((pkg) => pkg.name)).toEqual([
      '@fixture/buildable',
    ]);
  });
});

describe('selectBuildTypePackages', () => {
  it('includes the transitive build prerequisites of an explicit package set', () => {
    const packages = [
      packageInfo('@fixture/app', { dependencies: { '@fixture/middle': 'workspace:*' } }),
      packageInfo('@fixture/middle', { devDependencies: { '@fixture/base': 'workspace:*' } }),
      packageInfo('@fixture/base'),
      packageInfo('@fixture/unrelated'),
    ];

    expect(selectBuildTypePackages(packages, ['@fixture/app']).map((pkg) => pkg.name)).toEqual([
      '@fixture/app',
      '@fixture/base',
      '@fixture/middle',
    ]);
    expect(() => selectBuildTypePackages(packages, ['@fixture/missing'])).toThrow(
      'Unknown or non-buildable package(s): @fixture/missing',
    );
  });
});

describe('runBuildTypeTier', () => {
  it('bounds parallel work and renders captured logs in deterministic package order', async () => {
    const packages = [
      packageInfo('@fixture/c'),
      packageInfo('@fixture/a'),
      packageInfo('@fixture/b'),
    ];
    let active = 0;
    let maximumActive = 0;
    const output = [];

    await runBuildTypeTier(packages, {
      concurrency: 2,
      write: (value) => output.push(value),
      runPackage: async (pkg) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, pkg.name.endsWith('/a') ? 8 : 1));
        active -= 1;
        return { status: 0, signal: null, stdout: `${pkg.name} stdout`, stderr: '' };
      },
    });

    expect(maximumActive).toBe(2);
    expect(output.join('')).toMatch(
      /\[build:types\] @fixture\/a[\s\S]*\[build:types\] @fixture\/b[\s\S]*\[build:types\] @fixture\/c/,
    );
  });

  it('finishes the current tier, aggregates failures, and never starts a later tier itself', async () => {
    const attempted = [];

    await expect(
      runBuildTypeTier([packageInfo('@fixture/b'), packageInfo('@fixture/a')], {
        concurrency: 2,
        write: () => {},
        runPackage: async (pkg) => {
          attempted.push(pkg.name);
          return {
            status: pkg.name.endsWith('/a') ? 2 : 0,
            signal: null,
            stdout: '',
            stderr: '',
          };
        },
      }),
    ).rejects.toThrow('FAILED build:types: @fixture/a (exit 2)');
    expect(attempted.sort()).toEqual(['@fixture/a', '@fixture/b']);
  });
});

describe('parseBuildTypeArgs', () => {
  it('accepts repeated package filters and an explicit concurrency bound', () => {
    expect(
      parseBuildTypeArgs([
        '--package',
        '@fixture/a',
        '--package',
        '@fixture/b',
        '--concurrency',
        '3',
      ]),
    ).toEqual({ concurrency: 3, packageNames: ['@fixture/a', '@fixture/b'] });
  });
});
