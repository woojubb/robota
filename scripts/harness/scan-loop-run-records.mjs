#!/usr/bin/env node

/**
 * HARNESS-112 — a loop-run ledger says what it says, or it says nothing.
 *
 * `loop-run.mjs` writes the records. This is what keeps them meaning something: a ledger that names no
 * loop, a line nobody can parse, a terminal reason the loop could never reach, or a run left OPEN
 * forever are each a record that reads as evidence and is not.
 *
 * The last one is the reason this scan is not merely a schema check. Temporal's status model makes
 * "not closed" an explicit RUNNING state rather than an absence, and that is what makes an abandoned
 * run detectable at all. A run left OPEN indefinitely here would otherwise be indistinguishable from
 * a loop still in flight — so an OPEN entry past the staleness horizon is a finding, and the fix is
 * to close it as `abandoned`, which is a member of the vocabulary for exactly this purpose.
 *
 * WHAT THIS CANNOT SEE, stated because a floor that lets itself be read as a ceiling is worse than no
 * floor: a loop run that was never opened leaves no line, and nothing over the tree can see it. This
 * scan judges the records that exist. HARNESS-113 is what makes having one a condition of registering
 * a new loop.
 *
 * fail-direction: refuse — a ledger directory that exists but cannot be read, or a line that does not
 * parse, is a finding rather than a skipped row.
 *
 * Usage: `node scripts/harness/scan-loop-run-records.mjs`
 * Exit 0 = every record is coherent with the declaration it belongs to, 1 = findings.
 */

import path from 'node:path';

import { existsSync, readFileSync, readdirSync } from 'node:fs';

import { requireGovernedTree } from './governed-tree.mjs';
import {
  LEDGER_DIR,
  ledgerSkills,
  permitsTerminal,
  readLedger,
  readLoopDeclaration,
} from './loop-run.mjs';
import { parseDeclaration } from './scan-loop-contract.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const SKILLS_DIR = '.agents/skills';

/** The entry point a loop-driving skill's body must name, so the instruction lives where it is read. */
const RECORDER = 'loop-run.mjs';

/** How long an entry may stay OPEN before its silence is itself the finding. */
export const STALE_OPEN_DAYS = 7;

let examinedEntries = 0;

/** How many ledger entries the last sweep READ. */
export function examinedEntryCount() {
  return examinedEntries;
}

/**
 * Findings over every ledger under the ledger directory.
 *
 * @param {string} root
 * @param {number} now epoch ms — injected so the staleness horizon is testable rather than wall-clock.
 */
