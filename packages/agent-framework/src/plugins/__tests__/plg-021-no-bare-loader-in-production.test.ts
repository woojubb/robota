/**
 * PLG-021 / issue #2025 — no production source may construct `BundlePluginLoader` directly.
 *
 * `host-bundle-plugin-loader.test.ts` proves the composition root honours the enablement map. It
 * cannot prove that anything USES the composition root, and that gap is the whole defect: the filter
 * inside the loader was correct the entire time, and every production site bypassed it by omitting
 * the map. A test suite that only exercises the factory would go green with all three sites reverted.
 *
 * So this asserts the reachability property instead: within `packages/` and `apps/` production
 * source, the only place that may call `new BundlePluginLoader(...)` is the composition root itself.
 * A new call site added anywhere else fails here, which is what stops the next omission rather than
 * repairing the three known ones.
 *
 * Two things this deliberately does NOT do:
 *
 * - It does not read the constructor's arity or arguments. "Passes two arguments" is satisfied by
 *   passing `{}`, which is the exact value that produced the defect.
 * - It does not scan tests. A test constructing the loader bare is legitimate — several exist to pin
 *   the default-enabled behaviour, and they are the reason that behaviour is known to be correct.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, it, expect } from 'vitest';

const WORKSPACE_ROOT = join(import.meta.dirname, '../../../../..');
const ROOTS = ['packages', 'apps'];
const COMPOSITION_ROOT = join(
  'packages',
  'agent-framework',
  'src',
  'plugins',
  'host-bundle-plugin-loader.ts',
);

/** Directory names that never hold production source. */
const NON_PRODUCTION_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__tests__',
  '__mocks__',
  '__fixtures__',
  'examples',
  '.turbo',
]);

function collectProductionSources(dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    // Never follow a symlink: in a pnpm workspace it reaches the dependency store.
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      if (!NON_PRODUCTION_DIRS.has(entry)) collectProductionSources(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    // Only `src/` is production. A new sibling directory has to earn inclusion rather than be
    // included until somebody notices.
    if (!full.split(sep).includes('src')) continue;
    out.push(full);
  }
}

describe('PLG-021: plugin enablement is not bypassable by construction', () => {
  it('only the composition root constructs BundlePluginLoader in production source', () => {
    const files: string[] = [];
    for (const root of ROOTS) collectProductionSources(join(WORKSPACE_ROOT, root), files);

    // Guard the corpus itself: a walk that finds nothing would pass this test while checking nothing.
    expect(files.length).toBeGreaterThan(500);

    const offenders = files
      .filter((file) => /new\s+BundlePluginLoader\s*\(/.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(WORKSPACE_ROOT, file))
      .filter((rel) => rel !== COMPOSITION_ROOT)
      .sort();

    expect(offenders).toEqual([]);
  });

  it('the composition root itself is in the scanned corpus', () => {
    // Without this, the exemption above could be excusing a file the walk never reaches, and the
    // first test would pass for the wrong reason.
    const files: string[] = [];
    for (const root of ROOTS) collectProductionSources(join(WORKSPACE_ROOT, root), files);
    const found = files.map((f) => relative(WORKSPACE_ROOT, f));

    expect(found).toContain(COMPOSITION_ROOT);
  });
});
