import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findPublishRegistryFindings,
  parseRegistry,
  readWorkspacePackages,
  workspaceGlobs,
} from '../scan-publish-registry.mjs';

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

/**
 * A throwaway workspace: a `pnpm-workspace.yaml`, a registry, and a set of manifests.
 *
 * The workspace file is part of the fixture because the scan derives its package roots from it rather
 * than hardcoding them — which is the whole point of the fix that made it read `packages/dag-nodes/*`.
 */
function workspace(registry, packages, globs = ['packages/*']) {
  const root = makeTemp('publish-registry-');
  dirs.push(root);
  mkdirSync(path.join(root, '.agents'), { recursive: true });
  writeFileSync(
    path.join(root, 'pnpm-workspace.yaml'),
    ['packages:', ...globs.map((glob) => `  - '${glob}'`), ''].join('\n'),
  );
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

    it('finds a package in a NESTED glob tier', () => {
      // `packages/dag-nodes/*` shape: one directory level deeper than `packages/*`. Twenty-two real
      // packages lived there and the first version of this scan could not see any of them.
      const root = workspace(REGISTRY, [{ name: '@a/pub', ...PUBLIC }], ['packages/*']);
      mkdirSync(path.join(root, 'packages/nested/deep'), { recursive: true });
      writeFileSync(
        path.join(root, 'packages/nested/deep/package.json'),
        JSON.stringify({ name: '@a/deep', ...PUBLIC }),
      );
      writeFileSync(
        path.join(root, 'pnpm-workspace.yaml'),
        "packages:\n  - 'packages/*'\n  - 'packages/nested/*'\n",
      );
      expect(rules(root)).toEqual(['unlisted-publishable']);
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

    it('rule 4 (RED): a peerDependency counts, because npm installs it', () => {
      // Review round 2. The rule CLAIMED "a dependency of any published package" while reading only
      // `dependencies`, so a private package added solely as a peer dep slipped past the one rule
      // whose purpose is to arbitrate exactly this.
      const root = workspace(
        [REGISTRY, '## Private Packages', '| `@a/internal` | reason |'].join('\n'),
        [
          { name: '@a/pub', peerDependencies: { '@a/internal': '*' }, ...PUBLIC },
          { name: '@a/internal', private: true },
        ],
      );
      expect(rules(root)).toEqual(['private-dependency-of-published']);
    });

    it('rule 4: a devDependency does NOT count, because it does not ship', () => {
      // A consumer never installs it, so a private dev-only dependency is not a broken install.
      // Counting it would make the rule fire on ordinary internal tooling and get it suppressed.
      const root = workspace(
        [REGISTRY, '## Private Packages', '| `@a/internal` | reason |'].join('\n'),
        [
          { name: '@a/pub', devDependencies: { '@a/internal': '*' }, ...PUBLIC },
          { name: '@a/internal', private: true },
        ],
      );
      expect(rules(root)).toEqual([]);
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
      const root = makeTemp('publish-registry-bare-');
      dirs.push(root);
      expect(() => findPublishRegistryFindings(root)).toThrow(/does not exist/);
    });

    it('throws when there are no manifests to check against', () => {
      const root = workspace('## Published Packages', []);
      expect(() => findPublishRegistryFindings(root)).toThrow(/no package manifests/);
    });

    it('throws when the workspace file declares no roots at all', () => {
      // No globs means no packages means nothing checked — an empty gate, not a clean one.
      const root = workspace('## Published Packages', [], []);
      expect(() => findPublishRegistryFindings(root)).toThrow(/no package manifests/);
    });
  });

  it('sees a NESTED workspace tier, not just one directory level', () => {
    // `packages/dag-nodes/*` is its own glob in `pnpm-workspace.yaml`. The first version hardcoded
    // `['packages', 'apps']` and read one level, so twenty-two packages were invisible to every rule
    // — and the count it produced was then used to "correct" the audit's figure downwards. The audit
    // was right; the instrument was wrong.
    const root = path.resolve(import.meta.dirname, '../../..');
    const names = readWorkspacePackages(root).map((pkg) => pkg.name);
    expect(names.filter((name) => name.includes('dag-node')).length).toBeGreaterThan(15);
  });

  it('excludes the tiers that are members but never publish', () => {
    // `examples/*` and `scratch` are workspace members only so pnpm links local source; treating
    // them as publishable would make rule 1 fire on every example.
    const root = path.resolve(import.meta.dirname, '../../..');
    expect(workspaceGlobs(root).some((glob) => glob.startsWith('examples'))).toBe(false);
    expect(workspaceGlobs(root)).toContain('packages/dag-nodes/*');
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
    // Not a loose floor. The number the scan reports must equal what an independent walk of the
    // workspace globs finds — `> 30` passed happily while a whole tier was missing.
    const examined = Number(/\((\d+) workspace package/.exec(output)?.[1] ?? '0');
    expect(examined).toBe(readWorkspacePackages(root).length);
  });
});
