import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findDeclaredPinFindings,
  listWorkspaceManifests,
  readRootPin,
  readExaminedManifestCount,
  resolveManifestPin,
} from '../scan-node-version-single-valued.mjs';

/**
 * INFRA-102. The scan's job is to make "the Node version is single-valued" measurable.
 * These fixtures are the RED proof: each one is a tree that was silently accepted before
 * the scan existed, and the assertion is that it is now rejected with the specific reason.
 */

const roots = [];

function makeRoot(rootVolta) {
  const root = makeTemp('infra-102-');
  roots.push(root);
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'root', private: true, ...(rootVolta ? { volta: rootVolta } : {}) }),
  );
  return root;
}

function addPackage(root, name, manifest) {
  const dir = path.join(root, 'packages', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, ...manifest }));
  return path.posix.join('packages', name, 'package.json');
}

/** A package in a NESTED group, the shape `pnpm-workspace.yaml` declares as `packages/<g>/*`. */
function addNestedPackage(root, group, name, manifest) {
  const dir = path.join(root, 'packages', group, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, ...manifest }));
  return path.posix.join('packages', group, name, 'package.json');
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('node-version-single-valued — declared edge', () => {
  it('rejects a workspace manifest with no volta field, naming the fall-through', () => {
    const root = makeRoot({ node: '22.14.0' });
    addPackage(root, 'unpinned', {});

    const { findings, examined } = findDeclaredPinFindings(root);

    expect(examined).toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('packages/unpinned/package.json');
    expect(findings[0].problem).toMatch(/no `volta` field/);
  });

  it('rejects a volta.extends whose target does not exist', () => {
    const root = makeRoot({ node: '22.14.0' });
    addPackage(root, 'broken', { volta: { extends: '../../nope.json' } });

    const { findings } = findDeclaredPinFindings(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toMatch(/points at a missing file/);
  });

  it('rejects a second, disagreeing version literal', () => {
    const root = makeRoot({ node: '22.14.0' });
    addPackage(root, 'drifted', { volta: { node: '24.19.0' } });

    const { findings } = findDeclaredPinFindings(root);

    expect(findings).toHaveLength(1);
    expect(findings[0].problem).toMatch(/resolves to node 24\.19\.0.*root declares 22\.14\.0/);
  });

  it('accepts a manifest that inherits the pin through volta.extends', () => {
    const root = makeRoot({ node: '22.14.0' });
    addPackage(root, 'inherits', { volta: { extends: '../../package.json' } });

    const { findings, examined } = findDeclaredPinFindings(root);

    expect(findings).toEqual([]);
    expect(examined).toBe(1);
  });

  it('rejects a circular extends chain instead of recursing forever', () => {
    const root = makeRoot({ node: '22.14.0' });
    addPackage(root, 'a', { volta: { extends: '../b/package.json' } });
    addPackage(root, 'b', { volta: { extends: '../a/package.json' } });

    const { findings } = findDeclaredPinFindings(root);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => /circular/.test(f.problem))).toBe(true);
  });

  it('reports the size of what it examined, per the scan-reporting rule', () => {
    const root = makeRoot({ node: '22.14.0' });
    addPackage(root, 'one', { volta: { extends: '../../package.json' } });
    addPackage(root, 'two', { volta: { extends: '../../package.json' } });

    findDeclaredPinFindings(root);
    expect(readExaminedManifestCount(root)).toBe(2);

    // Again AFTER a second run of the finder: an accumulating counter would now read 4.
    findDeclaredPinFindings(root);
    expect(readExaminedManifestCount(root)).toBe(2);
  });

  it('fails closed when the root itself declares no pin', () => {
    const root = makeRoot(undefined);
    addPackage(root, 'anything', {});

    const { findings } = findDeclaredPinFindings(root);

    expect(findings[0].file).toBe('package.json');
    expect(findings[0].problem).toMatch(/declares no `volta.node` pin/);
  });
});

describe('node-version-single-valued — this repository', () => {
  it('every workspace manifest resolves to the root pin', () => {
    const { findings, examined, rootPin } = findDeclaredPinFindings();

    expect(rootPin).toBe(readRootPin());
    expect(examined).toBe(listWorkspaceManifests().length);
    expect(findings).toEqual([]);
  });

  it('resolves a real workspace manifest through extends to the root literal', () => {
    const [first] = listWorkspaceManifests();
    expect(resolveManifestPin(process.cwd(), first)).toEqual({ ok: true, version: readRootPin() });
  });
});

describe('the population includes the packages that were actually broken', () => {
  /**
   * The scan enumerated `packages/*` and `apps/*` one level deep, so a NESTED group — declared in
   * `pnpm-workspace.yaml` as `packages/<g>/*` — was outside the population entirely.
   *
   * MEASURED on this repository when it was found: `packages/dag-nodes/*` is twenty manifests, none
   * of them carried a pin, every one resolved to Node 24.19.0 against a root declaring 22.14.0, and
   * each has a `test` script — so `pnpm test` ran them on an undeclared runtime while this scan
   * reported the workspace single-valued over 67 of its 87 manifests.
   *
   * Red-proofed rather than reasoned about: restoring the one-level walk AND deleting a nested pin
   * makes the scan report PASSED over 67 manifests. A guard whose population excludes the failures
   * is a guard that cannot fire — the same shape as the defect the item is about, one level up.
   *
   * `workspace-packages.mjs` was written for exactly this class (INFRA-021) and this scan was a
   * twenty-first copy of it, which is why the fix is to delegate rather than to add a second glob.
   */
  it('sees an unpinned package in a NESTED group', () => {
    const root = makeRoot({ node: '22.14.0' });
    const nested = addNestedPackage(root, 'dag-nodes', 'file-read', { private: true });

    const { findings } = findDeclaredPinFindings(root);
    expect(findings.map((f) => f.file)).toContain(nested);
    expect(findings[0].problem).toMatch(/no `volta` field/);
  });

  it('counts a nested package in the size it declares', () => {
    const root = makeRoot({ node: '22.14.0' });
    addPackage(root, 'top-level', { volta: { extends: '../../package.json' } });
    addNestedPackage(root, 'dag-nodes', 'nested', { volta: { extends: '../../../package.json' } });

    // Two packages, two manifests. Under the one-level walk this was 1, and the scan called the
    // workspace single-valued on the strength of it.
    expect(listWorkspaceManifests(root)).toHaveLength(2);
    expect(readExaminedManifestCount(root)).toBe(2);
    expect(findDeclaredPinFindings(root).findings).toEqual([]);
  });

  it('resolves a nested package through its three-level extends', () => {
    const root = makeRoot({ node: '22.14.0' });
    const nested = addNestedPackage(root, 'dag-nodes', 'tool', {
      volta: { extends: '../../../package.json' },
    });

    expect(resolveManifestPin(root, nested)).toEqual({ ok: true, version: '22.14.0' });

    // The depth is the whole point, and it is the mistake a copy-paste makes: `../../`, correct for
    // a TOP-LEVEL package, resolves from a nested one to the GROUP directory, which has no
    // manifest. The first cut of this case mutated the manifest PATH instead of the extends target,
    // so it compared a package with itself and passed either way.
    const wrongDepth = addNestedPackage(root, 'dag-nodes', 'copied', {
      volta: { extends: '../../package.json' },
    });
    expect(resolveManifestPin(root, wrongDepth)).toMatchObject({ ok: false });
    expect(findDeclaredPinFindings(root).findings.map((f) => f.file)).toContain(wrongDepth);
  });
});
