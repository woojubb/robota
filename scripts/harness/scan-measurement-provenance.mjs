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
 * about, one level up. The subject set is every module under the harness directory whose source
 * emits `::examined::` — read off the tree, not hand-listed and not gated on registration, because
 * registration is not what makes a published size evidence. A floor that recognised its subjects by
 * the shape of a reader's name would grant an exemption to anyone who spelled the reader
 * differently, and would report a clean pass over the modules it failed to recognise.
 *
 * For each subject this requires an exported reader and, for each reader, a test file of the same
 * base name under the harness test directory that asserts an EXACT numeric value and proves the
 * counter resets — the cases of
 * [measurement-provenance.md](../../.agents/rules/measurement-provenance.md).
 *
 * THE CEILING, stated rather than implied. Most subjects do not meet this yet. Every subject is
 * classified in `measurement-provenance-pending.json` as either `covered` or `pending`, and a
 * subject in neither is a finding — so a new declaring scan cannot enter unclassified. Both lists are
 * RE-MEASURED on each run: a pending entry that now passes is a finding, and a covered entry that
 * stops passing is a REGRESSION finding, which is what keeps the debt list from absorbing work that
 * used to be checked. What this scan does NOT see: a module that reports a size without the marker,
 * a module outside the harness directory or not written as `.mjs`, its OWN two ledger counts (which
 * the pass line prints and which no reader-name convention covers, so they are tested by choice
 * rather than by this floor), and whether a counter that is asserted is incremented at the right
 * place — that one is judgement, and the rule states it as such.
 *
 * Usage: `node scripts/harness/scan-measurement-provenance.mjs`
 * Exit 0 = clean, 1 = blocking findings.
 *
 * fail-direction: refuse — an absent harness directory, or a tree with no declaring module in it,
 * THROWS rather than reporting a clean pass over a population it could not derive.
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
 * Both spellings the repository uses for a size reader. This does NOT decide what a subject is, so a
 * module whose readers all spell it some third way is reported as having none rather than quietly
 * leaving the population. A module with one matching reader and one that does not match is judged on
 * the matching one only — the non-matching name is indistinguishable from any other export.
 */
const READER_NAME = /^(?:examined[A-Za-z0-9_]*Count|readExamined[A-Za-z0-9_]*)$/;

/**
 * The finder naming conventions of this harness. An export matching one of these is what a case is
 * allowed to run twice to prove the reset; whether that particular export is the one that moves the
 * counter is not decidable here, so a case running some other conforming export twice is accepted.
 */
const FINDER_NAME = /^(?:find|collect|check|scan)[A-Za-z0-9_]*$/;

/** Keywords after which a `/` opens a regular expression rather than dividing. */
const VALUE_POSITION_WORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'case',
  'in',
  'of',
  'do',
  'else',
  'yield',
  'await',
  'delete',
  'void',
  'new',
]);

/**
 * Source with comments, string bodies and regular-expression bodies removed. ORDER is preserved,
 * offsets are not — a comment is deleted outright and a string collapses — so a position from this
 * output compares against another position from it and against nothing else. A commented-out call
 * and a call quoted inside a fixture are not calls, and a guard that counts them is satisfied by
 * text that never runs.
 */
