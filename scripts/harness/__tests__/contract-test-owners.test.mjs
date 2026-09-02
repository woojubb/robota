import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  contractInputDomains,
  groupContractTestsByOwner,
  inferContractTestPrimaryOwner,
  ownerForRepositoryInput,
  selectionScopesForChangedPath,
  validateContractPrimaryOwner,
  validateContractPrimaryOwnerDirectory,
} from '../contract-test-owners.mjs';

function workspace() {
  const root = makeTemp('robota-contract-owners-');
  for (const directory of [
    'packages/alpha',
    'packages/beta',
    'packages/dag-nodes/file-read',
    'apps/console',
    'examples/capabilities/streaming',
  ]) {
    mkdirSync(path.join(root, directory), { recursive: true });
    writeFileSync(path.join(root, directory, 'package.json'), '{}\n');
  }
  return root;
}

describe('contract-test monorepo owners', () => {
  it('uses real workspace directory names and distinguishes broad domain inputs', () => {
    const root = workspace();
    expect(ownerForRepositoryInput(root, 'packages/alpha/src/**')).toBe('package:alpha');
    expect(ownerForRepositoryInput(root, 'packages/dag-nodes/file-read/src/index.ts')).toBe(
      'package:dag-nodes/file-read',
    );
    expect(ownerForRepositoryInput(root, 'apps/console/**')).toBe('app:console');
    expect(ownerForRepositoryInput(root, 'examples/capabilities/streaming/**')).toBe(
      'example:capabilities/streaming',
    );
    expect(ownerForRepositoryInput(root, 'packages/**')).toBe('workspace:packages');
  });

  it('resolves package changes to package, domain, and global scopes only', () => {
    const root = workspace();
    expect(selectionScopesForChangedPath(root, 'packages/alpha/src/index.ts')).toEqual([
      'package:alpha',
      'workspace:global',
      'workspace:packages',
    ]);
    expect(selectionScopesForChangedPath(root, 'packages/beta/src/index.ts')).not.toContain(
      'package:alpha',
    );
    expect(selectionScopesForChangedPath(root, 'unknown/place.txt')).toBeNull();
  });

  it('infers one primary owner and keeps additional input domains as metadata', () => {
    const root = workspace();
    expect(
      inferContractTestPrimaryOwner(root, {
        implementationInputs: ['scripts/harness/__tests__/alpha.test.mjs'],
        repositoryInputs: ['packages/alpha/**'],
      }),
    ).toBe('package:alpha');
    expect(
      inferContractTestPrimaryOwner(root, {
        implementationInputs: ['scripts/harness/__tests__/workspace.test.mjs'],
        repositoryInputs: ['packages/**', 'packages/alpha/**', 'package.json'],
      }),
    ).toBe('workspace:global');
    expect(
      inferContractTestPrimaryOwner(root, {
        implementationInputs: ['scripts/harness/__tests__/ambiguous.test.mjs'],
        repositoryInputs: ['packages/alpha/**', 'packages/beta/**'],
      }),
    ).toBe('workspace:global');
    expect(contractInputDomains(root, ['packages/alpha/**', 'docs/**'])).toEqual([
      'package:alpha',
      'workspace:docs',
    ]);
    expect(() => validateContractPrimaryOwner('', 'alpha')).toThrow('exactly one');
    expect(() => validateContractPrimaryOwner(['package:alpha'], 'alpha')).toThrow('exactly one');
    expect(() => validateContractPrimaryOwner('root', 'alpha')).toThrow('exactly one');
    expect(() => validateContractPrimaryOwnerDirectory(root, 'package:missing', 'alpha')).toThrow(
      'non-workspace',
    );
  });

  it('groups every test exactly once by primary owner', () => {
    const registry = [
      { test: 'z.test.mjs', primaryOwner: 'package:beta' },
      { test: 'a.test.mjs', primaryOwner: 'package:alpha' },
      { test: 'global.test.mjs', primaryOwner: 'workspace:global' },
    ];
    const groups = groupContractTestsByOwner(registry);
    expect(groups).toEqual([
      { owner: 'package:alpha', tests: ['a.test.mjs'] },
      { owner: 'package:beta', tests: ['z.test.mjs'] },
      { owner: 'workspace:global', tests: ['global.test.mjs'] },
    ]);
    expect(groups.flatMap(({ tests }) => tests).sort()).toEqual(
      registry.map(({ test }) => test).sort(),
    );
    expect(groupContractTestsByOwner([...registry].reverse(), ['z.test.mjs'])).toEqual([
      { owner: 'package:beta', tests: ['z.test.mjs'] },
    ]);
  });
});
