import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  codeOnly,
  countScopeLiterals,
  findScopeLiteralFindings,
} from '../scan-harness-scope-literal.mjs';

/**
 * HARNESS-067 — a completed audit named NON-NEUTRALITY its dominant finding and prescribed the fix;
 * the sweep ran on 2026-07-24; an outside reader found the clearest possible instance still present
 * on 2026-08-02, with both idioms four lines apart in one file. A recurring mistake is not closed by
 * fixing the instance.
 *
 * The failure mode is what makes it worth a check: a hardcoded scope does not break when the scope
 * changes, it matches NOTHING — zero violations, reported as a pass. It is invisible in this
 * repository precisely because the hardcoded value happens to be right here.
 */
const dirs = [];
const SCOPE = '@acme/';

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scriptDir(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'scope-literal-'));
  dirs.push(root);
  const dir = path.join(root, 'scripts/harness');
  mkdirSync(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), contents);
  }
  return { root, dir };
}

describe('scan-harness-scope-literal', () => {
  describe('what counts as code', () => {
    it('(RED) a hardcoded scope in a string literal counts', () => {
      // A string is not an aside: an allowlist keyed by package name is exactly the thing that
      // should be composed from the configured prefix.
      expect(
        countScopeLiterals(scriptDir({ 'a.mjs': `const P = '@acme/core';` }).dir, SCOPE),
      ).toEqual({ 'a.mjs': 1 });
    });

    it('(RED) a hardcoded scope inside a regex literal counts', () => {
      // The exact shape the audit isolated: `/export \* from ['"](@acme\/…)/`.
      const { dir } = scriptDir({ 'a.mjs': String.raw`const re = /from '(@acme\/[^']+)'/;` });
      expect(countScopeLiterals(dir, SCOPE)['a.mjs']).toBe(1);
    });

    it('a scope named in a LINE comment does not count', () => {
      // A rule that governs `@acme/foo` has to be able to say so when explaining itself. Counting
      // prose would make this unlandable and get it suppressed rather than obeyed.
      expect(
        countScopeLiterals(scriptDir({ 'a.mjs': `// governs @acme/core` }).dir, SCOPE),
      ).toEqual({});
    });

    it('a scope named in a BLOCK comment does not count', () => {
      const { dir } = scriptDir({ 'a.mjs': `/**\n * @acme/core is the root package.\n */` });
      expect(countScopeLiterals(dir, SCOPE)).toEqual({});
    });

    it('reading the scope from config does not count — otherwise this is a blanket ban', () => {
      const { dir } = scriptDir({
        'a.mjs': `if (dep.startsWith(HARNESS.npmScopePrefix)) report();`,
      });
      expect(countScopeLiterals(dir, SCOPE)).toEqual({});
    });

    it('counts every occurrence, not every file', () => {
      const { dir } = scriptDir({ 'a.mjs': `const a='@acme/x', b='@acme/y';` });
      expect(countScopeLiterals(dir, SCOPE)['a.mjs']).toBe(2);
    });

    it('a `//` inside a URL is not a comment', () => {
      // The line-comment stripper must not eat the rest of a line after `https://…`.
      const { dir } = scriptDir({ 'a.mjs': `const u='https://x'; const p='@acme/core';` });
      expect(countScopeLiterals(dir, SCOPE)['a.mjs']).toBe(1);
    });

    it('codeOnly leaves code and removes only comments', () => {
      expect(codeOnly(`const a = 1; // @acme/x\nconst b = '@acme/y';`)).toContain('@acme/y');
      expect(codeOnly(`const a = 1; // @acme/x`)).not.toContain('@acme/x');
    });
  });

  describe('fail-closed', () => {
    it('FAILS through the CLI when the config declares no scope', () => {
      // With no scope there is nothing to compare against, and a clean result would be a claim about
      // ground never examined. Exercised through the CLI rather than by passing `undefined` to the
      // function: a JS default parameter substitutes the live config for `undefined`, so that call
      // could never reach the check — the first version of this case asserted a throw that the API
      // cannot produce.
      const cwd = mkdtempSync(path.join(tmpdir(), 'scope-literal-config-'));
      dirs.push(cwd);
      mkdirSync(path.join(cwd, '.agents'), { recursive: true });
      writeFileSync(path.join(cwd, '.agents/harness.config.json'), JSON.stringify({}));

      const scan = path.resolve(import.meta.dirname, '../scan-harness-scope-literal.mjs');
      const result = spawnSync('node', [scan], { cwd, encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr + result.stdout).toMatch(/no `npmScopePrefix`/);
    });

    it('an empty scope string is rejected', () => {
      const { root } = scriptDir({ 'a.mjs': '' });
      expect(() => findScopeLiteralFindings(root, '')).toThrow(/no `npmScopePrefix`/);
    });

    it('throws when the script directory is absent', () => {
      const root = mkdtempSync(path.join(tmpdir(), 'scope-literal-bare-'));
      dirs.push(root);
      expect(() => findScopeLiteralFindings(root, SCOPE)).toThrow(/does not exist/);
    });
  });

  it('is registered, and the live baseline matches what it counts', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    expect(readFileSync(path.join(root, 'scripts/harness/run-all-scans.mjs'), 'utf8')).toContain(
      'scan-harness-scope-literal.mjs',
    );

    const { counts } = findScopeLiteralFindings(root);
    const frozen = JSON.parse(
      readFileSync(path.join(root, 'scripts/harness/scope-literal-baseline.json'), 'utf8'),
    );
    expect(counts).toEqual(frozen);
    // A pass over nothing is not a pass — this debt is real and its size is the point.
    expect(Object.keys(frozen).length).toBeGreaterThan(5);
  });

  it('the scan does not hardcode the scope it forbids', () => {
    // Otherwise it is an instance of what it checks. Verified by the baseline rather than by reading:
    // this file is absent from it, and a planted literal makes the scan report ITSELF.
    const root = path.resolve(import.meta.dirname, '../../..');
    const frozen = JSON.parse(
      readFileSync(path.join(root, 'scripts/harness/scope-literal-baseline.json'), 'utf8'),
    );
    expect(frozen['scan-harness-scope-literal.mjs']).toBeUndefined();
  });
});
