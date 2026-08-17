#!/usr/bin/env node

/**
 * Spec documents that reached implementation must carry a user-execution gate section (HARNESS-105).
 *
 * THE GAP THIS CLOSES, measured. `.agents/rules/backlog-execution.md` § User Execution Test Scenario
 * Rule says every backlog that changes runnable user-facing behavior "must include a
 * `## User Execution Test Scenarios` section BEFORE implementation starts", and for work that
 * delivers no such behavior says to mark it not applicable with a reason. Either way the section is
 * required. Nothing enforced it. Measured on the live tree when this scan was written: **217 of 257**
 * documents in `spec-docs/done/` (84%) and **3 of 3** in `spec-docs/active/` have no such section —
 * so for that population the mandate was prose only.
 *
 * The occurrence that produced this floor: seven spec documents were written, implemented, and
 * reported complete with no section at all. Running the gate afterwards is what found that SEC-009's
 * fix did not work on the real path — `resolveActiveProviderProfile` never copied the field the fix
 * recorded, and the unit test could not see it because it hand-built the object under test. The gate
 * existed and would have caught it; nothing required it to run, and that is the defect here.
 *
 * WHY A FROZEN SET AND NOT A FROZEN COUNT. A count of 217 lets a new document skip the section
 * whenever an old one gains it, which governs the wrong direction: all of the value is in NEW work,
 * and none of it is in legacy documents that will never be implemented again. The baseline is
 * therefore the exempt SET — every document outside it must comply, and the set may only shrink.
 *
 * THE FOLDERS ARE NOT HARD-CODED HERE. `spec-workflow.md` owns the status→folder mapping
 * (AGENTS.md: one owner per fact), so this scan derives the governed folders from that rule's table
 * via `parseStatusFolderMapping` — the folders of the statuses that mean implementation has started
 * (`in-progress`, `verifying`, `done`). A document in `draft/`, `backlog/` or `todo/` has not
 * started, so the rule does not bite yet and neither does this scan.
 *
 * THE HEADING IS NOT HARD-CODED EITHER. It is read out of `backlog-execution.md`, which owns it. The
 * parse is FAIL-CLOSED: an unreadable rule, an empty mapping, or a heading that cannot be found exits
 * 1 rather than passing vacuously, because a floor that cannot read its own criteria has verified
 * nothing.
 *
 * Usage: `node scripts/harness/scan-spec-user-execution-section.mjs`
 * Exit code 0 = every governed document carries the section (or is a frozen exemption), 1 = findings.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { parseStatusFolderMapping } from './scan-doc-folder-status-agreement.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const SPEC_RELATIVE = '.agents/spec-docs';
/** The tree whose absence must fail this scan closed, stated as a path under the root it is given. */
const GOVERNED_TREE = `${SPEC_RELATIVE}/done`;
const SPEC_WORKFLOW_RULE = path.join(WORKSPACE_ROOT, '.agents/rules/spec-workflow.md');
const BACKLOG_RULE = path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md');
const BASELINE_FILE = path.join(import.meta.dirname, 'spec-user-execution-baseline.json');

/**
 * The statuses that mean implementation has started. The rule requires the section BEFORE that
 * point, so these are exactly the statuses by which it must already exist.
 */
const IMPLEMENTATION_STARTED = ['in-progress', 'verifying', 'done'];

/**
 * Read the required section heading out of the rule that owns it.
 *
 * Matched on the SENTENCE, not on the heading text: the rule's mandate reads "must include a
 * `## …` section before implementation starts", so the pattern anchors on that phrasing and takes
 * whatever heading it names. Putting the heading text in the pattern would have made this a
 * confirmation that the rule still says what this file already believes — a check reading its own
 * assumption back, which is the shape the harness exists to reject.
 *
 * Returns undefined when the rule states no such mandate — the caller treats that as a failure,
 * never as "no heading is required".
 */
