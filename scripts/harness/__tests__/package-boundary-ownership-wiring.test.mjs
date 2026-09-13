import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, it, vi } from 'vitest';

vi.mock('node:fs', async (importOriginal) => ({ ...(await importOriginal()) }));

import { discoverAdditionalScans } from '../discovery-loader.mjs';
import { MANDATORY_TREE_GUARDS } from '../scan-guard-scope-fail-closed.mjs';
import { findPackageBoundaryOwnershipFindings } from '../scan-package-boundary-ownership.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const file = 'scan-package-boundary-ownership.mjs';
const scanPath = `scripts/harness/${file}`;
const name = 'package-boundary-ownership';
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

afterEach(() => vi.restoreAllMocks());

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

function discoverOnlyBoundary(source) {
  const harnessDirectory = path.join(root, 'scripts/harness');
  const read = fs.readFileSync;
  vi.spyOn(fs, 'existsSync').mockImplementation((target) => target === harnessDirectory);
  vi.spyOn(fs, 'readdirSync').mockReturnValue([{ name: file, isFile: () => true }]);
  vi.spyOn(fs, 'readFileSync').mockImplementation((target, ...args) =>
    target === path.join(root, scanPath) ? source : read(target, ...args),
  );
  return discoverAdditionalScans({ root });
}

it('discovers the actual non-advisory boundary command without adding a legacy runner duplicate', async () => {
  const source = fs.readFileSync(path.join(root, scanPath), 'utf8');
  const runner = fs.readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8');
  expect(runner).not.toContain(`'${scanPath}'`);
  const scans = await discoverOnlyBoundary(source);
  expect(scans).toEqual([
    expect.objectContaining({ name, always: true, command: ['node', scanPath] }),
  ]);
  expect(scans[0].advisory).not.toBe(true);
});

it('refuses an in-memory removal of the same scan registration instead of silently omitting it', async () => {
  const source = fs.readFileSync(path.join(root, scanPath), 'utf8');
  const withoutRegistration = source.replace(
    /export\s+const\s+scanDefinition\s*=/u,
    'const removedDefinition =',
  );
  expect(withoutRegistration).not.toBe(source);
  await expect(discoverOnlyBoundary(withoutRegistration)).rejects.toThrow('without scanDefinition');
});
