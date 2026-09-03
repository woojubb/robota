#!/usr/bin/env node

/**
 * Fixture floor for harness checks (HARNESS-098).
 *
 * A verification whose verdict is not a function of the condition it names is worse than no
 * verification: it moves a fact from `unverified` — a state someone might re-examine — to `verified`,
 * which nobody re-examines. The green is the damage.
 *
 * Three instances shipped in one session (the `latchThrew` observable that measured nothing, a
 * typecheck "proof" that could not catch the second re-declaration, an "rg finds zero" claim that was
 * one off), plus the mirror: a parser that cannot PASS on correctly-structured input (issue #1765).
 *
 * `lesson-to-harness` step 9 already requires running a new check against the pre-fix state and
 * confirming it FAILS. That step existed and those three still shipped, so the gap is not the rule's
 * absence — it is that nothing verifies the step was performed. This is that verification, at the
 * only altitude where it is exactly decidable:
 *
 *   Every `scripts/harness/{check,scan}-*.mjs` has a same-named fixture test in `__tests__/`.
 *
 * WHAT THIS DOES NOT CLAIM. Fixture EXISTENCE is not fixture QUALITY: a test file asserting only the
 * green path satisfies this floor and still leaves the check unfalsifiable. Detecting the red
 * direction textually was considered and rejected — a heuristic over assertion shapes would itself be
 * a check that cannot reliably fail, which is the defect this file exists to close, committed by the
 * file closing it. That prediction has since been measured: PR #2235 built exactly that heuristic and
 * needed three revisions in three review rounds, each defeated by a mutant the previous one could not
 * see (issue #2264). The both-directions half is NOT tracked under HARNESS-098 — that Task is closed
 * at this stage — but under its successor `.agents/tasks/HARNESS-101-*.md`, the live owner of the
 * mechanism's second stage. This floor is the exactly-decidable part, and it is stated as that.
 *
 * Baselined entries are pre-existing debt, ratcheted: a baselined check that GAINS a fixture is
 * removed from the baseline, and nothing may be added to it.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const HARNESS_DIR = path.join(WORKSPACE_ROOT, 'scripts/harness');
const TESTS_DIR = path.join(HARNESS_DIR, '__tests__');
const BASELINE = path.join(HARNESS_DIR, 'fixture-floor-baseline.json');

/** RESET per walk, so a run that reads nothing cannot report the previous run's number. */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

/** Every check/scan entry point the floor applies to. */
export function listCheckModules(harnessDir = HARNESS_DIR) {
  if (!existsSync(harnessDir)) return [];
  return readdirSync(harnessDir)
    .filter((f) => /^(check|scan)-.+\.mjs$/.test(f))
    .map((f) => f.replace(/\.mjs$/, ''))
    .sort();
}

/**
 * Decide the findings for one walk. Exported whole so the fixture test drives the real logic rather
 * than a re-implementation of it.
 */
export function findFixtureFloorFindings({ modules, hasFixture, baseline }) {
  examinedCount = modules.length;
  const findings = [];
  const baselineSet = new Set(baseline);

  for (const name of modules) {
    const covered = hasFixture(name);
    if (!covered && !baselineSet.has(name)) {
      findings.push(
        `${name}: no fixture test at scripts/harness/__tests__/${name}.test.mjs — a check with no fixture has never been shown to go red on the condition it names (HARNESS-098)`,
      );
    }
    if (covered && baselineSet.has(name)) {
      findings.push(
        `${name}: has a fixture test but is still baselined — remove it from fixture-floor-baseline.json so the gain is locked in`,
      );
    }
  }

  for (const name of baselineSet) {
    if (!modules.includes(name)) {
      findings.push(
        `${name}: baselined but no such check/scan exists — delete the stale baseline entry`,
      );
    }
  }

  return findings;
}

function readBaseline() {
  if (!existsSync(BASELINE)) return [];
  try {
    const parsed = JSON.parse(readFileSync(BASELINE, 'utf8'));
    return Array.isArray(parsed.baselined) ? parsed.baselined : [];
  } catch {
    // Fail closed: an unreadable baseline must not silently widen the floor to everything.
    throw new Error(
      `[fixture-floor] ${path.relative(WORKSPACE_ROOT, BASELINE)} is unreadable — refusing to run with an unknown baseline`,
    );
  }
}

function main() {
  const modules = listCheckModules();
  const findings = findFixtureFloorFindings({
    modules,
    hasFixture: (name) => existsSync(path.join(TESTS_DIR, `${name}.test.mjs`)),
    baseline: readBaseline(),
  });

  process.stdout.write(`::examined:: ${readExamined()} harness check/scan module(s)\n`);

  if (findings.length > 0) {
    process.stderr.write('❌ Fixture floor violations (HARNESS-098):\n\n');
    for (const f of findings) process.stderr.write(`  [fixture-floor] ${f}\n`);
    process.stderr.write(
      '\nAdd scripts/harness/__tests__/<name>.test.mjs asserting BOTH directions: the check goes red on the violation, and green on the conforming case.\n',
    );
    process.stdout.write(`fixture-floor summary: violations=${findings.length} result=FAIL\n`);
    process.exit(1);
  }

  process.stdout.write('✅ Fixture floor: every harness check/scan has a fixture test.\n');
  process.stdout.write('fixture-floor summary: violations=0 result=PASS\n');
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
