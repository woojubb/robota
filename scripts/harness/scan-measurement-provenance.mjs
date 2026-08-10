#!/usr/bin/env node

/**
 * Measurement-provenance floor — a self-reported size is evidence only if something checks it.
 *
 * A scan that prints how much it examined is claiming its own coverage on the one channel the runner
 * reads. Nothing downstream re-derives that number, so an unchecked counter can miscount by any
 * amount in either direction and every consumer still reads a healthy scan. The two failures this
 * floor exists for are silent in exactly that way: a counter that never resets rises with every run
 * in the process, and a counter asserted by a lower bound is satisfied by every over-count.
 *
 * The subject is any harness module exporting a size reader (`examined…Count`). For each one this
 * requires a sibling test that asserts an EXACT numeric value and a case proving the counter resets
 * between runs — the two cases of [measurement-provenance.md](../../.agents/rules/measurement-provenance.md).
 *
 * Usage: `node scripts/harness/scan-measurement-provenance.mjs`
 * Exit 0 = clean, 1 = blocking findings.
 *
 * fail-direction: refuse — a harness directory with no size reader in it THROWS rather than
 * reporting a clean pass, because "no subjects" is a broken checkout, not a compliant tree.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Where the size readers live, and where their tests are expected. */
const HARNESS_DIR = 'scripts/harness';
const TESTS_DIR = 'scripts/harness/__tests__';

/**
 * Size readers a module exports. The name is the contract: a reader is what makes the count
 * assertable from a test, and a module that keeps its counter private publishes a number nothing
 * outside it can check.
 */
