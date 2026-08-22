#!/usr/bin/env node

/**
 * INFRA-106 — a `#N` in a tracked document says whether it is an issue or a pull request.
 *
 * The rule and every exemption live in `reference-kind.mjs`, which `commitlint.config.js` also uses.
 * This file is the tree-side consumer: which documents are in scope, and the ratchet.
 *
 * A RATCHET, not a flat gate. Measured before this was written: 2,500 references across 443 tracked
 * markdown files, 552 of them already qualified. A flat gate would be red on arrival across the
 * whole tree, and a check that is red on arrival gets suppressed rather than obeyed — this
 * repository has written that sentence into three separate scans and then had to live with it.
 * Per-file counts are frozen, may fall, and must never rise; a fall is re-frozen in the SAME change,
 * or the gain is a licence to grow back.
 *
 * Exit 0 = every file at or below its frozen count, 1 = otherwise.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { enumerateFiles } from './enumerate-files.mjs';
import { unqualifiedReferences } from './reference-kind.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/reference-kind-baseline.json');

/**
 * Markdown only, and only where a reference is PROSE a person reads.
 *
 * `CHANGELOG.md` is excluded because it is generated from commit subjects by the release tooling: a
 * finding there is not actionable by editing the file, and a ratchet over generated output measures
 * the generator's input twice.
 */
const EXCLUDED = [/(^|\/)CHANGELOG\.md$/, /(^|\/)node_modules\//];

/**
 * INFRA-121 — enumerated through the shared owner, which includes untracked-but-not-ignored files.
 *
 * This scan is where the false green was measured: a task document written and not yet staged passed
 * before `git add` and failed after, while the run printed a size and a pass. A writer checking their
 * own work is exactly who this scan is for, and that is the moment it could not see them.
 */
function trackedDocuments() {
  return existingDocuments(enumerateFiles(['*.md']), (entry) =>
    existsSync(path.join(WORKSPACE_ROOT, entry)),
  ).filter((entry) => !EXCLUDED.some((pattern) => pattern.test(entry)));
}

/** A tracked deletion remains in `git ls-files`; it is baseline drift, not a readable document. */
export function existingDocuments(documents, exists) {
  return documents.filter((entry) => exists(entry));
}

let examinedDocuments = 0;

/** How many tracked documents the last run opened. The size the pass line reports. */
export function examinedDocumentCount() {
  return examinedDocuments;
}

/**
 * Per-file counts and the findings behind them.
 *
 * The counter is RESET here rather than incremented from wherever it stood: a size that accumulates
 * across runs reads as a growing subject, which is the one way a declared measurement can be wrong
 * while every finding it reports is right.
 */
export function collectReferences(documents, readFile) {
  examinedDocuments = 0;
  const perFile = {};
  const findings = [];
  for (const file of documents) {
    examinedDocuments += 1;
    const found = unqualifiedReferences(readFile(file));
    perFile[file] = found.length;
    for (const one of found) findings.push({ file, ...one });
  }
  return { perFile, findings };
}

/**
 * The verdict over every file at once — both directions reported before it returns, so one run tells
 * an operator everything they must act on. Stopping at the first offender turns a sweep into a queue
 * of runs.
 */
export function compare(perFile, baseline) {
  const grew = [];
  const shrunk = [];
  const unfrozen = [];
  for (const [name, count] of Object.entries(perFile)) {
    const frozen = baseline[name];
    if (frozen === undefined) {
      if (count > 0) unfrozen.push({ name, count });
      continue;
    }
    if (count > frozen) grew.push({ name, count, frozen });
    if (count < frozen) shrunk.push({ name, count, frozen });
  }
  // A frozen file that has since been deleted or renamed is drift too: its row would otherwise sit in
  // the baseline forever, excusing a count nobody is measuring any more.
  const missing = Object.keys(baseline).filter((name) => perFile[name] === undefined);
  return {
    grew,
    shrunk,
    unfrozen,
    missing,
    ok: !grew.length && !shrunk.length && !unfrozen.length && !missing.length,
  };
}

function main() {
  const write = process.argv.includes('--write-baseline');
  const read = (file) => readFileSync(path.join(WORKSPACE_ROOT, file), 'utf8');
  const { perFile, findings } = collectReferences(trackedDocuments(), read);

  console.log(`::examined:: ${examinedDocumentCount()} tracked document(s)`);

  // Only files that carry at least one; a baseline row of 0 for every clean document in the tree
  // would be thousands of lines saying nothing, and a file's first reference is caught by the
  // `unfrozen` branch either way.
  const nonZero = Object.fromEntries(Object.entries(perFile).filter(([, count]) => count > 0));

  if (write) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(nonZero, null, 2)}\n`);
    const total = Object.values(nonZero).reduce((sum, n) => sum + n, 0);
    console.log(
      `reference-kind-qualified: froze ${total} reference(s) across ${Object.keys(nonZero).length} file(s).`,
    );
    return;
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error('reference-kind-qualified: no frozen baseline — run --write-baseline.');
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  // The FULL per-file map, not `nonZero`. A file whose count fell to zero is still in the tree, and
  // handing `compare` only the non-zero rows reported it as `missing` — "frozen, but no longer in
  // the tree" — which sends the reader looking for a deletion that never happened. Measured when a
  // fence-parsing fix took four files to zero at once.
  const verdict = compare(perFile, baseline);

  for (const { name, count, frozen } of verdict.grew) {
    console.error(
      `- [grew] ${name}: ${count} unqualified reference(s), up from a frozen ${frozen}. ` +
        'Write `issue #N` or `PR #N` — a bare `#N` does not say which it is.',
    );
    for (const f of findings.filter((one) => one.file === name)) {
      console.error(`    ${name}:${f.line}  #${f.number}  ${f.text}`);
    }
  }
  for (const { name, count, frozen } of verdict.shrunk) {
    console.error(
      `- [fell] ${name}: ${frozen} → ${count}. Re-freeze in the SAME change (--write-baseline), ` +
        'or the gain is a licence to grow back.',
    );
  }
  for (const { name, count } of verdict.unfrozen) {
    console.error(
      `- [unfrozen] ${name}: ${count} unqualified reference(s) in a file the baseline does not know. ` +
        'A new document starts at zero, or is frozen deliberately.',
    );
    for (const f of findings.filter((one) => one.file === name)) {
      console.error(`    ${name}:${f.line}  #${f.number}  ${f.text}`);
    }
  }
  for (const name of verdict.missing) {
    console.error(
      `- [missing] ${name}: frozen, but no longer in the tree. Drop the row (--write-baseline).`,
    );
  }

  if (!verdict.ok) {
    process.exitCode = 1;
    return;
  }
  const total = Object.values(nonZero).reduce((sum, n) => sum + n, 0);
  console.log(
    `reference-kind-qualified scan passed (${total} unqualified reference(s) at baseline across ` +
      `${Object.keys(nonZero).length} file(s)). It checks that a reference says WHICH it is, ` +
      'not that the kind it names is correct — deciding that needs a live GitHub read.',
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
