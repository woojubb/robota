#!/usr/bin/env node

/**
 * Measurement-provenance floor — a self-reported size is evidence only if something checks it.
 *
 * A scan that prints `::examined::` is claiming its own coverage on the one channel the runner
 * reads. Nothing downstream re-derives that number, so an unchecked counter can miscount by any
 * amount in either direction and every consumer still reads a healthy scan. The two failures this
 * floor exists for are silent in exactly that way: a counter that never resets rises with every run
 * in the process, and a counter asserted by a lower bound is satisfied by every over-count.
 *
 * SUBJECT DERIVATION, spelled out because getting it from a name pattern is the defect this floor is
 * about, one level up. The subject set is every module REGISTERED in the runner whose source emits
 * `::examined::` — both halves read from the tree, neither hand-listed. A floor that recognised its
 * subjects by the shape of a reader's name would grant an exemption to anyone who spelled the reader
 * differently, and would report a clean pass over the modules it failed to recognise.
 *
 * For each subject this requires an exported reader and, for each reader, a sibling test that
 * asserts an EXACT numeric value and proves the counter resets — the cases of
 * [measurement-provenance.md](../../.agents/rules/measurement-provenance.md).
 *
 * THE CEILING, stated rather than implied. Most subjects do not meet this yet; they are recorded in
 * `measurement-provenance-pending.json` with the item that burns the list down. A pending entry is
 * not an exemption: every entry is RE-MEASURED on each run, and one that now passes is itself a
 * finding, so the list can only shrink. What this scan does NOT see: a module that reports a size
 * without the marker, and whether a counter that is asserted is incremented at the right place —
 * that one is judgement, and the rule states it as such.
 *
 * Usage: `node scripts/harness/scan-measurement-provenance.mjs`
 * Exit 0 = clean, 1 = blocking findings.
 *
 * fail-direction: refuse — an unreadable registry, or a tree with no declaring scan in it, THROWS
 * rather than reporting a clean pass over a population it could not derive.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const HARNESS_DIR = 'scripts/harness';
const REGISTRY = 'scripts/harness/run-all-scans.mjs';
const TESTS_DIR = 'scripts/harness/__tests__';
const PENDING_FILE = 'scripts/harness/measurement-provenance-pending.json';

/** The marker a scan prints to declare the size of what it walked. */
const DECLARATION = '::examined::';

/**
 * Both spellings the repository uses for a size reader. This does NOT decide what a subject is —
 * subjects come from the registry — so a module that spells its reader some third way is reported
 * as having none rather than quietly leaving the population.
 */
const READER_NAME = /^(?:examined[A-Za-z0-9_]*Count|readExamined[A-Za-z0-9_]*)$/;

/** The finder conventions of this harness: what a test calls to make the counter move. */
const FINDER_NAME = /^(?:find|collect|check|scan)[A-Za-z0-9_]*$/;

/**
 * Source with comments, string bodies and regular-expression bodies removed, positions otherwise
 * preserved so ordering comparisons stay meaningful. A commented-out call and a call quoted inside
 * a fixture are not calls, and a guard that counts them is satisfied by text that never runs.
 */
export function stripNonCode(source) {
  let out = '';
  let i = 0;
  let previousCode = '';
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // A `/` in a value position opens a regular expression; in an operand position it is division.
    if (c === '/' && /[(=,:[!&|?{};+\-*%<>~^]$/.test(previousCode)) {
      i++;
      let inClass = false;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '/' && !inClass) {
          i++;
          break;
        } else if (source[i] === '\n') break;
        i++;
      }
      out += '//';
      previousCode = '/';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === c) {
          i++;
          break;
        }
        i++;
      }
      out += c + c;
      previousCode = c;
      continue;
    }
    out += c;
    if (!/\s/.test(c)) previousCode = c;
    i++;
  }
  return out;
}

/**
 * Every case body in a test file. Split on the case opener rather than parsed, and the title is not
 * read at all: what a case is CALLED is not what it proves, and requiring a wording would fail
 * suites that already prove the property while passing one that only claims to.
 */
