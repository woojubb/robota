#!/usr/bin/env node

/**
 * Task-archival drift scan (HARNESS-016).
 *
 * Done task breakdowns silently piled up in `.agents/tasks/` instead of being
 * moved to `.agents/tasks/completed/`. The cause was a blind detector: both the
 * SessionStart/Stop hooks decided "done" by grepping a `**Status**:` field that
 * the real task-breakdown format never carries, so every file reported
 * `status: unknown` and archival was a soft echo nobody enforced. Meanwhile the
 * active/completed split is load-bearing — `scan-test-plan.mjs` scans
 * `.agents/tasks/*.md` (excluding completed/), so a done-but-active file keeps
 * feeding a stale plan into the harness forever.
 *
 * This scan makes "done" machine-detectable and enforced. A task file under
 * `.agents/tasks/` (excluding README.md and completed/) is ARCHIVABLE when:
 *   - it carries an explicit `Status: completed` line, OR
 *   - every checkbox is checked (>=1 checkbox, zero `- [ ]`) AND its `Spec:`
 *     pointer references `.agents/spec-docs/done/` (the spec already shipped).
 *
 * An archivable file that still lives in the active directory is a finding.
 * Escape hatch: a `<!-- archival-exempt: <reason> -->` line keeps a deliberately
 * active-but-complete file (e.g. one blocked on a dependent task) out of the
 * findings, reported as an exemption instead.
 *
 * Exit code 0 = no done-but-active task files, 1 = archival drift found.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ADVISORY_MARKER } from './run-all-scans.mjs';
import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const TASKS_DIR = '.agents/tasks';
const COMPLETED_DIR = `${TASKS_DIR}/completed`;

const UNCHECKED_PATTERN = /^\s*[-*]\s+\[ \]/;
const CHECKED_PATTERN = /^\s*[-*]\s+\[[xX]\]/;
const STATUS_COMPLETED_PATTERN = /status\*{0,2}\s*:\s*completed/i;
const SPEC_POINTER_PATTERN = /^\s*Spec:.*spec-docs\/done\//i;
const UNDONE_SPEC_POINTER_PATTERN = /^\s*Spec:.*spec-docs\/(draft|backlog|todo|active)\//i;
const EXEMPT_PATTERN = /<!--\s*archival-exempt:\s*(.+?)\s*-->/;

/**
 * Classify a single task-file body.
 * @returns {{ archivable: boolean, gatesOverdue: boolean, reason: string, exemptReason: string | null }}
 */
export function classifyTaskFile(content) {
  const lines = content.split(/\r?\n/);

  let unchecked = 0;
  let checked = 0;
  let hasStatusCompleted = false;
  let hasDoneSpecPointer = false;
  let hasUndoneSpecPointer = false;
  let exemptReason = null;

  for (const line of lines) {
    if (UNCHECKED_PATTERN.test(line)) unchecked += 1;
    else if (CHECKED_PATTERN.test(line)) checked += 1;
    if (STATUS_COMPLETED_PATTERN.test(line)) hasStatusCompleted = true;
    if (SPEC_POINTER_PATTERN.test(line)) hasDoneSpecPointer = true;
    if (UNDONE_SPEC_POINTER_PATTERN.test(line)) hasUndoneSpecPointer = true;
    const exemptMatch = EXEMPT_PATTERN.exec(line);
    if (exemptMatch) exemptReason = exemptMatch[1];
  }

  const allChecked = checked > 0 && unchecked === 0;
  let archivable = false;
  let gatesOverdue = false;
  let reason = '';
  if (hasStatusCompleted) {
    archivable = true;
    reason = 'Status: completed';
  } else if (allChecked && hasDoneSpecPointer) {
    archivable = true;
    reason = `all ${checked} checkbox(es) checked, spec in spec-docs/done/`;
  } else if (allChecked && hasUndoneSpecPointer) {
    // Lesson (2026-07-02): TERM-008/WORKFLOW-003 sat fully-checked for days while their specs
    // stayed in active/ — invisible to the archivable rule above because that rule requires the
    // spec to ALREADY be in done/ (circular). A fully-checked task whose spec has not passed its
    // gates means GATE-VERIFY/GATE-COMPLETE are overdue: closing the loop (gates + spec move +
    // archival) is part of the work, not a separate chore.
    gatesOverdue = true;
    reason = `all ${checked} checkbox(es) checked but the spec has not reached spec-docs/done/`;
  }

  return { archivable, gatesOverdue, reason, exemptReason };
}