export function stripNonCode(source) {
  let out = '';
  let i = 0;
  let previousCode = '';
  // The last COMPLETE identifier. It has to survive the whitespace after it, or the keyword test
  // below can only fire on `return/x/` written with no space — which is to say never.
  let previousWord = '';
  let wordOpen = false;
  // Template nesting: `${…}` returns to code, and the code inside may open another template. A flat
  // reader treats the third backtick as an opener and leaks the region between it and the fourth
  // into the code stream — the one corruption of this function that can manufacture a call.
  const templateDepth = [];

  // `atOpener` distinguishes the two entries: starting ON the quote, and RESUMING a template after
  // its `${…}` closed, where the next character is already body and skipping it would swallow the
  // template's own terminator — and with it everything up to the next quote in the file.
  const closeString = (quote, atOpener = true) => {
    if (atOpener) i++;
    while (i < source.length) {
      if (source[i] === '\\') {
        i += 2;
        continue;
      }
      if (source[i] === quote) {
        i++;
        return;
      }
      if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
        i += 2;
        templateDepth.push(1);
        return;
      }
      i++;
    }
  };

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
    // Getting this wrong deletes code rather than inventing it, so the cost is a visible refusal.
    if (
      c === '/' &&
      (/[(=,:[!&|?{};+\-*%<>~^]$/.test(previousCode) ||
        previousCode === '' ||
        VALUE_POSITION_WORDS.has(previousWord))
    ) {
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
      previousWord = '';
      wordOpen = false;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      closeString(c);
      out += c + c;
      previousCode = c;
      previousWord = '';
      wordOpen = false;
      continue;
    }
    // Inside a `${…}` the braces are code; the closing one resumes the template that opened it.
    if (templateDepth.length > 0) {
      if (c === '{') templateDepth[templateDepth.length - 1]++;
      else if (c === '}') {
        templateDepth[templateDepth.length - 1]--;
        if (templateDepth[templateDepth.length - 1] === 0) {
          templateDepth.pop();
          i++;
          closeString('`', false);
          out += '``';
          previousCode = '`';
          previousWord = '';
          wordOpen = false;
          continue;
        }
      }
    }
    out += c;
    if (/[A-Za-z0-9_$]/.test(c)) {
      if (!wordOpen) previousWord = '';
      previousWord += c;
      wordOpen = true;
    } else {
      wordOpen = false;
      if (!/\s/.test(c)) previousWord = '';
    }
    if (!/\s/.test(c)) previousCode = c;
    i++;
  }
  return out;
}

/**
 * The text between one case opener and the next — not a parsed case body, so a chunk carries the
 * tail of its case plus whatever sits between it and the next opener. Titles are not read at all:
 * what a case is CALLED is not what it proves, and requiring a wording would fail suites that
 * already prove the property while passing one that only claims to.
 *
 * The opener must be at a statement position: `RE.test(x)` is a method call, and splitting on it
 * would cut a compliant case in half and red it.
 */
