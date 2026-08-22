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
 * ## The completed burn-down
 *
 * The direct-call ledger reached zero under INFRA-126 and was removed. There is no exception path
 * left: every governed test file is now judged by the same rule, and any direct call is refused.
 *
 * Exit 0 = no direct call, 1 = findings.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const TESTS_RELATIVE = 'scripts/harness/__tests__';

/** The helper itself is the sanctioned creator, so its own call is the one legitimate direct one. */
const OWNER_FILE = 'make-temp.mjs';

/** Both spellings, as a call. A mention in prose or a comment is not a call. */
const DIRECT_CALL = /\bmkdtemp(?:Sync)?\s*\(/;

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

/** Return the owner import path relative to one governed module. */
export function ownerImportSpecifier(moduleName) {
  const relative = path.posix.relative(path.posix.dirname(moduleName), OWNER_FILE);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** Enumerate the complete governed tree without following symlinks. */
function listModuleFiles(directory, relative = '') {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listModuleFiles(absolute, name));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push({ absolute, name });
  }
  return files;
}

export function findTempDirOwnerFindings(root = WORKSPACE_ROOT) {
  examinedFiles = 0;
  const dir = path.join(root, TESTS_RELATIVE);
  if (!existsSync(dir)) throw new Error(`${TESTS_RELATIVE} missing from ${root}`);

  const findings = [];
  for (const { absolute, name } of listModuleFiles(dir)) {
    if (name === OWNER_FILE) continue;
    examinedFiles += 1;
    const hits = directCallLines(readFileSync(absolute, 'utf8'));
    if (hits.length === 0) continue;
    findings.push({ name, hits });
  }
  return findings;
}

export function main() {
  let findings;
  try {
    findings = findTempDirOwnerFindings();
  } catch (error) {
    process.stdout.write('::examined:: 0 harness test modules\n');
    process.stderr.write(
      `temp-dir-owner scan FAILED — ${error.message}, so nothing was read. A pass over a directory ` +
        'that is not there is a pass over nothing.\n',
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`::examined:: ${examinedTestFileCount()} harness test modules\n`);

  if (findings.length === 0) {
    process.stdout.write('temp-dir-owner scan passed (no direct mkdtemp call).\n');
    return;
  }

  process.stdout.write('temp-dir-owner scan failed:\n');
  for (const f of findings) {
    for (const h of f.hits) {
      process.stdout.write(`  ${TESTS_RELATIVE}/${f.name}:${h.line}  ${h.text}\n`);
    }
    process.stdout.write(`    import { makeTemp } from '${ownerImportSpecifier(f.name)}';\n`);
  }
  process.stdout.write(
    "\nUse `makeTemp('robota-<scan>-')` from the file-specific owner path printed above. It owns\n" +
      'creation and removal together. A direct call is refused even when the file cleans up: the\n' +
      'rule is who creates the\n' +
      'directory, not whether this file happens to remove it. Do not introduce an exception ledger.\n',
  );
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
