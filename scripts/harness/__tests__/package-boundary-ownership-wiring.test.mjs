import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it, vi } from 'vitest';

import { SCAN_COMMANDS } from '../run-all-scans.mjs';
import { MANDATORY_TREE_GUARDS } from '../scan-guard-scope-fail-closed.mjs';
import { findPackageBoundaryOwnershipFindings } from '../scan-package-boundary-ownership.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const file = 'scan-package-boundary-ownership.mjs';
const scanPath = `scripts/harness/${file}`;
const name = 'package-boundary-ownership';
const readJson = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));

it('registers the boundary scan in both measurement ledgers without adding measurement debt', () => {
  expect(readJson('scripts/harness/examined-adoption-baseline.json').declaring).toContain(name);
  const ledger = readJson('scripts/harness/measurement-provenance-pending.json');
  expect(ledger.covered.filter((entry) => entry === scanPath)).toEqual([scanPath]);
  expect(ledger.pending).not.toContain(scanPath);
});

it('classifies the boundary finder as a mandatory policy-root guard', () => {
  expect(MANDATORY_TREE_GUARDS.filter((entry) => entry.file === file)).toEqual([
    expect.objectContaining({
      file,
      finder: 'findPackageBoundaryOwnershipFindings',
      tree: '.agents/package-boundaries.json',
      why: expect.any(String),
    }),
  ]);
});

it('refuses the missing governed policy with injected population and no Git enumeration', () => {
  const readFile = vi.fn((relative) => {
    throw new Error(`missing ${relative}`);
  });
  expect(() =>
    findPackageBoundaryOwnershipFindings('/in-memory', {
      graph: { packages: [] },
      inventory: { population: [], untrackedPopulation: [], files: new Set() },
      readFile,
    }),
  ).toThrow('missing .agents/package-boundaries.json');
  expect(readFile.mock.calls).toEqual([['.agents/package-boundaries.json']]);
});

it('registers the non-advisory boundary command exactly once in the canonical runner table', () => {
  const scans = SCAN_COMMANDS.filter((entry) => entry.name === name);
  expect(scans).toEqual([
    expect.objectContaining({
      name,
      command: ['node', scanPath],
      examines: expect.arrayContaining([
        '.agents/package-boundaries.json',
        'package.json',
        'pnpm-workspace.yaml',
        'packages/**',
        'apps/**',
      ]),
    }),
  ]);
  expect(scans[0].always).not.toBe(true);
  expect(scans[0].advisory).not.toBe(true);
});