export function testCases(source) {
  const starts = [];
  const re = /(?<![.\w$])(?:it|test)(?:\.[a-z]+)*\s*[(`]/g;
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

/**
 * Names a module exports, by every form this harness uses. Callers pass source that has been through
 * `stripNonCode`, so an export declared inside a comment or a fixture string is not one.
 */
export function exportedNames(source) {
  const names = new Set();
  const patterns = [
    /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    /export\s+(?:const|let|var|class)\s+([A-Za-z0-9_]+)/g,
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

/**
 * Every module under the harness directory, except its tests. Recursive, because a helper one
 * directory down publishes a size on the same channel a top-level scan does. The runner is not
 * excluded: it consumes the marker to build its report AND publishes two sizes about its own work,
 * so exempting it would hide the most-read size in the harness.
 */
function harnessModules(root) {
  const harnessPath = path.join(root, HARNESS_DIR);
  if (!existsSync(harnessPath))
    throw new Error(
      `${HARNESS_DIR} does not exist under ${root}. This scan will not report a pass over a ` +
        'population it could not read.',
    );
  const rels = [];
  const stack = [harnessPath];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.mjs'))
        rels.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  return rels.sort();
}

/** The test file for a module, wherever under the test directory it sits. */
function testFileFor(root, moduleBase) {
  const testsDir = path.join(root, TESTS_DIR);
  if (!existsSync(testsDir)) return null;
  const wanted = new Set([`${moduleBase}.test.mjs`, `${moduleBase}.spec.mjs`]);
  const stack = [testsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (wanted.has(entry.name)) return full;
    }
  }
  return null;
}

function readLedger(root) {
  const ledgerPath = path.join(root, PENDING_FILE);
  if (!existsSync(ledgerPath)) return { covered: [], pending: [], duplicates: [] };
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  const covered = ledger.covered ?? [];
  const pending = ledger.pending ?? [];
  // A repeated entry makes the file's lengths disagree with the counts a run measures, which is the
  // one way the ledger can misdescribe itself without any subject being misjudged.
  // Within each list: an entry in BOTH lists is a different fault with its own finding, and folding
  // the two together would report the clearer one under the vaguer name.
  const duplicates = [];
  for (const list of [covered, pending]) {
    const seen = new Set();
    for (const rel of list) {
      if (seen.has(rel)) duplicates.push(rel);
      seen.add(rel);
    }
  }
  return { covered, pending, duplicates };
}

let examinedSubjects = 0;
let examinedReaders = 0;
let coveredSubjects = 0;
let pendingSubjects = 0;

/** How many declaring scan modules the last run derived and opened. */
export function examinedSubjectCount() {
  return examinedSubjects;
}

/** How many size readers those subjects export. */
export function examinedReaderCount() {
  return examinedReaders;
}

/** How many of those subjects met the floor on this run, counted where each was judged. */
export function coveredSubjectCount() {
  return coveredSubjects;
}

/**
 * How many of those subjects MEASURED as unmet on this run. On a clean run it equals the ledger's
 * pending list, because any disagreement between the two is itself a finding; on a failing run it
 * does not, and the pass line is the only place it is printed.
 */
export function pendingSubjectCount() {
  return pendingSubjects;
}

/** Findings for one subject, before the pending ledger is applied. */
function judgeSubject(root, rel, source) {
  const findings = [];
  const at = (type, detail, reader) => findings.push({ type, module: rel, reader, detail });
  const names = exportedNames(stripNonCode(source));
  const readers = names.filter((name) => READER_NAME.test(name));
  const finders = names.filter((name) => FINDER_NAME.test(name) && !READER_NAME.test(name));

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
    for (const reader of readers) {
      examinedReaders++;
      at(
        'missing-counter-test',
        `no test file for ${base} — the reported size is checked by nothing`,
        reader,
      );
    }
    return findings;
  }

  const testSource = stripNonCode(readFileSync(testPath, 'utf8'));
  const testRel = path.relative(root, testPath);
  for (const reader of readers) {
    // Counted HERE rather than as `readers.length`: a size read off a collection is the size of the
    // collection, which is clause 1 of the rule this module mechanizes.
    examinedReaders++;
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
  coveredSubjects = 0;
  pendingSubjects = 0;

  const ledger = readLedger(root);
  for (const rel of ledger.duplicates)
    findings.push({
      type: 'duplicate-ledger-entry',
      module: rel,
      reader: '-',
      detail: `is listed more than once in ${PENDING_FILE}`,
    });
  const covered = new Set(ledger.covered);
  const pending = new Set(ledger.pending);
  const seen = new Set();

  for (const rel of harnessModules(root)) {
    const source = readFileSync(path.join(root, rel), 'utf8');
    if (!source.includes(DECLARATION)) continue;
    examinedSubjects++;
    seen.add(rel);

    const subjectFindings = judgeSubject(root, rel, source);
    if (subjectFindings.length === 0) coveredSubjects++;
    else pendingSubjects++;

    // Every subject is classified, so a new declaring scan cannot enter without an answer, and a
    // subject that STOPS meeting the floor is a regression rather than a candidate for the debt list.
    if (covered.has(rel) && pending.has(rel))
      findings.push({
        type: 'ambiguous-classification',
        module: rel,
        reader: '-',
        detail: `is listed both covered and pending in ${PENDING_FILE}`,
      });
    else if (covered.has(rel)) findings.push(...subjectFindings);
    else if (pending.has(rel)) {
      // Re-measured, not trusted: a ledger nobody re-runs is a set of claims about the past
      // presented as facts about the present.
      if (subjectFindings.length === 0)
        findings.push({
          type: 'stale-pending-entry',
          module: rel,
          reader: '-',
          detail: `meets the floor now — move it to \`covered\` in ${PENDING_FILE}`,
        });
    } else
      findings.push({
        type: 'unclassified-subject',
        module: rel,
        reader: '-',
        detail: `declares a size but is in neither list of ${PENDING_FILE}`,
      });
  }

  for (const rel of [...covered, ...pending])
    if (!seen.has(rel))
      findings.push({
        type: 'stale-ledger-entry',
        module: rel,
        reader: '-',
        detail: `is not a declaring harness module — remove it from ${PENDING_FILE}`,
      });

  if (examinedSubjects === 0)
    throw new Error(
      `No module under ${HARNESS_DIR} declares ${DECLARATION}. A tree with no subject is ` +
        'a broken checkout, not a compliant one — this scan will not report a pass over it.',
    );

  return findings;
}

function main() {
  const findings = findMeasurementProvenanceFindings();
  if (findings.length === 0) {
    // Two subjects, two numbers: a single figure over both would absorb whichever walk collapsed.
    console.log(`::examined:: ${examinedSubjects} declaring scans`);
    console.log(`::examined:: ${examinedReaders} exported size readers`);
    console.log(
      `measurement-provenance scan passed (${coveredSubjects} subject(s) meet the floor; ` +
        `${pendingSubjects} recorded unmet in ${PENDING_FILE}). A pass is not a claim that every ` +
        'declared size is checked.',
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
