#!/usr/bin/env node

/**
 * Contract-disposition guard (HARNESS-097).
 *
 * Two mirror-image errors, one substitution — a contract's state read from a proxy signal instead of
 * its actual state:
 *
 *   grep finds no consumer  → "dead, remove it"      (it was forward-provisioned, or misplaced)
 *   grep finds one consumer → "make it private"       (a library surface with one in-repo assembly)
 *   the surface is published → "we cannot change it"  (the project is pre-release; nothing is exposed)
 *
 * `project-structure.md` § Forward-Provisioned Surface Rule already forbids the first two — "Removal
 * or narrowing of a public surface is a PRODUCT decision — never a grep-based cleanup", and in-repo
 * consumer count is not evidence about whether a surface should be public at ANY count (owner
 * decision, 2026-08-23; ARCH-102). It was violated anyway, in a shipped changeset that labelled a
 * carried-but-not-honored field a "dead contract field". Prose did not hold, so this is the
 * mechanical half.
 *
 * WHAT IT CHECKS. Changeset bodies (`.changeset/*.md`) are the surface where a disposition becomes a
 * public claim about a contract. A changeset asserting a contract is dead/unused must name which
 * disposition was chosen from the closed vocabulary (keep-and-document / relocate / remove-by-decision)
 * — because all three are legitimate and only one of them is what "dead" implies.
 *
 * WHAT IT DOES NOT CLAIM. It cannot tell whether the disposition named is the RIGHT one; that is the
 * `contract-disposition` skill's judgement, not a text check's. It closes the specific hole the
 * incident went through: an unqualified "dead" assertion reaching a shipped artifact with no
 * disposition recorded anywhere. Stated rather than implied, so the check is not read as more than it
 * is.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const CHANGESET_DIR = path.join(WORKSPACE_ROOT, '.changeset');

/**
 * Phrases that assert a contract is dead. Deliberately narrow: each is an ASSERTION about a
 * contract's state, not a description of work. "removed the unused import" is not here — an import is
 * not a contract, and widening this to every occurrence of "unused" would make the check fire on
 * ordinary prose, which is how a guard stops being read.
 *
 * `dead code` is deliberately EXCLUDED, and the exclusion was earned: the first draft included it and
 * fired on `.changeset/dist-006-*.md`, which says a `--import tsx` branch "was therefore dead code" —
 * an unreachable branch, not an unconsumed contract. That is the ordinary usage this list's own note
 * warns about, and the draft committed it one line below the warning. A subject noun is required.
 */
const DEAD_CLAIM = [
  /\bdead (?:contract|field|surface|export|option)\b/i,
  /\b(?:contract|field|surface|export|option) is dead\b/i,
  /\bremoved? (?:it )?as unused\b/i,
  /\bunused (?:contract|public surface|public export)\b/i,
];

/**
 * A recorded disposition from the closed vocabulary. Any one of these present means a human made the
 * call rather than a grep.
 */
const DISPOSITION = [
  /\bforward[- ]provision/i,
  /\brelocat/i,
  /\bproduct decision\b/i,
  /\bowner decision\b/i,
  /\bcarried[- ]but[- ]not[- ]honou?red\b/i,
  /\bdisposition\b/i,
];

let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

/** Analyze one changeset body. Exported so the fixture drives the real logic. */
export function analyzeChangeset(body) {
  const claim = DEAD_CLAIM.find((re) => re.test(body));
  if (!claim) return [];
  if (DISPOSITION.some((re) => re.test(body))) return [];
  return [
    'asserts a contract is dead/unused without naming a disposition — an unconsumed public surface is keep-and-document, relocate, or remove-by-explicit-decision, never a grep result (project-structure.md:225, contract-disposition skill)',
  ];
}

export function findContractDispositionFindings(dir = CHANGESET_DIR) {
  examinedCount = 0;
  const findings = [];
  if (!existsSync(dir)) return findings;

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    examinedCount += 1;
    const body = readFileSync(path.join(dir, file), 'utf8');
    for (const finding of analyzeChangeset(body)) {
      findings.push(`.changeset/${file}: ${finding}`);
    }
  }
  return findings;
}

function main() {
  const findings = findContractDispositionFindings();
  process.stdout.write(`::examined:: ${readExamined()} changeset(s)\n`);

  if (findings.length > 0) {
    process.stderr.write('❌ Contract-disposition violations (HARNESS-097):\n\n');
    for (const f of findings) process.stderr.write(`  [contract-disposition] ${f}\n`);
    process.stderr.write(
      '\nName the disposition, or describe the change without asserting the contract is dead. See .agents/skills/contract-disposition/SKILL.md.\n',
    );
    process.stdout.write(
      `contract-disposition summary: violations=${findings.length} result=FAIL\n`,
    );
    process.exit(1);
  }

  process.stdout.write('✅ Contract disposition: no unqualified dead-contract claims.\n');
  process.stdout.write('contract-disposition summary: violations=0 result=PASS\n');
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) main();