function exportedSizeReaders(source) {
  const readers = [];
  const re = /export\s+function\s+(examined[A-Za-z0-9_]*Count)\s*\(/g;
  let match;
  while ((match = re.exec(source)) !== null) readers.push(match[1]);
  return readers;
}

/**
 * Every `it(...)` case in a test file, as {title, body}. The body runs to the next case, which is
 * enough to tell whether the case that CLAIMS to prove the reset is the one that reads the counter —
 * a reset title over a body that never calls the reader proves nothing.
 */
function testCases(source) {
  const starts = [];
  const re = /\bit(?:\.each\s*\([\s\S]*?\))?\s*\(\s*(['"`])([\s\S]*?)\1/g;
  let match;
  while ((match = re.exec(source)) !== null) starts.push({ title: match[2], index: match.index });
  return starts.map((start, i) => ({
    title: start.title,
    body: source.slice(start.index, i + 1 < starts.length ? starts[i + 1].index : source.length),
  }));
}

/**
 * Whether the reader is asserted against an exact numeric literal SOMEWHERE in the file. Scoped to
 * the statement the reader call sits in — a `.toBe(` found further away belongs to a different
 * assertion, and accepting it would be the silent pass this floor is about. `toBeGreaterThan…` does
 * not match, which is the point: a bound admits every over-count.
 */
function hasExactCountAssertion(source, reader) {
  const re = new RegExp(`\\b${reader}\\s*\\(`, 'g');
  let match;
  while ((match = re.exec(source)) !== null) {
    const rest = source.slice(match.index);
    const end = rest.indexOf(';');
    const statement = end === -1 ? rest : rest.slice(0, end);
    if (/\.toBe\s*\(\s*\d+\s*\)/.test(statement)) return true;
  }
  return false;
}

/**
 * Everything the module exports that is not a size reader — its finders. Derived from the module
 * rather than named here, because the reset case is defined by what it RUNS.
 */
function exportedFinders(source) {
  const names = new Set();
  const re =
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(|export\s+const\s+([A-Za-z0-9_]+)\s*=/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const name = match[1] ?? match[2];
    if (!/^examined[A-Za-z0-9_]*Count$/.test(name)) names.add(name);
  }
  return [...names];
}

/** The argument text of every call to `fn` in this source, in order. */
function callArguments(source, fn) {
  const args = [];
  const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
  let match;
  while ((match = re.exec(source)) !== null) {
    const rest = source.slice(match.index + match[0].length);
    const close = rest.indexOf(')');
    args.push(close === -1 ? '' : rest.slice(0, close).trim());
  }
  return args;
}

/**
 * Whether some case proves the counter resets. Judged by SHAPE, not by the case's title: a run over
 * one input followed by a run over a DIFFERENT one, and then an exact assertion on the counter. A
 * title-matching check would demand a particular wording from tests that already prove the property,
 * and would pass one that only says it does — the failure this floor is about, one level up. The two
 * inputs must differ because a second fixture of the same size passes whether the counter resets or
 * not.
 */
function hasResetCase(source, reader, finders) {
  const readerCall = new RegExp(`\\b${reader}\\s*\\(`);
  return testCases(source).some(
    (c) =>
      readerCall.test(c.body) &&
      hasExactCountAssertion(c.body, reader) &&
      finders.some((fn) => new Set(callArguments(c.body, fn)).size >= 2),
  );
}

let examinedModules = 0;
let examinedReaders = 0;

/** How many harness modules the last walk opened. */
export function examinedModuleCount() {
  return examinedModules;
}

/** How many size readers the last walk found across those modules. */
export function examinedReaderCount() {
  return examinedReaders;
}

export function findMeasurementProvenanceFindings(root = WORKSPACE_ROOT) {
  const harnessDir = path.join(root, HARNESS_DIR);
  if (!existsSync(harnessDir))
    throw new Error(
      `${HARNESS_DIR} does not exist under ${root}. This scan will not report a pass over modules ` +
        'it could not read.',
    );

  const findings = [];
  examinedModules = 0;
  examinedReaders = 0;

  for (const entry of readdirSync(harnessDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue;
    examinedModules++;

    const source = readFileSync(path.join(harnessDir, entry.name), 'utf8');
    const readers = exportedSizeReaders(source);
    if (readers.length === 0) continue;
    const finders = exportedFinders(source);

    const testRel = path.join(TESTS_DIR, `${entry.name.replace(/\.mjs$/, '')}.test.mjs`);
    const testPath = path.join(root, testRel);
    const testSource = existsSync(testPath) ? readFileSync(testPath, 'utf8') : null;

    for (const reader of readers) {
      examinedReaders++;
      if (testSource === null) {
        findings.push({
          type: 'missing-counter-test',
          module: `${HARNESS_DIR}/${entry.name}`,
          reader,
          detail: `no ${testRel} — the reported size is checked by nothing`,
        });
        continue;
      }
      if (!hasExactCountAssertion(testSource, reader))
        findings.push({
          type: 'no-exact-count-assertion',
          module: `${HARNESS_DIR}/${entry.name}`,
          reader,
          detail: `${testRel} never asserts \`${reader}()\` against an exact numeric value`,
        });
      if (!hasResetCase(testSource, reader, finders))
        findings.push({
          type: 'no-reset-case',
          module: `${HARNESS_DIR}/${entry.name}`,
          reader,
          detail:
            `${testRel} has no case that runs the finder over two DIFFERENT inputs and then ` +
            `asserts \`${reader}()\` against an exact value`,
        });
    }
  }

  if (examinedReaders === 0)
    throw new Error(
      `No size reader found under ${HARNESS_DIR}. A tree with no subject is a broken checkout, ` +
        'not a compliant one — this scan will not report a pass over it.',
    );

  return findings;
}

function main() {
  const findings = findMeasurementProvenanceFindings();
  if (findings.length === 0) {
    // Two subjects, two numbers: a single figure over both would absorb whichever walk collapsed.
    console.log(`::examined:: ${examinedModules} harness modules`);
    console.log(`::examined:: ${examinedReaders} exported size readers`);
    console.log('measurement-provenance scan passed.');
    process.exit(0);
  }
  console.error('measurement-provenance scan FAILED — a self-reported size nothing checks:');
  for (const f of findings) console.error(`  [${f.type}] ${f.module} ${f.reader}: ${f.detail}`);
  console.error(
    '\nA counter is an output and is tested as one — see .agents/rules/measurement-provenance.md:\n' +
      '  - assert an EXACT numeric value against a fixture of known size (a bound admits over-counts);\n' +
      '  - in one case, run the finder over two DIFFERENT inputs and then assert the counter, so an\n' +
      '    accumulating counter is told apart from a growing subject.',
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
