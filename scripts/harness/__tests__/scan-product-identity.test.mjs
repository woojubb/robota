import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  countMarkers,
  examinedPackageCount,
  findProductIdentity,
} from '../scan-product-identity.mjs';

/**
 * NEUT-009 — four library packages write the consumer product's directory names, config file names
 * and default agent name, and no neutrality scan covered any of them. `scan-composition-neutrality`
 * checks a different property (the assembler's purity) over two packages that were already clean.
 *
 * The ratchet counts PROSE as well as code, deliberately, and several cases below pin that: a
 * library whose comments teach the product's layout is coupled to it just as firmly. That decision
 * demonstrated itself immediately — the comment written to explain removing the product name from a
 * temp-file marker quoted the name, and the count did not fall until the comment was reworded.
 */
const dirs = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MARKERS = ['.robota', 'robota-cli'];

function workspace(files) {
  const root = makeTemp('product-identity-');
  dirs.push(root);
  for (const [relative, contents] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function count(files, packages = ['packages/lib']) {
  return findProductIdentity(workspace(files), { markers: MARKERS, packages }).counts;
}

describe('scan-product-identity', () => {
  describe('counting', () => {
    it('counts a marker in a string literal', () => {
      expect(countMarkers(`const p = join(home, '.robota');`, MARKERS)).toHaveLength(1);
    });

    it('counts a marker in a COMMENT', () => {
      // The decision this scan turns on. A library whose docstring says it owns the product's layout
      // is coupled to that product, and counting only literals would make the docstring the cheapest
      // place to keep the coupling.
      expect(countMarkers(`// runtime data lives under .robota/`, MARKERS)).toHaveLength(1);
    });

    it('counts every occurrence on one line, not the line', () => {
      expect(countMarkers(`a('.robota'); b('.robota');`, MARKERS)).toHaveLength(2);
    });

    it('counts each configured marker independently', () => {
      expect(countMarkers(`const name = 'robota-cli'; // under .robota`, MARKERS)).toHaveLength(2);
    });

    it('reports the line, so a finding can point at the site', () => {
      const hits = countMarkers(['const a = 1;', `const b = '.robota';`].join('\n'), MARKERS);
      expect(hits[0]?.line).toBe(2);
    });

    it('finds nothing in a file that names no product', () => {
      expect(countMarkers(`const p = join(home, configDir);`, MARKERS)).toEqual([]);
    });
  });

  describe('over a package', () => {
    it('(RED) counts a library that names the product', () => {
      expect(count({ 'packages/lib/src/a.ts': `join(home, '.robota', 'settings.json')` })).toEqual({
        'packages/lib': 1,
      });
    });

    it('does NOT count tests — a test may name the product it tests', () => {
      const files = {
        'packages/lib/src/a.ts': 'export const x = 1;',
        'packages/lib/src/a.test.ts': `expect(p).toBe('.robota');`,
        'packages/lib/src/__tests__/b.ts': `expect(p).toBe('.robota');`,
      };
      expect(count(files)).toEqual({ 'packages/lib': 0 });
    });

    it('does not count build output', () => {
      const files = {
        'packages/lib/src/a.ts': 'export const x = 1;',
        'packages/lib/src/dist/a.js': `join(home, '.robota')`,
      };
      expect(count(files)).toEqual({ 'packages/lib': 0 });
    });

    it('a clean library scores zero and is then protected outright', () => {
      expect(count({ 'packages/lib/src/a.ts': 'export const x = 1;' })).toEqual({
        'packages/lib': 0,
      });
    });
  });

  describe('fail-closed', () => {
    it('throws when a configured package has no src/', () => {
      // A configured package that moved is a stale config, and a stale config reporting a pass is
      // this scan's own subject one level up.
      const root = workspace({ 'packages/other/src/a.ts': 'export const x = 1;' });
      expect(() =>
        findProductIdentity(root, { markers: MARKERS, packages: ['packages/lib'] }),
      ).toThrow(/does not exist/);
    });

    it('REJECTS overlapping markers rather than double-counting', () => {
      // `.robota` is a substring of `~/.robota`, so every line with the latter scored two
      // "product name" occurrences for one mention and the frozen numbers were inflated by 16.
      // Caught in review. The ratchet stayed monotonic, but the count is what this scan reports.
      const root = workspace({ 'packages/lib/src/a.ts': `'~/.robota'` });
      expect(() =>
        findProductIdentity(root, {
          markers: ['.robota', '~/.robota'],
          packages: ['packages/lib'],
        }),
      ).toThrow(/overlap/);
    });

    it('REJECTS an exactly duplicated marker too', () => {
      // The first overlap check compared by value (`other !== marker`), so an identical duplicate
      // slipped through and every occurrence doubled — a guard against duplication with a hole for
      // the most literal kind of it. Comparing by index closes that.
      const root = workspace({ 'packages/lib/src/a.ts': `'.robota'` });
      expect(() =>
        findProductIdentity(root, { markers: ['.robota', '.robota'], packages: ['packages/lib'] }),
      ).toThrow(/overlap/);
    });

    it('examines nothing, and says so, when no markers are configured', () => {
      const root = workspace({ 'packages/lib/src/a.ts': `'.robota'` });
      expect(findProductIdentity(root, { markers: [], packages: ['packages/lib'] }).counts).toEqual(
        {},
      );
    });
  });

  it('an emptied config FAILS rather than passing quietly', () => {
    // The scan exempted itself from the rule the guard-scope floor enforces on every other guard:
    // "nothing to check" is not "clean". An emptied config is how a floor disappears unnoticed.
    //
    // `loadHarnessConfig` reads `<cwd>/.agents/harness.config.json`, so running the real scan from a
    // temp cwd holding an emptied config exercises the CLI path rather than a helper — the emptiness
    // check short-circuits before any package is read, which is why the temp root needs no packages.
    const cwd = makeTemp('product-identity-config-');
    dirs.push(cwd);
    mkdirSync(path.join(cwd, '.agents'), { recursive: true });
    writeFileSync(
      path.join(cwd, '.agents/harness.config.json'),
      JSON.stringify({ productIdentity: { markers: [], packages: [] } }),
    );

    const scan = path.resolve(import.meta.dirname, '../scan-product-identity.mjs');
    const result = spawnSync('node', [scan], { cwd, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/broken floor/);
  });

  it('refuses to FREEZE a baseline from an empty configuration', () => {
    // Review CONSIDER: `--write-baseline` lacked the guard `main()` has, so a mis-set config would
    // record `{}` as the floor. Self-correcting on the next run, but a scan whose subject is guards
    // with holes should not ship one.
    const cwd = makeTemp('product-identity-freeze-');
    dirs.push(cwd);
    mkdirSync(path.join(cwd, '.agents'), { recursive: true });
    writeFileSync(
      path.join(cwd, '.agents/harness.config.json'),
      JSON.stringify({ productIdentity: { markers: [], packages: [] } }),
    );

    const scan = path.resolve(import.meta.dirname, '../scan-product-identity.mjs');
    const result = spawnSync('node', [scan, '--write-baseline'], { cwd, encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).toMatch(/refusing to freeze/);
  });

  it('is registered, and its baseline matches what it counts on the live repository', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    expect(readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8')).toContain(
      'scan-product-identity.mjs',
    );

    const output = execFileSync('node', ['scripts/harness/scan-product-identity.mjs'], {
      cwd: root,
      encoding: 'utf8',
    });
    const frozen = JSON.parse(
      readFileSync(path.join(root, 'scripts/harness/product-identity-baseline.json'), 'utf8'),
    );
    const reported = Number(/(\d+) occurrence\(s\) at baseline/.exec(output)?.[1] ?? '-1');
    expect(reported).toBe(Object.values(frozen).reduce((sum, value) => sum + value, 0));
    // A pass over nothing is not a pass.
    expect(Object.keys(frozen).length).toBeGreaterThan(3);
  });

  it('the two packages that reached zero are frozen there', () => {
    // `agent-core` was already clean; `agent-tools` reached zero in the change that added this scan.
    // Pinning them means a new product name in either fails immediately rather than joining a debt.
    const root = path.resolve(import.meta.dirname, '../../..');
    const frozen = JSON.parse(
      readFileSync(path.join(root, 'scripts/harness/product-identity-baseline.json'), 'utf8'),
    );
    expect(frozen['packages/agent-core']).toBe(0);
    expect(frozen['packages/agent-tools']).toBe(0);
  });
});

describe('the examined-size counter comes from the walk (HARNESS-057)', () => {
  /**
   * `::examined::` reported `Object.keys(counts).length` at first — derived from the COLLECTION, so
   * a duplicated config entry would collapse into one key and the size would undercount what the
   * walk actually iterated. That is the same "the number must come from the walk" failure this PR
   * fixed one scan over and then repeated here in a subtler form. (#1684 review)
   */
  it('counts a DUPLICATED config entry as the extra iteration it really is', () => {
    const root = workspace({
      'packages/lib/src/index.ts': 'export const a = 1;\n',
    });

    findProductIdentity(root, { markers: MARKERS, packages: ['packages/lib', 'packages/lib'] });

    // `counts` holds ONE key for the two entries; the walk ran twice, and that is what is reported.
    expect(examinedPackageCount(), 'the count was taken from the collection, not the walk').toBe(2);
  });

  it('RESETS between runs', () => {
    const root = workspace({
      'packages/a/src/index.ts': 'export const a = 1;\n',
      'packages/b/src/index.ts': 'export const b = 2;\n',
    });

    findProductIdentity(root, { markers: MARKERS, packages: ['packages/a', 'packages/b'] });
    expect(examinedPackageCount()).toBe(2);

    findProductIdentity(root, { markers: MARKERS, packages: ['packages/a'] });

    expect(examinedPackageCount(), 'the count carried over from the previous run').toBe(1);
  });
});