/**
 * Read a directory, treating ONLY its absence as empty.
 *
 * A bare `catch { return [] }` here reports a permission or I/O failure in the words of a clean
 * result — the swallow-error-as-clean-default pattern `requireGovernedTree` was added to this very
 * file to end on the active side. Adding a count while leaving the count's own read able to fail
 * silently would have given the reader a number that looks measured and is not.
 */
async function readDirOrAbsent(dir) {
  try {
    return await fs.readdir(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

/** Count the archived breakdowns under `.agents/tasks/completed/`; an absent archive is 0. */
async function countArchived(root) {
  const entries = await readDirOrAbsent(path.join(root, COMPLETED_DIR));
  return entries.filter((name) => name.endsWith('.md') && name !== 'README.md').length;
}

/**
 * Findings plus the SIZE OF EACH HALF of the corpus (HARNESS-063).
 *
 * `examined` is the number of ACTIVE task files this scan actually read; `archived` is the frozen
 * half it deliberately does not judge. Measured 2026-08-01 on this repository: 0 examined, 422
 * archived — the scan had never read a document, and `task-archival scan passed.` said so in
 * exactly the same words it would have used over a hundred verified breakdowns.
 */
export async function findTaskArchivalFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, [TASKS_DIR], {
    scan: 'task-archival',
    why: 'The task tree is the subject; a readdir failure was swallowed and returned as "nothing to archive".',
  });
  const findings = [];
  const exemptions = [];
  const tasksAbsolute = path.join(root, TASKS_DIR);
  const archived = await countArchived(root);
  let examined = 0;

  const entries = await readDirOrAbsent(tasksAbsolute);

  for (const entry of entries
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()) {
    const taskFile = path.join(TASKS_DIR, entry);
    const content = await fs.readFile(path.join(root, taskFile), 'utf8');
    examined += 1;
    const { archivable, gatesOverdue, reason, exemptReason } = classifyTaskFile(content);
    if (!archivable && !gatesOverdue) continue;
    if (exemptReason) {
      exemptions.push({ taskFile, reason: exemptReason });
      continue;
    }
    findings.push({ taskFile, reason, gatesOverdue });
  }

  return { findings, exemptions, examined, archived };
}

/**
 * Run the scan. Returns the exit code rather than setting `process.exitCode`, so a test can drive it
 * over a fixture root without the fixture's verdict escaping into the test runner's own exit status.
 */
export async function main(root = WORKSPACE_ROOT, write = (line) => process.stdout.write(line)) {
  const { findings, exemptions, examined, archived } = await findTaskArchivalFindings(root);

  for (const exemption of exemptions) {
    write(`  archival-exempt: ${exemption.taskFile} — ${exemption.reason}\n`);
  }

  const subject =
    `${examined} active task file(s) examined, ${archived} archived in ${COMPLETED_DIR}/` +
    (exemptions.length > 0 ? `, ${exemptions.length} exempt` : '');

  if (findings.length === 0) {
    // HARNESS-063: `task-archival scan passed.` was identical whether the scan had read a hundred
    // breakdowns or none. A zero here is not a clean sweep — it is a corpus that contributed
    // nothing, and the advisory channel is what carries that into the suite summary (a passing
    // scan's stdout is otherwise suppressed to a single tick).
    if (examined === 0) {
      write(
        `${ADVISORY_MARKER} task-archival examined 0 active task files — the active half of ` +
          `${TASKS_DIR}/ is empty (${archived} archived under completed/), so this pass verified ` +
          'no document.\n',
      );
    }
    write(`task-archival scan passed (${subject}).\n`);
    return 0;
  }

  write(
    `task-archival scan failed (${subject}) — done or gate-overdue task files in the active directory:\n`,
  );
  for (const finding of findings) {
    write(
      `  - ${finding.taskFile} (${finding.reason})${finding.gatesOverdue ? ' — run GATE-VERIFY/GATE-COMPLETE, move the spec to done/, then archive' : ''}\n`,
    );
  }
  write(
    'Archive done tasks to .agents/tasks/completed/ (git mv) in the same change as the work; ' +
      'for fully-checked tasks whose spec is not yet done/, run the remaining gates first. ' +
      'Annotate with <!-- archival-exempt: <reason> --> only when the file must stay active.\n',
  );
  return 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  process.exitCode = await main();
}