export function parseRequiredHeading(ruleText) {
  const match = ruleText.match(/must include an?\s+`(##[^`\n]+)`\s+section/);
  return match ? match[1].trim().replace(/\s+/g, ' ') : undefined;
}

/** The governed folders, derived from spec-workflow.md's own status→folder table. */
export function resolveGovernedFolders(ruleText) {
  const mapping = parseStatusFolderMapping(ruleText);
  const folders = new Set();
  for (const status of IMPLEMENTATION_STARTED) {
    const folder = mapping.get(status);
    if (folder) folders.add(folder);
  }
  return [...folders].sort();
}

function loadBaseline() {
  if (!existsSync(BASELINE_FILE)) return { exempt: [] };
  return JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
}

/**
 * Every governed document, as `<folder>/<file>`. Named `list*` rather than `find*` deliberately:
 * `scan-guard-scope-fail-closed` derives its classification duty from `find|collect*(root`, and a
 * pure enumerator that renders no verdict does not belong in that ledger — `listWorkspaceManifests`
 * is the same call made one scan over. — the key the baseline uses, so a document that
 * moves folders loses its exemption. That is deliberate: a move is a gate transition, and a
 * transition is exactly when the section should have been written.
 */
export function listGovernedSpecs(root = WORKSPACE_ROOT, folders = []) {
  const specs = [];
  for (const folder of folders) {
    const dir = path.join(root, SPEC_RELATIVE, folder);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.md') || file === 'README.md') continue;
      specs.push({ key: `${folder}/${file}`, file: path.join(dir, file) });
    }
  }
  return specs;
}

export function findMissingSectionFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, [GOVERNED_TREE], {
    scan: 'spec-user-execution-section',
    why: 'The spec-document tree is what this scan measures.',
  });
  const workflowText = readFileSync(SPEC_WORKFLOW_RULE, 'utf8');
  const folders = resolveGovernedFolders(workflowText);
  if (folders.length === 0) {
    throw new Error(
      'spec-user-execution-section: spec-workflow.md yielded no folder for any of ' +
        `${IMPLEMENTATION_STARTED.join(', ')}. The mapping this scan derives its population from is ` +
        'unreadable, so "no findings" would mean "nothing was examined".',
    );
  }
  const heading = parseRequiredHeading(readFileSync(BACKLOG_RULE, 'utf8'));
  if (!heading) {
    throw new Error(
      'spec-user-execution-section: backlog-execution.md does not state the required section ' +
        'heading. The criterion this scan enforces is unreadable, so it has verified nothing.',
    );
  }
  const exempt = new Set(loadBaseline().exempt);
  const findings = [];
  const specs = listGovernedSpecs(root, folders);
  for (const { key, file } of specs) {
    if (exempt.has(key)) continue;
    const text = readFileSync(file, 'utf8');
    if (text.split('\n').some((line) => line.trim().replace(/\s+/g, ' ') === heading)) continue;
    findings.push({
      spec: key,
      problem:
        `reached ${path.dirname(key)}/ with no \`${heading}\` section. backlog-execution.md ` +
        'requires it BEFORE implementation starts — either the scenarios a user can run, or an ' +
        'explicit not-applicable with its reason. Add the section; do not add the document to the ' +
        'baseline, which is frozen for documents that predate this floor.',
    });
  }
  return { findings, examined: specs.length, exemptCount: exempt.size };
}

/** Exported so a test can read the size this scan reports (measurement-provenance.md). */
export function readExaminedSpecCount(root = WORKSPACE_ROOT) {
  return findMissingSectionFindings(root).examined;
}

export function scanSpecUserExecutionSection() {
  const { findings, examined, exemptCount } = findMissingSectionFindings();
  return {
    name: 'spec-user-execution-section',
    findings: findings.map((f) => `${f.spec}: ${f.problem}`),
    examined: `${examined} governed spec document(s), ${exemptCount} frozen exemption(s)`,
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = scanSpecUserExecutionSection();
  for (const finding of result.findings) console.error(`✗ ${finding}`);
  // measurement-provenance.md: declare the size examined, so a scan that silently stopped reading
  // is distinguishable from one that read everything and found nothing.
  console.log(`::examined:: ${result.examined}`);
  process.exit(result.findings.length > 0 ? 1 : 0);
}
