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

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const TASKS_DIR = '.agents/tasks';

const UNCHECKED_PATTERN = /^\s*[-*]\s+\[ \]/;
const CHECKED_PATTERN = /^\s*[-*]\s+\[[xX]\]/;
const STATUS_COMPLETED_PATTERN = /status\*{0,2}\s*:\s*completed/i;
const SPEC_POINTER_PATTERN = /^\s*Spec:.*spec-docs\/done\//i;
const EXEMPT_PATTERN = /<!--\s*archival-exempt:\s*(.+?)\s*-->/;

/**
 * Classify a single task-file body.
 * @returns {{ archivable: boolean, reason: string, exemptReason: string | null }}
 */
export function classifyTaskFile(content) {
  const lines = content.split(/\r?\n/);

  let unchecked = 0;
  let checked = 0;
  let hasStatusCompleted = false;
  let hasDoneSpecPointer = false;
  let exemptReason = null;

  for (const line of lines) {
    if (UNCHECKED_PATTERN.test(line)) unchecked += 1;
    else if (CHECKED_PATTERN.test(line)) checked += 1;
    if (STATUS_COMPLETED_PATTERN.test(line)) hasStatusCompleted = true;
    if (SPEC_POINTER_PATTERN.test(line)) hasDoneSpecPointer = true;
    const exemptMatch = EXEMPT_PATTERN.exec(line);
    if (exemptMatch) exemptReason = exemptMatch[1];
  }

  const allChecked = checked > 0 && unchecked === 0;
  let archivable = false;
  let reason = '';
  if (hasStatusCompleted) {
    archivable = true;
    reason = 'Status: completed';
  } else if (allChecked && hasDoneSpecPointer) {
    archivable = true;
    reason = `all ${checked} checkbox(es) checked, spec in spec-docs/done/`;
  }

  return { archivable, reason, exemptReason };
}

export async function findTaskArchivalFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const exemptions = [];
  const tasksAbsolute = path.join(root, TASKS_DIR);

  let entries = [];
  try {
    entries = await fs.readdir(tasksAbsolute);
  } catch {
    return { findings, exemptions };
  }

  for (const entry of entries
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()) {
    const taskFile = path.join(TASKS_DIR, entry);
    const content = await fs.readFile(path.join(root, taskFile), 'utf8');
    const { archivable, reason, exemptReason } = classifyTaskFile(content);
    if (!archivable) continue;
    if (exemptReason) {
      exemptions.push({ taskFile, reason: exemptReason });
      continue;
    }
    findings.push({ taskFile, reason });
  }

  return { findings, exemptions };
}

export async function main() {
  const { findings, exemptions } = await findTaskArchivalFindings(WORKSPACE_ROOT);

  for (const exemption of exemptions) {
    process.stdout.write(`  archival-exempt: ${exemption.taskFile} — ${exemption.reason}\n`);
  }

  if (findings.length === 0) {
    process.stdout.write(
      `task-archival scan passed${exemptions.length > 0 ? ` (${exemptions.length} exempt)` : ''}.\n`,
    );
    return;
  }

  process.stdout.write(
    'task-archival scan failed — done task files still in the active directory:\n',
  );
  for (const finding of findings) {
    process.stdout.write(`  - ${finding.taskFile} (${finding.reason})\n`);
  }
  process.stdout.write(
    'Move each to .agents/tasks/completed/ (git mv) in the same commit as the work, ' +
      'or annotate it with <!-- archival-exempt: <reason> --> if it must stay active.\n',
  );
  process.exitCode = 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
