import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findPublishRegistryFindings, parseRegistry } from '../scan-publish-registry.mjs';

/**
 * The scan exists because the publishing gate was prose nobody read. On the live tree its first run
 * reported 24 real findings; the document has since been reconciled and the scan passes.
 *
 * Most of what follows pins the PARSER, because the parser is where this scan can go quietly wrong.
 * Its first version tested the heading for `published` before `private`, and this repository's own
 * private heading reads "Private Packages (must NOT be published)" — so the entire private table was
 * read as authorized, five correct entries were reported as violations, and every real disagreement
 * was missed. A gate that mis-reads its own subject is worse than no gate.
 */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway workspace: a registry plus a set of manifests. */
function workspace(registry, packages) {
  const root = mkdtempSync(path.join(tmpdir(), 'publish-registry-'));
  dirs.push(root);
  mkdirSync(path.join(root, '.agents'), { recursive: true });
  writeFileSync(path.join(root, '.agents/publish-registry.md'), registry);
  for (const pkg of packages) {
    const dir = path.join(root, 'packages', pkg.name.split('/').pop());
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  }
  return root;
}

const PUBLIC = { publishConfig: { access: 'public' } };

function rules(root) {
  return findPublishRegistryFindings(root).findings.map((f) => f.rule);
}

describe('scan-publish-registry', () => {
  describe('parsing', () => {
    it('does NOT read a private heading as a published one', () => {
      // The exact heading this repository uses. Testing for `published` first put every private row
      // in the published table.
      const parsed = parseRegistry(
        [
          '## Published Packages',
          '| `@a/one` | beta | x |',
          '## Private Packages (must NOT be published)',
          '| `@a/two` | reason |',
        ].join('\n'),
      );
      expect(parsed.published).toEqual(['@a/one']);
      expect(parsed.private).toEqual(['@a/two']);
    });

    it('ignores a package named in prose rather than in a table row', () => {
      // An authorization has to be a row someone added on purpose.
      const parsed = parseRegistry(
        ['## Published Packages', 'Note that `@a/mentioned` was considered.'].join('\n'),
      );
      expect(parsed.published).toEqual([]);
    });

    it('ignores the header separator row', () => {
      const parsed = parseRegistry(
        ['## Published Packages', '| Package | tag |', '| ------- | --- |'].join('\n'),
      );
      expect(parsed.published).toEqual([]);
    });
  });

  describe('the four rules', () => {
    const REGISTRY = ['## Published Packages', '| `@a/pub` | beta | x |'].join('\n');

    it('rule 1 (RED): a publishable package outside the registry fails', () => {
      const root = workspace(REGISTRY, [
        { name: '@a/pub', ...PUBLIC },
        { name: '@a/unlisted', ...PUBLIC },
      ]);
      expect(rules(root)).toEqual(['unlisted-publishable']);
    });

    it('rule 2 (RED): a registry entry that is not a package fails', () => {
      const root = workspace(REGISTRY + '\n| `@a/ghost` | beta | x |', [
        { name: '@a/pub', ...PUBLIC },
      ]);
      expect(rules(root)).toEqual(['phantom-entry']);
    });

    it('rule 3 (RED): a package in BOTH tables fails', () => {
      const root = workspace(
        [REGISTRY, '## Private Packages', '| `@a/pub` | reason |'].join('\n'),
        [{ name: '@a/pub', ...PUBLIC }],
      );
      expect(rules(root)).toContain('listed-twice');
    });

    it('rule 3 (RED): a published entry without public access fails', () => {
      // A scoped package defaults to restricted, so the publish would not be public.
      const root = workspace(REGISTRY, [{ name: '@a/pub' }]);
      expect(rules(root)).toEqual(['missing-public-access']);
    });

    it('rule 4 (RED): a Private package depended on by a published one fails', () => {
      // The rule that DECIDES rather than reports. Three manifests contradicted this repository's
      // Private table and the graph settled it: publishing the dependents would ship installs that
      // cannot resolve their own dependency.
      const root = workspace(
        [REGISTRY, '## Private Packages', '| `@a/internal` | reason |'].join('\n'),
        [
          { name: '@a/pub', dependencies: { '@a/internal': 'workspace:*' }, ...PUBLIC },
          { name: '@a/internal', private: true },
        ],
      );
      expect(rules(root)).toEqual(['private-dependency-of-published']);
    });

    it('an agreeing workspace produces nothing', () => {
      const root = workspace(
        [REGISTRY, '## Private Packages', '| `@a/internal` | reason |'].join('\n'),
        [
          { name: '@a/pub', ...PUBLIC },
          { name: '@a/internal', private: true },
        ],
      );
      expect(rules(root)).toEqual([]);
    });

    it('a private package with no registry entry is fine', () => {
      // The Private table records decisions, not an inventory; requiring every private package to be
      // listed would make the table noise and the rule suppressed.
      const root = workspace(REGISTRY, [
        { name: '@a/pub', ...PUBLIC },
        { name: '@a/quiet', private: true },
      ]);
      expect(rules(root)).toEqual([]);
    });
  });

  describe('fail-closed', () => {
    it('throws when the registry file is absent', () => {
      const root = mkdtempSync(path.join(tmpdir(), 'publish-registry-bare-'));
      dirs.push(root);
      expect(() => findPublishRegistryFindings(root)).toThrow(/does not exist/);
    });

    it('throws when there are no manifests to check against', () => {
      const root = workspace('## Published Packages', []);
      expect(() => findPublishRegistryFindings(root)).toThrow(/no package manifests/);
    });
  });

  it('is registered and passes on the live repository', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    expect(readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8')).toContain(
      'scan-publish-registry.mjs',
    );

    const output = execFileSync('node', ['scripts/harness/scan-publish-registry.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    // A pass over nothing is not a pass — assert the size it reports.
    const examined = Number(/\((\d+) workspace package/.exec(output)?.[1] ?? '0');
    expect(examined).toBeGreaterThan(30);
  });
});
