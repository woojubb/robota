#!/usr/bin/env node

/**
 * Routing documents stay lean, and may only get leaner (D1).
 *
 * THE GAP THIS CLOSES, measured. `operational.md` § Document Size Rule names three routing documents
 * and requires them to stay lean, targeting under 80 lines. `scan-file-size.mjs` scopes itself to
 * `packages` and `apps`, so **nothing could see them**. Measured when this scan was written:
 * `AGENTS.md` 159, `.agents/rules/index.md` 99, `.agents/project-structure.md` 370 — three of three
 * in violation of a rule with no enforcement behind it.
 *
 * It matters more than a style nit because `AGENTS.md` is re-injected after every compaction: every
 * line is paid on every turn, for the life of the repository.
 *
 * WHY A RATCHET AND NOT THE TARGET. Cutting these to 80 today would mean deleting routing rows —
 * the one thing a routing document exists to hold — and a floor that demands that gets switched off
 * the first time someone needs a row back. So the enforced invariant is the DIRECTION: each document
 * is frozen at its current size and may only shrink. The distance to the 80-line target is reported
 * on every run so the gap stays visible rather than becoming the new normal, and the frozen value is
 * lowered as content finds its real owner.
 *
 * THE LIST AND THE TARGET ARE NOT HARD-CODED. Both are read out of `operational.md`, which owns them
 * (AGENTS.md: one owner per fact) — a second copy here is precisely the drift that let the rule and
 * the scan disagree for the file's whole life. The parse is FAIL-CLOSED: a rule that yields no
 * document list or no target exits 1 rather than passing vacuously.
 *
 * Usage: `node scripts/harness/scan-routing-document-size.mjs [--write-baseline]`
 * Exit code 0 = no document exceeds its frozen size, 1 = findings.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const RULE_RELATIVE = '.agents/rules/operational.md';
const BASELINE_FILE = path.join(import.meta.dirname, 'routing-document-size-baseline.json');

/** The heading whose bullet owns the routing-document list and the line target. */
const SECTION = 'Document Size Rule';

/**
 * Read the routing-document list and the line target out of the rule's own bullet.
 *
 * Anchored on the bullet's phrasing — "**Routing/index documents** — `a`, `b`, `c` — MUST stay lean
 * (target under N lines)" — so adding a fourth document to the rule adds it here with no code
 * change, which is the only version of "one owner per fact" that survives contact with time.
 *
 * Returns `{ documents: [], target: undefined }` when the rule states no such bullet; the caller
 * turns that into an error rather than a pass.
 */
export function parseRoutingRule(ruleText) {
  const sectionStart = ruleText.indexOf(SECTION);
  if (sectionStart === -1) return { documents: [], target: undefined };
  const section = ruleText.slice(sectionStart);
  const bullet = section.match(/\*\*Routing\/index documents\*\*[^\n]*/);
  if (!bullet) return { documents: [], target: undefined };
  const documents = [...bullet[0].matchAll(/`([^`]+\.md)`/g)].map((m) => m[1]);
  const target = bullet[0].match(/target under (\d+) lines/);
  return { documents, target: target ? Number(target[1]) : undefined };
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return {};
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8')).frozen ?? {};
}

/** Line count as `wc -l` reports it: the number of newline-terminated lines. */
function lineCount(file) {
  const text = readFileSync(file, 'utf8');
  return text.length === 0 ? 0 : text.replace(/\n$/, '').split('\n').length;
}

export function findRoutingSizeFindings(root = WORKSPACE_ROOT, baseline = loadBaseline()) {
  requireGovernedTree(root, [RULE_RELATIVE], {
    scan: 'routing-document-size',
    why: 'The rule states which documents are routing documents and how lean they must be; without it there is no list to measure and no target to measure against.',
  });
  const { documents, target } = parseRoutingRule(
    readFileSync(path.join(root, RULE_RELATIVE), 'utf8'),
  );
  if (documents.length === 0 || target === undefined) {
    throw new Error(
      'routing-document-size: operational.md yielded no routing-document list or no line target. ' +
        'The criteria this scan enforces are unreadable, so "no findings" would mean "nothing was ' +
        'examined".',
    );
  }
  const findings = [];
  const measured = {};
  for (const relative of documents) {
    const file = path.join(root, relative);
    if (!existsSync(file)) {
      findings.push({
        document: relative,
        problem:
          'is named as a routing document by operational.md but does not exist. Either the rule ' +
          'names a document that was moved, or the document was deleted without amending the rule.',
      });
      continue;
    }
    const lines = lineCount(file);
    measured[relative] = lines;
    const frozen = baseline[relative];
    if (frozen !== undefined && lines > frozen) {
      findings.push({
        document: relative,
        problem:
          `is ${lines} lines, above its frozen ${frozen}. A routing document routes; it does not ` +
          `inline. Move the added detail to the document that owns it, or — if the growth is ` +
          `genuinely routing — lower something else first. The ratchet only tightens.`,
      });
    }
  }
  return { findings, measured, target, examined: documents.length };
}

/** Exported so a test can read the size this scan reports (measurement-provenance.md). */
export function readExaminedDocumentCount(root = WORKSPACE_ROOT) {
  return findRoutingSizeFindings(root).examined;
}

export function scanRoutingDocumentSize() {
  const { findings, measured, target, examined } = findRoutingSizeFindings();
  return { findings, measured, target, examined };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { findings, measured, target, examined } = scanRoutingDocumentSize();
  if (process.argv.includes('--write-baseline')) {
    writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify(
        {
          _comment:
            'D1. Frozen line counts for the routing documents operational.md names. A document may ' +
            'only shrink. Re-freeze with --write-baseline ONLY after a real reduction; never to ' +
            'admit growth.',
          _target: target,
          frozen: measured,
        },
        null,
        2,
      )}\n`,
    );
    console.error(`re-froze ${Object.keys(measured).length} routing document size(s).`);
    process.exit(0);
  }
  for (const finding of findings) console.error(`✗ ${finding.document}: ${finding.problem}`);
  // The gap to the target is reported every run, never enforced. A target nobody can see is a
  // target that quietly becomes the current value.
  for (const [document, lines] of Object.entries(measured)) {
    if (lines > target)
      console.error(
        `⚑ ${document}: ${lines} lines, ${lines - target} over the ${target}-line target`,
      );
  }
  console.log(`::examined:: ${examined} routing document(s)`);
  process.exit(findings.length > 0 ? 1 : 0);
}
