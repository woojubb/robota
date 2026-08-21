#!/usr/bin/env node

/**
 * Issue #1965 — a task may not claim `done` while its own acceptance criteria sit unticked.
 *
 * WHY THIS IS NOT ALREADY COVERED. `unearned-done-claims` judges what a done record SAYS: an
 * evidence heading whose body cites nothing (U2), a named section reference that resolves to no
 * heading (U3), a TICKED box asserting "verified by …" with no citation after it (U4). Every rule is
 * about content that is PRESENT. None is about a criterion present and UNMET.
 *
 * `task-archival` is the nearest thing and misses from the other side: it fails "a fully-checked task
 * file whose spec never reached `spec-docs/done/`", so it keys on FULLY-checked and a partly-checked
 * one falls straight through.
 *
 * MEASURED, which is how the gap was found rather than reasoned about: four items were set to
 * `status: done` with a `completed:` date and moved to `completed/` — exactly what completing them
 * would do — and `unearned-done-claims`, `backlog-placement` and `task-archival` all PASSED. Nine
 * unticked criteria across three of them, including one reading "adversarial tests proving a PR
 * cannot replace its own required gate". The only failures came from inbound links breaking as the
 * files moved.
 *
 * That is the shape that costs most, because `status: done` is what the next reader trusts INSTEAD
 * of opening the file.
 *
 * WHY A BURN-DOWN AND NOT A FLOOR. Measured over `completed/`: 863 done files, 84 of them carrying
 * 386 unticked boxes. A hard floor is red on arrival, and a suite that is red on arrival is skipped
 * rather than fixed. The count is frozen and may FALL, never rise — the same shape
 * `reference-kind-qualified` and `named-artifact-resolves` already carry here.
 *
 * WHY ONLY SOME SECTIONS. Not every `- [ ]` is a claim. Of those 386, **174 are under `Test Plan`** —
 * a plan describes what would be run, and an unrun line there is not a false completion claim. The
 * headings that ARE claims were derived from the corpus rather than guessed; see `CRITERIA_HEADINGS`.
 * Scoping this way is what keeps the guard off correct records, which is the difference between a
 * floor people fix and one people delete.
 *
 * Exit code 0 = at or under the frozen count, 1 = above it, or the baseline is missing.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { asScalar, frontmatterObject } from './frontmatter.mjs';
import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const COMPLETED_DIR = '.agents/tasks/completed';
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/done-criteria-baseline.json');

/**
 * Headings whose checkboxes are a CLAIM about this item, not a plan.
 *
 * Derived by listing every heading that holds an unticked box across `completed/` and classifying
 * the result — 16 distinct headings, of which these are the ones asserting completion. `Test Plan`
 * and the numbered phase headings are deliberately absent: they describe intended work, and an
 * unticked line there does not assert that something was verified.
 */
export const CRITERIA_HEADINGS = [
  /^acceptance criteria$/i,
  /^acceptance$/i,
  /^completion criteria$/i,
  /^done gate$/i,
  /^overall done gate$/i,
  /^수용\s*기준$/,
  /^완료\s*기준$/,
  /^검증\s*항목$/,
];

const isCriteriaHeading = (heading) => CRITERIA_HEADINGS.some((re) => re.test(heading.trim()));

/** Unticked criteria in one task file, with the heading each sits under. */
export function unmetCriteriaIn(source) {
  // HARNESS-046: the status comes from the ONE frontmatter parser, not a per-line regex. A
  // hand-rolled `/^status:\s*done$/m` mis-reads a prettier-wrapped value and would also match a
  // `status:` line in the BODY — on a scan whose whole subject is what a `status: done` record
  // claims, reading that field wrongly is the defect one level down. Caught by
  // `frontmatter-parser-ssot` on the first run.
  if (asScalar(frontmatterObject(source).status) !== 'done') return [];
  const unmet = [];
  let heading = '';
  let inFence = false;
  for (const [index, line] of source.split('\n').entries()) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const isHeading = /^#{1,6}\s+(.*)$/.exec(line);
    if (isHeading) {
      heading = isHeading[1];
      continue;
    }
    if (!/^\s*- \[ \]/.test(line)) continue;
    if (!isCriteriaHeading(heading)) continue;
    unmet.push({ line: index + 1, heading: heading.trim(), text: line.trim().slice(0, 90) });
  }
  return unmet;
}

export function findUnmetCriteriaFindings(root = WORKSPACE_ROOT) {
  // HARNESS-052: the guard fails CLOSED. Measured before this line existed — pointed at a root with
  // no archive, the finder returned `{findings: [], examined: 0}`, which a caller reads as "no
  // unmet criteria" rather than "there was nothing to read". A scan whose subject is a claim nobody
  // re-checks must not itself report a pass over a population it never opened.
  requireGovernedTree(root, [COMPLETED_DIR], {
    scan: 'done-with-unmet-criteria',
    why: 'the claim is read from archived task files; with no archive there is nothing to judge and a pass would mean nothing',
  });
  const dir = path.join(root, COMPLETED_DIR);
  if (!existsSync(dir)) return { findings: [], examined: 0 };
  const findings = [];
  let examined = 0;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md') || name === 'README.md') continue;
    const source = readFileSync(path.join(dir, name), 'utf8');
    examined += 1;
    for (const unmet of unmetCriteriaIn(source)) {
      findings.push({ file: path.posix.join(COMPLETED_DIR, name), ...unmet });
    }
  }
  return { findings, examined };
}

/**
 * How many archived task files the last run opened — the size the pass line reports.
 *
 * Exported under the reader convention so a case can assert an EXACT value against a fixture of
 * known size. `measurement-provenance` requires this and is right to: the counter is the one output
 * that otherwise nothing reads, and a size no test can reach is a size that can be wrong by any
 * amount while the check still reads healthy.
 */
export function readExaminedArchiveCount(root = WORKSPACE_ROOT) {
  return findUnmetCriteriaFindings(root).examined;
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return undefined;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function main() {
  const { findings, examined } = findUnmetCriteriaFindings();
  const baseline = loadBaseline();

  if (baseline === undefined) {
    console.error('done-with-unmet-criteria: no frozen baseline — run --write-baseline.');
    process.exitCode = 1;
    return;
  }
  if (findings.length > baseline.unmet) {
    console.error(
      `done-with-unmet-criteria ROSE: ${findings.length} unticked criterion/criteria under a ` +
        `\`status: done\` record, up from a frozen ${baseline.unmet}. A done record is believed ` +
        'instead of re-read, so an unmet criterion under one is a claim nothing will re-check. ' +
        'Tick it, or take the item out of `done`.',
    );
    for (const f of findings.slice(0, 12)) {
      console.error(`  - ${f.file}:${f.line} [${f.heading}] ${f.text}`);
    }
    process.exitCode = 1;
    return;
  }
  if (findings.length < baseline.unmet) {
    console.error(
      `done-with-unmet-criteria FELL (${baseline.unmet} → ${findings.length}). Re-freeze it in the ` +
        'SAME change — --write-baseline — or the gain is a licence to grow back.',
    );
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examined} archived task file(s)`);
  console.log(
    `done-with-unmet-criteria scan passed (${examined} archived file(s); ${findings.length} ` +
      'unticked criterion/criteria at baseline — a burn-down, not a licence).',
  );
}

function writeBaseline() {
  const { findings } = findUnmetCriteriaFindings();
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ unmet: findings.length }, null, 2)}\n`);
  console.log(`done-with-unmet-criteria baseline frozen: ${findings.length}`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--write-baseline')) writeBaseline();
  else main();
}
