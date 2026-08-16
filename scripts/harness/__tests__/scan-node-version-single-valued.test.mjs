import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

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
  const root = mkdtempSync(path.join(tmpdir(), 'infra-102-'));
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
