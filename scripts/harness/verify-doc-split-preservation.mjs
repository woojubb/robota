#!/usr/bin/env node
/**
 * verify-doc-split-preservation — prove that splitting one document into several lost nothing.
 *
 * When a SPEC is split into a SPEC plus `docs/design/*.md` (RULE-013's placement criterion), the
 * claim "nothing was lost, only relocated" is the one a reviewer cannot check by reading the diff:
 * a `git diff` of a reordered 1,900-line document is unreadable. This script checks it mechanically.
 *
 * Method: take the multiset of the source document's body lines at a base git ref, take the multiset
 * of body lines across the destination documents at the working tree, and report every line that
 * appears more times in the source than in the destinations.
 *
 * A body line is a non-blank line with its leading heading markers (`#`, `##`, …) stripped. Heading
 * markers are stripped because relocating a section legitimately changes its depth — a `## Foo` that
 * becomes `### Foo` is the same content. A heading whose TITLE disappears is still reported, which is
 * what makes a dissolved section visible rather than silent.
 *
 * This is deliberately NOT a scan in `pnpm harness:scan`: it needs a base ref that only the author of
 * a specific split knows. It is a criterion-verification tool, run once per split and quoted in the
 * evidence log.
 *
 * Usage:
 *   node scripts/harness/verify-doc-split-preservation.mjs \
 *     --ref <git-ref> --source <path> --target <path> [--target <path> …] [--allow-lost <title>]
 *
 * Exit 0 when every source body line survives (modulo `--allow-lost` titles), 1 otherwise.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export function collectBodyLines(text) {
  const counts = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^#{1,6}\s+/, '').trim();
    if (!line) continue;
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/**
 * The declared examined size: how many body lines of the source document were compared.
 * Exported so a test can assert its exact value against a fixture of known size
 * (measurement-provenance.md — a counter is an output and is tested as one).
 */
export function examinedBodyLineCount(text) {
  let total = 0;
  for (const n of collectBodyLines(text).values()) total += n;
  return total;
}

/** Lines present more often in `source` than in `destinations`, as [line, shortfall] pairs. */
export function findMissingLines(source, destinations) {
  const combined = new Map();
  for (const dest of destinations) {
    for (const [line, n] of dest) combined.set(line, (combined.get(line) ?? 0) + n);
  }
  const lost = [];
  for (const [line, n] of source) {
    const have = combined.get(line) ?? 0;
    if (have < n) lost.push([line, n - have]);
  }
  return lost;
}

function parseArgs(argv) {
  const out = { targets: [], allowLost: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--ref') ((out.ref = value), (i += 1));
    else if (flag === '--source') ((out.source = value), (i += 1));
    else if (flag === '--target') (out.targets.push(value), (i += 1));
    else if (flag === '--allow-lost') (out.allowLost.push(value), (i += 1));
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!out.ref || !out.source || out.targets.length === 0) {
    throw new Error('required: --ref <git-ref> --source <path> --target <path> [--target …]');
  }
  return out;
}

export function main(argv = process.argv) {
  const { ref, source, targets, allowLost } = parseArgs(argv);

  let before;
  try {
    before = execFileSync('git', ['show', `${ref}:${source}`], { encoding: 'utf8' });
  } catch (error) {
    // Fail closed: an unreadable base ref means the claim is unverified, not verified.
    console.error(`cannot read ${source} at ${ref}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const dests = [];
  for (const target of targets) {
    if (!existsSync(target)) {
      console.error(`target does not exist: ${target}`);
      process.exitCode = 1;
      return;
    }
    dests.push(collectBodyLines(readFileSync(target, 'utf8')));
  }

  const src = collectBodyLines(before);
  const allowed = new Set(allowLost);
  const lost = findMissingLines(src, dests).filter(([line]) => !allowed.has(line));

  const srcTotal = examinedBodyLineCount(before);
  console.log(
    `::examined:: ${srcTotal} distinct-counted body line(s) of ${source}@${ref} against ${targets.length} destination document(s)`,
  );

  if (lost.length > 0) {
    console.error(`doc-split preservation FAILED — ${lost.length} body line(s) lost:`);
    for (const [line, n] of lost.slice(0, 50)) {
      console.error(`  - (x${n}) ${line.length > 140 ? `${line.slice(0, 140)}…` : line}`);
    }
    if (lost.length > 50) console.error(`  … and ${lost.length - 50} more`);
    process.exitCode = 1;
    return;
  }

  const note = allowed.size > 0 ? ` (${allowed.size} title(s) explicitly allowed to dissolve)` : '';
  console.log(`doc-split preservation passed — no body line lost${note}.`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
