/**
 * HARNESS-052 — the guards that walked `packages/` one level deep.
 *
 * `pnpm-workspace.yaml` declares BOTH `packages/*` and `packages/dag-nodes/*`. A scan that
 * enumerates with a depth-1 `readdirSync('packages')` therefore covers 55 of the 75 packages that
 * exist, while its message goes on saying "every workspace package" / "each `packages/x/README.md`"
 * / "EVERY `packages/<name>/docs/SPEC.md`". That is the audit's second axis: the check runs, it can
 * fail, and the set it quantifies over is not the set it names.
 *
 * Each case below plants the exact defect the owning scan exists to catch inside a NESTED group
 * member of a fixture workspace, and asserts the scan sees it. Every one of them was red-proofed by
 * restoring the depth-1 enumerator in the scan under test and re-running: with the old walk each
 * assertion fails on an empty result — the finder answering "clean" about a package it never opened.
 *
 * Fixtures, not the live tree, so a case cannot go quietly green the day the real `dag-nodes` group
 * is renamed or emptied.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findDevDepOnlyRuntimeImports } from '../check-dep-kind.mjs';
import { checkWorkspacePackageNames } from '../check-dependency-direction.mjs';
import { findDesignDocFindings } from '../check-design-doc-completeness.mjs';
import { listReadmeFiles } from '../check-doc-examples.mjs';
import { findScannablePackages } from '../check-interface-imports.mjs';
import { findOrphanExportFindings } from '../check-orphan-exports.mjs';
import { findMemoryNeutralityFindings } from '../scan-memory-neutrality.mjs';

/** A fixture workspace whose only package is a NESTED group member — the set a depth-1 walk misses. */
async function nestedWorkspace(files, { manifest = { name: '@fixture/member' } } = {}) {
  const root = makeTemp('harness-052-nested-');
  const member = path.join(root, 'packages', 'group', 'member');
  mkdirSync(member, { recursive: true });
  writeFileSync(path.join(member, 'package.json'), JSON.stringify(manifest), 'utf8');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(member, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
  return { root, member };
}

describe('check-orphan-exports covers nested group members', () => {
  it('finds an orphan export inside packages/<group>/<member>/src', async () => {
    const { root } = await nestedWorkspace({
      'src/index.ts': "export { used } from './helpers.js';\n",
      'src/helpers.ts': 'export const used = 1;\nexport const neverReferenced = 2;\n',
      'src/orphan-home.ts': 'export const strandedSymbol = 3;\n',
    });
    const findings = await findOrphanExportFindings(root);
    expect(findings.map((f) => f.detail).join('\n')).toContain('strandedSymbol');
  });
});

describe('check-dep-kind covers nested group members', () => {
  it('finds a devDependency imported at runtime inside a nested member', async () => {
    // The rule tracks workspace-internal modules, so the fixture uses that prefix.
    const { root } = await nestedWorkspace(
      { 'src/index.ts': "import { helper } from '@robota-sdk/dev-only';\nhelper();\n" },
      {
        manifest: {
          name: '@fixture/member',
          devDependencies: { '@robota-sdk/dev-only': 'workspace:*' },
        },
      },
    );
    const { findings } = await findDevDepOnlyRuntimeImports(root);
    expect(findings.map((f) => f.module)).toContain('@robota-sdk/dev-only');
  });
});

describe('check-dependency-direction reads nested members’ SPECs', () => {
  it('flags a ghost package token in packages/<group>/<member>/docs/SPEC.md', async () => {
    const { root } = await nestedWorkspace({
      'docs/SPEC.md': '# SPEC\n\nDepends on @fixture/does-not-exist for routing.\n',
    });
    const violations = checkWorkspacePackageNames(
      root,
      new Set(['@fixture/member']),
      {},
      '@fixture/',
    );
    expect(violations.map((v) => v.token)).toContain('@fixture/does-not-exist');
  });
});

describe('scan-memory-neutrality covers nested group members', () => {
  it('finds a seeded memory corpus file inside a nested member', async () => {
    const { root } = await nestedWorkspace({ 'src/memory/MEMORY.md': '# seeded\n' });
    const findings = findMemoryNeutralityFindings(root);
    expect(findings.map((f) => f.kind)).toContain('seeded-memory-content');
  });

  /**
   * The other half of the same repair: an absent library tree was a PASS. A neutrality floor that
   * found no library has not found it neutral.
   */
  it('throws rather than passing when packages/ is absent entirely', async () => {
    const bare = makeTemp('harness-052-bare-');
    expect(() => findMemoryNeutralityFindings(bare)).toThrow(/missing/i);
  });
});

describe('check-doc-examples covers nested group members', () => {
  it('lists a nested member README, and keeps the group container README', async () => {
    const { root } = await nestedWorkspace({ 'README.md': '# member\n' });
    writeFileSync(path.join(root, 'packages', 'group', 'README.md'), '# group\n', 'utf8');
    const readmes = listReadmeFiles(root);
    expect(readmes).toContain('packages/group/member/README.md');
    // The container has no package.json, so only the depth-1 glob sees it: the repair is the UNION
    // of both, and dropping either silently trades one uncovered file for another.
    expect(readmes).toContain('packages/group/README.md');
  });
});

describe('check-design-doc-completeness covers nested group members', () => {
  it('validates a design doc written by a nested member', async () => {
    const { root } = await nestedWorkspace({
      'docs/design/store.md': '# Store\n\n## Context\n\nno other required section\n',
    });
    const { blocking, examined } = findDesignDocFindings(undefined, root);
    expect(examined).toBe(1);
    expect(blocking.map((f) => f.detail)).toContain('missing "## Test Approach" section');
  });
});

describe('check-interface-imports covers nested group members', () => {
  /**
   * Not root-parameterized (it closes over the workspace root), so this one asserts against the live
   * tree. Red-proofed the same way: with the depth-1 enumerator the nested list is empty.
   */
  it('includes packages/dag-nodes/* members in the scanned set', () => {
    const scanned = findScannablePackages().map((entry) => entry.dirName);
    expect(scanned.filter((name) => name.startsWith('packages/dag-nodes/')).length).toBeGreaterThan(
      0,
    );
  });
});
