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
 * A split legitimately renames a heading, so some allowance is unavoidable. An UNCHECKED allowance is
 * the vacuous-green pattern in a new shape, though — a future author could whitelist a deleted contract
 * line and no artifact would show it. So allowances are not command-line flags: they live in a
 * committed JSON file, every entry needs a `reason`, and an entry that names a consequence is VERIFIED:
 *   - `survivesAs`         — the named replacement line must be present in a destination (a rename);
 *   - `deletedAndLinkedTo` — the content was deliberately removed because another document owns it, and
 *                            a link to that owner must be present in a destination (Non-Duplication).
 * Only an entry naming neither is taken on the author's word, and it has to say why in writing. A
 * deletion is kept distinguishable from a rename on purpose — conflating them is how a real loss hides.
 *
 * Known and deferred: nothing asserts that `lost` is actually missing (a stale allowance is accepted
 * silently), and `excused` is keyed by line text, so one allowance covers every occurrence of a
 * duplicated line. Both are recorded here rather than left for the next reader to discover.
 *
 * The owner path must be written from the workspace root (`packages/…`, `apps/…`). A relative form is
 * REJECTED rather than normalised: the allowance file is repository-level metadata, not a document, so
 * there is no base directory to resolve `../` against.
 *
 * Usage:
 *   node scripts/harness/verify-doc-split-preservation.mjs \
 *     --ref <git-ref> --source <path> --target <path> [--target <path> …] \
 *     [--allowances <path.json>]
 *
 * Allowance file shape:
 *   { "reason": "<why this split needs allowances at all>",
 *     "entries": [ { "lost": "<exact source line>",
 *                    "survivesAs": "<exact line now in a destination>",       // optional, VERIFIED
 *                    "deletedAndLinkedTo": "<owner path linked to>",          // optional, VERIFIED
 *                    "reason": "<why this is not a loss>" } ] }
 *
 * Exit 0 when every source body line survives and every allowance holds, 1 otherwise.
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

/**
 * Split an allowance list into the lines it excuses and the findings it produces.
 * An entry naming `survivesAs` is only honoured when that replacement is really present in a
 * destination — otherwise the allowance is itself the finding.
 */
export function collectAllowanceFindings(entries, destinations, source = new Map()) {
  const excused = new Set();
  const findings = [];
  // EVERY claim is accounted for per entry, not by presence. A boolean `some()` lets N entries be
  // "verified" against ONE occurrence — which is how a second delete-and-link rode the first one's
  // link past the check. The rename path had the same shape and is counted the same way here.
  const claimed = new Map();
  const countOccurrences = (line) => {
    let n = 0;
    for (const dest of destinations) n += dest.get(line) ?? 0;
    return n;
  };
  /** Claim one occurrence of `key`; false when the destinations do not hold that many. */
  const claimOne = (key, available) => {
    const used = (claimed.get(key) ?? 0) + 1;
    if (used > available) return false;
    claimed.set(key, used);
    return true;
  };
  const ownerNeedle = (owner) => {
    // The owner must be named from the workspace root. A relative or bare path (`docs/SPEC.md`) drops
    // the owning-package segment and would then match EVERY package's SPEC — the same defect as
    // matching on a bare basename. Reject it rather than accept a link to just anyone.
    const match = /^(?:packages|apps)\/(.+)$/.exec(owner);
    return match !== null && match[1].includes('/') ? match[1] : null;
  };
  const countLinks = (owner) => {
    const needle = ownerNeedle(owner);
    if (needle === null) return 0;
    let n = 0;
    for (const dest of destinations)
      for (const line of dest.keys()) if (line.includes(needle)) n += 1;
    return n;
  };
  entries.forEach((entry, index) => {
    const where = `allowance[${index}]`;
    if (typeof entry?.lost !== 'string' || entry.lost.trim() === '') {
      findings.push(`${where}: no "lost" line`);
      return;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
      findings.push(
        `${where} ("${entry.lost}"): no "reason" — an unexplained allowance is a deletion`,
      );
      return;
    }
    if (entry.survivesAs !== undefined && entry.deletedAndLinkedTo !== undefined) {
      findings.push(
        `${where} ("${entry.lost}"): claims both a rename and a delete-and-link — it can only be one`,
      );
      return;
    }
    if (entry.survivesAs !== undefined) {
      if (typeof entry.survivesAs !== 'string' || countOccurrences(entry.survivesAs) === 0) {
        findings.push(
          `${where} ("${entry.lost}"): claims it survives as "${entry.survivesAs}", which is in no destination`,
        );
        return;
      }
      // A line that already existed in the SOURCE proves nothing about the lost one — the rename would
      // be "verified" against something that was never the replacement.
      if (source.has(entry.survivesAs)) {
        findings.push(
          `${where} ("${entry.lost}"): claims it survives as "${entry.survivesAs}", which already existed in the source — a pre-existing line is not a replacement`,
        );
        return;
      }
      if (!claimOne(`survivesAs:${entry.survivesAs}`, countOccurrences(entry.survivesAs))) {
        findings.push(
          `${where} ("${entry.lost}"): claims it survives as "${entry.survivesAs}", but the destinations carry only ${countOccurrences(entry.survivesAs)} occurrence(s) and more entr(y/ies) claim them`,
        );
        return;
      }
    }
    if (entry.deletedAndLinkedTo !== undefined) {
      const owner = entry.deletedAndLinkedTo;
      if (typeof owner !== 'string' || ownerNeedle(owner) === null) {
        findings.push(
          `${where} ("${entry.lost}"): "deletedAndLinkedTo" must name an owning package path, got "${owner}"`,
        );
        return;
      }
      if (!claimOne(`link:${owner}`, countLinks(owner))) {
        findings.push(
          `${where} ("${entry.lost}"): claims delete-and-link to "${owner}", but the destinations carry only ${countLinks(owner)} link(s) there and more entr(y/ies) claim them`,
        );
        return;
      }
    }
    excused.add(entry.lost);
  });
  return { excused, findings };
}