export function testCases(source) {
  const starts = [];
  const re = /\b(?:it|test)(?:\.[a-z]+)*\s*[(`]/g;
  let match;
  while ((match = re.exec(source)) !== null) starts.push(match.index);
  return starts.map((start, i) =>
    source.slice(start, i + 1 < starts.length ? starts[i + 1] : source.length),
  );
}

/** Positions of every call to `name` in already-stripped source. */
function callPositions(source, name) {
  const positions = [];
  const re = new RegExp(`\\b${name}\\s*\\(`, 'g');
  let match;
  while ((match = re.exec(source)) !== null) positions.push(match.index);
  return positions;
}

/**
 * Position of the first exact numeric assertion on `reader` at or after `from`, or -1. Scoped to the
 * statement the reader call sits in: a `.toBe(` further away belongs to a different assertion.
 * A reader call with no statement terminator after it counts as no assertion — the unbounded
 * fallback would let any distant literal satisfy this.
 */
function exactAssertionPosition(source, reader, from = 0) {
  for (const position of callPositions(source, reader)) {
    if (position < from) continue;
    const rest = source.slice(position);
    const end = rest.indexOf(';');
    if (end === -1) continue;
    if (/\.toBe\s*\(\s*\d+\s*\)/.test(rest.slice(0, end))) return position;
  }
  return -1;
}

/**
 * Whether some case proves the counter resets: a second run of a finder, and an exact assertion on
 * the counter positioned AFTER it. Order is the property — an assertion taken before the second run
 * describes the first run and holds whether or not the counter resets.
 */
function hasResetCase(testSource, reader, finders) {
  return testCases(testSource).some((body) => {
    for (const finder of finders) {
      const calls = callPositions(body, finder);
      if (calls.length < 2) continue;
      if (exactAssertionPosition(body, reader, calls[1]) !== -1) return true;
    }
    return false;
  });
}

/** Names a module exports, by every form this harness uses. */
export function exportedNames(source) {
  const names = new Set();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /export\s+(?:const|let|class)\s+([A-Za-z0-9_]+)/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(source)) !== null) names.add(match[1]);
  }
  const braces = /export\s*\{([^}]*)\}/g;
  let match;
  while ((match = braces.exec(source)) !== null) {
    for (const part of match[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  return [...names];
}

/** Scan modules the runner registers — the population the harness already mechanizes. */
function registeredModules(root) {
  const registryPath = path.join(root, REGISTRY);
  if (!existsSync(registryPath))
    throw new Error(
      `${REGISTRY} does not exist under ${root}. This scan derives its subjects from the registry ` +
        'and will not report a pass over a population it could not read.',
    );
  const source = readFileSync(registryPath, 'utf8');
  const rels = new Set();
  for (const match of source.matchAll(/'(scripts\/harness\/[A-Za-z0-9._/-]+\.mjs)'/g))
    rels.add(match[1]);
  return [...rels].sort();
}

/** The test file for a module, wherever under the test directory it sits. */
function testFileFor(root, moduleBase) {
  const testsDir = path.join(root, TESTS_DIR);
  if (!existsSync(testsDir)) return null;
  const wanted = new Set([`${moduleBase}.test.mjs`, `${moduleBase}.spec.mjs`]);
  const stack = [testsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (wanted.has(entry.name)) return full;
    }
  }
  return null;
}

function readPending(root) {
  const pendingPath = path.join(root, PENDING_FILE);
  if (!existsSync(pendingPath)) return { pending: [] };
  return JSON.parse(readFileSync(pendingPath, 'utf8'));
}

let examinedSubjects = 0;
let examinedReaders = 0;
let pendingSubjects = 0;

/** How many declaring scan modules the last run derived and opened. */
export function examinedSubjectCount() {
  return examinedSubjects;
}

/** How many size readers those subjects export. */
export function examinedReaderCount() {
  return examinedReaders;
}

/** How many of those subjects are recorded unmet rather than meeting the floor. */
export function pendingSubjectCount() {
  return pendingSubjects;
}

/** Findings for one subject, before the pending ledger is applied. */
function judgeSubject(root, rel, source) {
  const findings = [];
  const at = (type, detail, reader) => findings.push({ type, module: rel, reader, detail });
  const names = exportedNames(source);
  const readers = names.filter((name) => READER_NAME.test(name));
  const finders = names.filter((name) => FINDER_NAME.test(name) && !READER_NAME.test(name));
  examinedReaders += readers.length;

  if (readers.length === 0) {
    at(
      'no-exported-size-reader',
      'declares a size no test can read — the counter is not exported',
      '-',
    );
    return findings;
  }

  const base = path.basename(rel, '.mjs');
  const testPath = testFileFor(root, base);
  if (testPath === null) {
    for (const reader of readers)
      at(
        'missing-counter-test',
        `no test file for ${base} — the reported size is checked by nothing`,
        reader,
      );
    return findings;
  }

  const testSource = stripNonCode(readFileSync(testPath, 'utf8'));
  const testRel = path.relative(root, testPath);
  for (const reader of readers) {
    if (exactAssertionPosition(testSource, reader) === -1)
      at(
        'no-exact-count-assertion',
        `${testRel} never asserts it against an exact numeric value`,
        reader,
      );
    if (finders.length === 0)
      at('no-exported-finder', `${rel} exports nothing a test can run to move the counter`, reader);
    else if (!hasResetCase(testSource, reader, finders))
      at(
        'no-reset-case',
        `${testRel} has no case asserting it after a SECOND run of the finder`,
        reader,
      );
  }
  return findings;
}

export function findMeasurementProvenanceFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  examinedSubjects = 0;
  examinedReaders = 0;
  pendingSubjects = 0;

  const pending = new Set(readPending(root).pending ?? []);
  const stillPending = new Set();

  for (const rel of registeredModules(root)) {
    const modulePath = path.join(root, rel);
    if (!existsSync(modulePath)) continue;
    const source = readFileSync(modulePath, 'utf8');
    if (!source.includes(DECLARATION)) continue;
    examinedSubjects++;

    const subjectFindings = judgeSubject(root, rel, source);
    if (!pending.has(rel)) {
      findings.push(...subjectFindings);
      continue;
    }
    // Re-measured, not trusted: a ledger nobody re-runs is a set of claims about the past presented
    // as facts about the present, and it can then only grow.
    if (subjectFindings.length === 0)
      findings.push({
        type: 'stale-pending-entry',
        module: rel,
        reader: '-',
        detail: `meets the floor now — remove it from ${PENDING_FILE}`,
      });
    else stillPending.add(rel);
  }

  for (const rel of pending)
    if (!stillPending.has(rel) && !findings.some((f) => f.module === rel))
      findings.push({
        type: 'stale-pending-entry',
        module: rel,
        reader: '-',
        detail: `is not a declaring registered scan — remove it from ${PENDING_FILE}`,
      });

  if (examinedSubjects === 0)
    throw new Error(
      `No registered scan under ${HARNESS_DIR} declares ${DECLARATION}. A tree with no subject is ` +
        'a broken checkout, not a compliant one — this scan will not report a pass over it.',
    );

  pendingSubjects = stillPending.size;
  return findings;
}

function main() {
  const findings = findMeasurementProvenanceFindings();
  if (findings.length === 0) {
    // Two subjects, two numbers: a single figure over both would absorb whichever walk collapsed.
    console.log(`::examined:: ${examinedSubjects} declaring scans`);
    console.log(`::examined:: ${examinedReaders} exported size readers`);
    console.log(
      `measurement-provenance scan passed (${examinedSubjects - pendingSubjects} subject(s) meet the ` +
        `floor; ${pendingSubjects} recorded unmet in ${PENDING_FILE}). A pass is not a claim that every declared ` +
        'size is checked.',
    );
    process.exit(0);
  }
  console.error('measurement-provenance scan FAILED — a self-reported size nothing checks:');
  for (const f of findings) console.error(`  [${f.type}] ${f.module} ${f.reader}: ${f.detail}`);
  console.error(
    '\nA counter is an output and is tested as one — see .agents/rules/measurement-provenance.md:\n' +
      '  - export the counter so a test can read it;\n' +
      '  - assert an EXACT numeric value against a fixture of known size (a bound admits over-counts);\n' +
      '  - assert it again AFTER a second run of the finder, so an accumulating counter is told apart\n' +
      '    from a growing subject.',
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
