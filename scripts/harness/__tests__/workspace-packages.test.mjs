import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { listManifestPackageDirs, listPackageDirs } from '../workspace-packages.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

/**
 * The package directories `pnpm-workspace.yaml` DECLARES, derived from its `packages/**` patterns.
 *
 * Deliberately computed from the manifest rather than from the same recursion the module under test
 * uses — comparing an implementation against itself is the tautology this repository has been
 * auditing, and it would pass no matter what either side did.
 */
function declaredPackageDirs(root) {
  const yaml = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
  const patterns = [...yaml.matchAll(/^\s*-\s*'([^']+)'/gm)]
    .map((match) => match[1])
    .filter((pattern) => pattern.startsWith('packages/'));
  const dirs = new Set();
  for (const pattern of patterns) {
    const base = path.join(root, pattern.replace(/\/\*$/, ''));
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(base, entry.name);
      if (existsSync(path.join(full, 'package.json'))) dirs.add(path.normalize(full));
    }
  }
  return dirs;
}

/**
 * HARNESS-052. `workspace-packages.mjs` is the SSOT every nesting-aware harness scan enumerates
 * through, so a scan's coverage is exactly as correct as this module's. Its rule is a HEURISTIC — "a
 * depth-1 directory without the marker is a group container, recurse one level" — not a reading of
 * the workspace declaration, so the two can drift apart silently: a group nested two levels deep, or
 * a `packages/*` group removed from the manifest, would leave every consumer scan measuring a set
 * the workspace does not declare while still passing.
 *
 * That is the second axis of this audit: the check runs and can fail, but covers the wrong set. It
 * is precisely how `check-publish-safety` came to print "Checked prepublishOnly hooks on all
 * publishable packages" over 65 of the 76 that exist.
 */
describe('the SSOT enumerator agrees with the workspace declaration', () => {
  it('covers every package pnpm-workspace.yaml declares, and no more', () => {
    const declared = declaredPackageDirs(WORKSPACE_ROOT);
    const found = new Set(
      listManifestPackageDirs(WORKSPACE_ROOT).map((dir) => path.normalize(path.resolve(dir))),
    );
    const missing = [...declared].filter((dir) => !found.has(dir));
    const extra = [...found].filter((dir) => !declared.has(dir));

    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    // A non-trivial subject: an empty comparison would satisfy the assertion above vacuously.
    expect(declared.size).toBeGreaterThan(50);
  });

  it('includes the nested group members a depth-1 readdir omits', () => {
    const found = listManifestPackageDirs(WORKSPACE_ROOT).map((dir) => path.normalize(dir));
    const nested = found.filter((dir) => dir.includes(`packages${path.sep}dag-nodes${path.sep}`));
    expect(nested.length).toBeGreaterThan(0);
  });
});

describe('recursion depth', () => {
  it('finds a nested group member one level down', async () => {
    const root = makeTemp('robota-ws-pkgs-');
    mkdirSync(path.join(root, 'packages', 'group', 'member'), { recursive: true });
    writeFileSync(path.join(root, 'packages', 'group', 'member', 'package.json'), '{}', 'utf8');
    expect(listManifestPackageDirs(root)).toEqual([path.join(root, 'packages', 'group', 'member')]);
  });

  /**
   * The documented limit, asserted so it is a known boundary rather than a surprise: recursion stops
   * at one level. A group nested two deep is INVISIBLE to every scan built on this module.
   */
  it('does NOT find a member two levels down — the documented ceiling', async () => {
    const root = makeTemp('robota-ws-pkgs-deep-');
    mkdirSync(path.join(root, 'packages', 'a', 'b', 'member'), { recursive: true });
    writeFileSync(path.join(root, 'packages', 'a', 'b', 'member', 'package.json'), '{}', 'utf8');
    expect(listManifestPackageDirs(root)).toEqual([]);
  });

  it('treats a depth-1 directory carrying the marker as a package, not a container', async () => {
    const root = makeTemp('robota-ws-pkgs-flat-');
    mkdirSync(path.join(root, 'packages', 'flat', 'nested'), { recursive: true });
    writeFileSync(path.join(root, 'packages', 'flat', 'package.json'), '{}', 'utf8');
    writeFileSync(path.join(root, 'packages', 'flat', 'nested', 'package.json'), '{}', 'utf8');
    expect(listPackageDirs(root, (dir) => existsSync(path.join(dir, 'package.json')))).toEqual([
      path.join(root, 'packages', 'flat'),
    ]);
  });
});
