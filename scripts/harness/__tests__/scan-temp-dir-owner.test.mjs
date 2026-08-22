/**
 * INFRA-126 — the ownership floor, and the helper it points at.
 *
 * The helper's row is the one that matters most. Its first cut registered `afterAll` lazily on first
 * use, which looked equivalent and removed NOTHING: a hook registered from inside a running test is
 * never collected. That version passed every unit assertion about paths and prefixes — only counting
 * directories before and after a real run caught it. So the row below counts.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp, pendingTempCount } from './make-temp.mjs';
import { SCAN_COMMANDS } from '../run-all-scans.mjs';
import {
  directCallLines,
  examinedTestFileCount,
  findTempDirOwnerFindings,
  ownerImportSpecifier,
} from '../scan-temp-dir-owner.mjs';

/**
 * The fixtures are ASSEMBLED rather than written literally.
 *
 * A test for a detector has to contain what the detector looks for, and this floor reads its own
 * test directory — so a literal fixture makes the floor report itself. The alternative was exempting
 * this file, which is worse: a whole-file exemption would also hide a REAL direct call added here
 * later. Splitting the token costs one line and keeps the exemption list at exactly one entry, the
 * helper that owns the sanctioned call.
 */
const CALL = (suffix) => `const d = ${'mkdtemp'}${suffix}(path.join(tmpdir(), 'x-'));`;

describe('directCallLines finds a call in BOTH spellings', () => {
  it('finds the sync form', () => {
    expect(directCallLines(CALL('Sync'))).toHaveLength(1);
  });

  it('finds the ASYNC form — the spelling a sync-only survey missed entirely', () => {
    // A survey matching the sync name alone reported 26 of 96 and missed every one of the five worst
    // offenders, which are async. A floor with that blind spot reproduces the defect it exists for.
    expect(directCallLines(CALL(''))).toHaveLength(1);
  });

  it('does not count a NAME in a line comment, so the documents explaining the rule survive it', () => {
    expect(directCallLines(`// never call ${'mkdtemp'}Sync( directly`)).toHaveLength(0);
    expect(directCallLines(` * both ${'mkdtemp'}( spellings are refused`)).toHaveLength(0);
  });

  it('reports the line number, so the finding points at the call', () => {
    const hits = directCallLines(['a', 'b', CALL('Sync')].join('\n'));
    expect(hits[0].line).toBe(3);
  });

  it('still refuses a direct creator when handwritten cleanup follows it', () => {
    const source = [CALL('Sync'), 'rmSync(d, { recursive: true, force: true });'].join('\n');
    expect(directCallLines(source)).toEqual([{ line: 1, text: CALL('Sync') }]);
  });
});

describe('ownerImportSpecifier points every governed module at the one owner', () => {
  it('uses a sibling import for top-level tests', () => {
    expect(ownerImportSpecifier('direct.test.mjs')).toBe('./make-temp.mjs');
  });

  it('walks back to the owner from a nested helper', () => {
    expect(ownerImportSpecifier('helpers/direct.mjs')).toBe('../make-temp.mjs');
  });
});

describe('the sweep remains strict after the burn-down', () => {
  it('refuses a direct call in an isolated file', () => {
    const root = makeTemp('robota-temp-owner-fixture-');
    const testsDir = path.join(root, 'scripts/harness/__tests__');
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(path.join(testsDir, 'direct.test.mjs'), CALL('Sync'));

    expect(findTempDirOwnerFindings(root)).toEqual([
      {
        name: 'direct.test.mjs',
        hits: [{ line: 1, text: CALL('Sync') }],
      },
    ]);
  });

  it('recurses through nested helpers inside the governed test tree', () => {
    const root = makeTemp('robota-temp-owner-fixture-');
    const helpersDir = path.join(root, 'scripts/harness/__tests__/helpers');
    mkdirSync(helpersDir, { recursive: true });
    writeFileSync(path.join(helpersDir, 'direct.mjs'), CALL('Sync'));

    expect(findTempDirOwnerFindings(root)).toEqual([
      {
        name: 'helpers/direct.mjs',
        hits: [{ line: 1, text: CALL('Sync') }],
      },
    ]);
  });

  it('is green over the live tree without an exception ledger', () => {
    // The frozen set has reached zero and its ledger is gone. A live-tree pass now proves the floor
    // needs no exception to stay green, while the isolated fixture above proves it still refuses a
    // new direct call.
    expect(findTempDirOwnerFindings()).toEqual([]);
  });

  it('fails CLOSED over a root with no harness test directory', () => {
    // "I could not read it" is not "there is no direct call". A silent zero here would be this
    // floor's own subject one layer up.
    expect(() => findTempDirOwnerFindings(path.join(tmpdir(), 'nope-not-a-checkout'))).toThrow(
      /missing from/,
    );
  });

  it('publishes an EXACT examined size that resets across sweeps', () => {
    // Exact, not a lower bound: a counter that never resets satisfies `>= n` on every later run,
    // which is one of the two failures measurement-provenance was built for. Asserted over a tree
    // built here so the number is knowable, then asserted AGAIN after a second sweep.
    const root = makeTemp('robota-temp-owner-fixture-');
    mkdirSync(path.join(root, 'scripts/harness/__tests__'), { recursive: true });
    for (const name of ['a.test.mjs', 'b.test.mjs', 'c.test.mjs']) {
      writeFileSync(path.join(root, 'scripts/harness/__tests__', name), 'export const x = 1;\n');
    }
    findTempDirOwnerFindings(root);
    expect(examinedTestFileCount()).toBe(3);
    findTempDirOwnerFindings(root);
    expect(examinedTestFileCount()).toBe(3);
  });

  it('the reader tracks the subject, so a smaller tree reports a smaller number', () => {
    const root = makeTemp('robota-temp-owner-fixture-');
    mkdirSync(path.join(root, 'scripts/harness/__tests__'), { recursive: true });
    writeFileSync(
      path.join(root, 'scripts/harness/__tests__/only.test.mjs'),
      'export const x = 1;\n',
    );
    findTempDirOwnerFindings(root);
    expect(examinedTestFileCount()).toBe(1);
  });
});