function parseArgs(argv) {
  const out = { targets: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--ref') ((out.ref = value), (i += 1));
    else if (flag === '--source') ((out.source = value), (i += 1));
    else if (flag === '--target') (out.targets.push(value), (i += 1));
    else if (flag === '--allowances') ((out.allowances = value), (i += 1));
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (!out.ref || !out.source || out.targets.length === 0) {
    throw new Error('required: --ref <git-ref> --source <path> --target <path> [--target …]');
  }
  return out;
}

export function main(argv = process.argv) {
  const { ref, source, targets, allowances } = parseArgs(argv);

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

  let entries = [];
  if (allowances !== undefined) {
    if (!existsSync(allowances)) {
      // Fail closed: a named allowance file that is not there means the run is unverified.
      console.error(`allowance file does not exist: ${allowances}`);
      process.exitCode = 1;
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(allowances, 'utf8'));
      entries = Array.isArray(parsed?.entries) ? parsed.entries : null;
      if (entries === null) throw new Error('no "entries" array');
    } catch (error) {
      console.error(`cannot read allowance file ${allowances}: ${error.message}`);
      process.exitCode = 1;
      return;
    }
  }

  const src = collectBodyLines(before);
  const { excused, findings: allowanceFindings } = collectAllowanceFindings(entries, dests, src);
  const lost = findMissingLines(src, dests).filter(([line]) => !excused.has(line));

  const srcTotal = examinedBodyLineCount(before);
  console.log(
    `::examined:: ${srcTotal} distinct-counted body line(s) of ${source}@${ref} against ${targets.length} destination document(s)`,
  );

  if (allowanceFindings.length > 0) {
    console.error(
      `doc-split preservation FAILED — ${allowanceFindings.length} unsound allowance(s):`,
    );
    for (const finding of allowanceFindings) console.error(`  - ${finding}`);
    process.exitCode = 1;
    return;
  }

  if (lost.length > 0) {
    console.error(`doc-split preservation FAILED — ${lost.length} body line(s) lost:`);
    for (const [line, n] of lost.slice(0, 50)) {
      console.error(`  - (x${n}) ${line.length > 140 ? `${line.slice(0, 140)}…` : line}`);
    }
    if (lost.length > 50) console.error(`  … and ${lost.length - 50} more`);
    process.exitCode = 1;
    return;
  }

  const renamed = entries.filter((entry) => entry.survivesAs !== undefined).length;
  const relinked = entries.filter((entry) => entry.deletedAndLinkedTo !== undefined).length;
  const onTrust = entries.length - renamed - relinked;
  const note =
    entries.length > 0
      ? ` (${entries.length} allowance(s): ${renamed} rename(s) verified against a named survivor, ${relinked} delete-and-link(s) verified against a live link, ${onTrust} on a written reason)`
      : '';
  console.log(`doc-split preservation passed — no body line lost${note}.`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
