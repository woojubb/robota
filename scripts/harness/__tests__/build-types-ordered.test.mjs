import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { createBuildTypeTiers, findBuildTypePackages } from '../../build-types-ordered.mjs';

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

    // ARCH-103 added `agent-interface-execution` and made `agent-interface-transport` depend on it,
    // which lengthened the declaration chain by one link: 76 → 77 packages, 10 → 11 tiers, and every
    // package above transport moved down one. The order is what matters and it still holds —
    // agent-core (0) → agent-interface-execution (1) → agent-interface-transport (2) → … → agent-cli.
    expect(packages).toHaveLength(77);
    expect(tiers).toHaveLength(11);
    expect(tierByName.get('@robota-sdk/agent-interface-execution')).toBe(1);
    expect(tierByName.get('@robota-sdk/agent-interface-transport')).toBe(2);
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
