#!/usr/bin/env node

/**
 * Temp-directory ownership floor for harness tests (INFRA-126).
 *
 * The harness test suite exhausted `/tmp`'s INODES — 1048576 of 1048576, with 4.3G of space still
 * free — and every push from the host failed with `no space left on device`, an error naming the
 * wrong resource. 58,856 `robota-*` directories had accumulated at the top level of `/tmp`.
 *
 * Measured cause: 158 harness test files created temp directories and 85 never removed one. One run
 * of a single 42-test file left 41 behind, about one per case, and the suite runs on every push and
 * in CI across several sessions sharing a clone.
 *
 * ## What it refuses, and why it does not ask about teardown
 *
 * ANY direct `mkdtemp` or `mkdtempSync` under the harness test directory — including in a file that
 * cleans up correctly. That is the design, not an oversight.
 *
 * A teardown-conditional floor would have to decide whether a given directory is removed, and it
 * cannot see that: "this file contains `rmSync` somewhere" is not "this directory is removed". It
 * would also pass code that is correct but unsanctioned — six test files use a bare `mkdtempSync`
 * and do clean up properly — and a floor that waves those through teaches nothing about the rule it
 * enforces. Making the CALL SITE the subject keeps the question textual and exact, and it fixes the
 * denominator: the burn-down is every direct call, not only the ones that leak.
 *
 * ## Both spellings, deliberately
 *
 * `mkdtempSync` AND the async `mkdtemp` from `node:fs/promises`. This is the caveat the filing
 * insisted on, because it nearly produced the wrong answer twice: a survey matching the sync form
 * alone reports 26 of 96 (27%) and misses EVERY ONE of the five worst offenders, which are async. A
 * floor catching only the sync spelling would reproduce the defect it exists for.
 *
 * ## fail-direction
 *
 * refuse — a missing test directory is a finding, not a skip. A pass over a directory that is not
 * there is a pass over nothing, and this floor's whole subject is a check that reports health it
 * never established.
 *
 * ## The burn-down
 *
 * The files calling directly when this landed are frozen in `temp-dir-owner-baseline.json`, so the
 * floor lands green and only NEW direct calls are refused. The baseline may SHRINK and never grow:
 * migrate a file to `makeTemp()` and remove its name. Adding a name is not a fix.
 *
 * Exit 0 = no unfrozen direct call, 1 = findings.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const TESTS_RELATIVE = 'scripts/harness/__tests__';
const BASELINE_FILE = path.join(import.meta.dirname, 'temp-dir-owner-baseline.json');

/** The helper itself is the sanctioned creator, so its own call is the one legitimate direct one. */
const OWNER_FILE = 'make-temp.mjs';

/** Both spellings, as a call. A mention in prose or a comment is not a call. */
const DIRECT_CALL = /\bmkdtemp(?:Sync)?\s*\(/;

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return new Set();
  return new Set(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).frozen ?? []);
}

let examinedFiles = 0;

/** How many harness test files the last sweep read. */
export function examinedTestFileCount() {
  return examinedFiles;
}

/**
 * Lines in `text` that call `mkdtemp*` directly, ignoring line comments.
 *
 * Comment-stripping is line-level on purpose. This file's own header names both spellings, and so
 * does the helper's; a floor that counted a documented name as a call would refuse the documents
 * explaining it.
 */
export function directCallLines(text) {
  const hits = [];
  for (const [i, line] of text.split('\n').entries()) {
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
    if (DIRECT_CALL.test(code)) hits.push({ line: i + 1, text: line.trim().slice(0, 80) });
  }
  return hits;
}

export function findTempDirOwnerFindings(root = WORKSPACE_ROOT, baseline = loadBaseline()) {
  examinedFiles = 0;
  const dir = path.join(root, TESTS_RELATIVE);
  if (!existsSync(dir)) throw new Error(`${TESTS_RELATIVE} missing from ${root}`);

  const findings = [];
  for (const name of readdirSync(dir)
    .filter((f) => f.endsWith('.mjs'))
    .sort()) {
    if (name === OWNER_FILE) continue;
    examinedFiles += 1;
    const hits = directCallLines(readFileSync(path.join(dir, name), 'utf8'));
    if (hits.length === 0 || baseline.has(name)) continue;
    findings.push({ name, hits });
  }
  return findings;
}

export function main() {
  let findings;
  try {
    findings = findTempDirOwnerFindings();
  } catch (error) {
    process.stdout.write('::examined:: 0 harness test files\n');
    process.stderr.write(
      `temp-dir-owner scan FAILED — ${error.message}, so nothing was read. A pass over a directory ` +
        'that is not there is a pass over nothing.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`::examined:: ${examinedTestFileCount()} harness test files\n`);

  if (findings.length === 0) {
    process.stdout.write(
      'temp-dir-owner scan passed (no unfrozen direct mkdtemp call; the frozen set is a burn-down, ' +
        'not an exemption).\n',
    );
    return;
  }

  process.stdout.write('temp-dir-owner scan failed:\n');
  for (const f of findings) {
    for (const h of f.hits) {
      process.stdout.write(`  ${TESTS_RELATIVE}/${f.name}:${h.line}  ${h.text}\n`);
    }
  }
  process.stdout.write(
    "\nUse `makeTemp('robota-<scan>-')` from `./make-temp.mjs`, which owns creation and removal\n" +
      'together. A direct call is refused even when the file cleans up: the rule is who creates the\n' +
      'directory, not whether this file happens to remove it. Do NOT add the file to\n' +
      'temp-dir-owner-baseline.json — that set may only shrink.\n',
  );
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