export function findLoopRunRecordFindings(root = WORKSPACE_ROOT, now = Date.now()) {
  // `.agents/skills/` is the governed tree, not `.agents/loop-runs/`. The distinction is the whole of
  // HARNESS-052 applied here: an ABSENT ledger directory is a legitimate state (no loop has run yet),
  // while an absent skills tree means the population this scan judges could not be read at all — and
  // reporting "no findings" for the second would mean "nothing was examined", which is not the claim.
  requireGovernedTree(root, SKILLS_DIR, {
    scan: 'loop-run-records',
    why: 'The skills tree is the population whose loops these ledgers belong to; without it every ledger is unattributable and every skill-wiring check examines nothing.',
  });
  examinedEntries = 0;
  const findings = [];
  const at = (ledger, detail) => findings.push({ ledger, detail });

  // The instruction has to live in the document the agent actually reads. A rule nothing points at from
  // the skill is a rule that is followed when remembered — which is the state this whole item replaces.
  // `over=delegated` is exempt: that skill REFERS to a loop it does not drive, so the owner records it.
  const skillsPath = path.join(root, SKILLS_DIR);
  if (existsSync(skillsPath)) {
    for (const name of readdirSync(skillsPath).sort()) {
      const file = path.join(skillsPath, name, 'SKILL.md');
      if (!existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      const declaration = parseDeclaration(text);
      if (declaration === undefined || declaration.over === 'delegated') continue;
      if (!text.includes(RECORDER)) {
        at(
          path.join(SKILLS_DIR, name, 'SKILL.md'),
          `declares a loop and never names \`${RECORDER}\` — the recording instruction has to be in the document that is read, not only in the rule`,
        );
      }
    }
  }

  for (const skill of ledgerSkills(root)) {
    const rel = path.join(LEDGER_DIR, `${skill}.jsonl`);
    const declaration = readLoopDeclaration(root, skill);
    if (declaration === undefined) {
      at(
        rel,
        `names no skill that declares \`loop:\` frontmatter — a ledger for a loop that does not exist is a record of nothing`,
      );
      continue;
    }

    let entries;
    try {
      entries = readLedger(root, skill);
    } catch (error) {
      // Not skipped: an unreadable ledger is not an empty one, and treating it as empty would shrink
      // every denominator taken from it in the direction that flatters the result.
      at(rel, error.message);
      continue;
    }

    const seen = new Set();
    for (const entry of entries) {
      examinedEntries += 1;
      if (typeof entry?.runId !== 'string' || entry.runId === '') {
        at(rel, 'an entry has no `runId`');
        continue;
      }
      if (seen.has(entry.runId))
        at(rel, `run \`${entry.runId}\` appears more than once — two runs cannot share an id`);
      seen.add(entry.runId);

      if (
        !Array.isArray(entry.roundFindings) ||
        entry.roundFindings.some((n) => !Number.isInteger(n) || n < 0)
      ) {
        at(
          rel,
          `run \`${entry.runId}\`: \`roundFindings\` must be an array of non-negative integers`,
        );
      }

      if (entry.terminal === null || entry.terminal === undefined) {
        const openedMs = Date.parse(entry.opened ?? '');
        if (Number.isNaN(openedMs)) {
          at(rel, `run \`${entry.runId}\` is OPEN and its \`opened\` timestamp does not parse`);
        } else if (now - openedMs > STALE_OPEN_DAYS * 86_400_000) {
          at(
            rel,
            `run \`${entry.runId}\` has been OPEN since ${entry.opened} — longer than ${STALE_OPEN_DAYS} days. ` +
              'A run nobody closed is not a run still going: close it as `abandoned`, which is what that member of the vocabulary is for.',
          );
        }
        continue;
      }

      const permitted = permitsTerminal(declaration, entry.terminal);
      if (!permitted.ok) at(rel, `run \`${entry.runId}\`: ${permitted.why}`);
      if (typeof entry.closed !== 'string' || Number.isNaN(Date.parse(entry.closed))) {
        at(
          rel,
          `run \`${entry.runId}\` is closed as \`${entry.terminal}\` and has no parseable \`closed\` timestamp`,
        );
      }
    }
  }
  return findings;
}

function main() {
  const findings = findLoopRunRecordFindings();
  // A pass over nothing is not a pass. Zero entries is CORRECT today and will stop being correct as
  // soon as the first loop is recorded, so the reason is declared rather than left to be inferred.
  const empty =
    examinedEntryCount() === 0
      ? ' ::expected-empty:: no loop run has been recorded yet — the ledgers are created by the first `loop-run.mjs open`, and the skill-wiring half of this scan examined every loop-driving skill regardless'
      : '';
  console.error(`::examined:: ${examinedEntryCount()} loop-run ledger entries${empty}`);
  if (findings.length === 0) {
    console.log(
      `loop-run-records scan passed (${examinedEntryCount()} entry(ies) examined across ` +
        `${ledgerSkills(WORKSPACE_ROOT).length} ledger(s)). It judges the records that EXIST — a run that was ` +
        'never opened leaves no line, and nothing over the tree can see it.',
    );
    return 0;
  }
  console.error('loop-run-records scan failed:');
  for (const f of findings) console.error(`  - ${f.ledger}: ${f.detail}`);
  return 1;
}

const isDirectExecution =
  process.argv[1] !== undefined && process.argv[1].endsWith('scan-loop-run-records.mjs');
if (isDirectExecution) process.exitCode = main();