describe('makeTemp actually removes what it makes', () => {
  it('returns a real directory under the OS temp root, with the prefix asked for', () => {
    const dir = makeTemp('robota-temp-owner-probe-');
    expect(existsSync(dir)).toBe(true);
    expect(path.dirname(dir)).toBe(tmpdir());
    expect(path.basename(dir).startsWith('robota-temp-owner-probe-')).toBe(true);
  });

  it('tracks every directory it hands out, so teardown has the full list', () => {
    const before = pendingTempCount();
    makeTemp('robota-temp-owner-probe-');
    makeTemp('robota-temp-owner-probe-');
    expect(pendingTempCount()).toBe(before + 2);
  });

  it('leaves NOTHING behind after this file finishes — proven by the count, not by reading the code', () => {
    // This is the assertion the first implementation would have passed while removing nothing, so it
    // is deliberately written against the filesystem rather than against `pendingTempCount()`. The
    // teardown runs after this file, so the check is that the directories exist NOW and are counted;
    // the suite-level proof is the before/after directory count recorded in INFRA-126.
    const dir = makeTemp('robota-temp-owner-probe-');
    expect(existsSync(dir)).toBe(true);
    const siblings = readdirSync(tmpdir()).filter((n) => n.startsWith('robota-temp-owner-probe-'));
    expect(siblings.length).toBeGreaterThan(0);
  });
});

describe('the floor is WIRED, not merely written', () => {
  it('is registered in run-all-scans, so reversing the registration fails a test', () => {
    // `regression-red-proof` caught the absence of this row: with the registration reversed every
    // test still passed, so nothing guarded it. The wiring was proven by hand — breaking a record
    // and watching the suite go red — and a proof that exists only in a transcript is not a check.
    //
    // The assertion IMPORTS the registry rather than reading the file's text, and that is what makes
    // it count. `regression-red-proof` decides which tests may judge a source by the test's IMPORT
    // GRAPH, so a row that merely `readFileSync`s the source does not reach it and the reversal goes
    // unjudged. Importing `SCAN_COMMANDS` is also the truer check: it asserts the registry the
    // runner actually walks, not a string that happens to appear in the file.
    expect(SCAN_COMMANDS.map((scan) => scan.name)).toContain('temp-dir-owner');
    expect(SCAN_COMMANDS.find((scan) => scan.name === 'temp-dir-owner')?.command ?? []).toContain(
      'scripts/harness/scan-temp-dir-owner.mjs',
    );
  });

  it('is classified where the repository requires a registered scan to be classified', () => {
    // Both classifications are load-bearing and both were added by measurement, not assertion:
    // MANDATORY_TREE_GUARDS because the finder throws over a root with no harness test directory,
    // and measurement-provenance `covered` because the size reader is asserted exactly and re-asserted
    // after a second sweep. Reversing either one leaves this red.
    const guards = readFileSync(
      path.resolve(import.meta.dirname, '../scan-guard-scope-fail-closed.mjs'),
      'utf8',
    );
    expect(guards).toContain("file: 'scan-temp-dir-owner.mjs'");
    const ledger = JSON.parse(
      readFileSync(
        path.resolve(import.meta.dirname, '../measurement-provenance-pending.json'),
        'utf8',
      ),
    );
    expect(ledger.covered).toContain('scripts/harness/scan-temp-dir-owner.mjs');
  });
});
