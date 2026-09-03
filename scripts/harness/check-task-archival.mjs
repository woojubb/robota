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
 * This scan makes terminal lifecycle and initiative rollups machine-detectable. Task lifecycle
 * comes only from YAML frontmatter through `task-lifecycle.mjs`; body prose and checkboxes never
 * declare completion. Fully checked work whose spec is still active remains a gate-overdue signal.
 * Exact-ID `type: AGREEMENT` pairs additionally project declared child status/path into Task
 * `## Children` and spec `## Tasks` sections.
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
import { idOf } from './check-backlog-placement.mjs';
import { asList, asScalar, splitFrontmatter } from './frontmatter.mjs';
import { ADVISORY_MARKER } from './run-all-scans.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { classifyTaskLifecycle } from './task-lifecycle.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const TASKS_DIR = '.agents/tasks';
const COMPLETED_DIR = `${TASKS_DIR}/completed`;
const SPEC_DOCS_DIR = '.agents/spec-docs';

const UNCHECKED_PATTERN = /^\s*[-*]\s+\[ \]/;
const CHECKED_PATTERN = /^\s*[-*]\s+\[[xX]\]/;
const UNDONE_SPEC_POINTER_PATTERN = /^\s*Spec:.*spec-docs\/(draft|backlog|todo|active)\//i;
const EXEMPT_PATTERN = /<!--\s*archival-exempt:\s*(.+?)\s*-->/;
const PROJECTION_ROW_PATTERN =
  /^\s*[-*]\s+\[([ xX])\]\s+([A-Z]+(?:-[A-Z]+)*-\d+(?:-P\d+)*)\s+—\s+([a-z-]+)\s+—\s+`([^`]+)`\s*$/;

/**
 * Classify a single task-file body.
 * @returns {{ archivable: boolean, gatesOverdue: boolean, reason: string, exemptReason: string | null }}
 */
export function classifyTaskFile(content) {
  const lines = content.split(/\r?\n/);

  let unchecked = 0;
  let checked = 0;
  let hasUndoneSpecPointer = false;
  let exemptReason = null;

  for (const line of lines) {
    if (UNCHECKED_PATTERN.test(line)) unchecked += 1;
    else if (CHECKED_PATTERN.test(line)) checked += 1;
    if (UNDONE_SPEC_POINTER_PATTERN.test(line)) hasUndoneSpecPointer = true;
    const exemptMatch = EXEMPT_PATTERN.exec(line);
    if (exemptMatch) exemptReason = exemptMatch[1];
  }

  const allChecked = checked > 0 && unchecked === 0;
  let archivable = false;
  let gatesOverdue = false;
  let reason = '';
  const lifecycle = classifyTaskLifecycle(content);
  if (lifecycle.state === 'terminal' && lifecycle.valid) {
    archivable = true;
    reason = `status: ${lifecycle.status}`;
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

async function listMarkdownRecords(root, relativeDirs) {
  const records = [];
  for (const relativeDir of relativeDirs) {
    for (const name of (await readDirOrAbsent(path.join(root, relativeDir))).sort()) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      const relative = path.posix.join(relativeDir, name);
      const absolute = path.join(root, relative);
      const handle = await fs.open(absolute, 'r');
      let content;
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) continue;
        content = await handle.readFile('utf8');
      } finally {
        await handle.close();
      }
      const { entries, body } = splitFrontmatter(content);
      records.push({ id: idOf(name), relative, content, entries, body });
    }
  }
  return records;
}

async function listSpecLifecycleDirs(root) {
  const entries = await readDirOrAbsent(path.join(root, SPEC_DOCS_DIR));
  const dirs = [];
  for (const name of entries.sort()) {
    const stat = await fs.stat(path.join(root, SPEC_DOCS_DIR, name));
    if (stat.isDirectory()) dirs.push(path.join(SPEC_DOCS_DIR, name));
  }
  return dirs;
}

function recordsById(records) {
  const index = new Map();
  for (const record of records) {
    if (record.id === null) continue;
    const matches = index.get(record.id) ?? [];
    matches.push(record);
    index.set(record.id, matches);
  }
  return index;
}

function projectionRows(body, heading) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return { missing: true, rows: [], malformed: [] };
  const section = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    section.push(lines[index]);
  }
  const rows = [];
  const malformed = [];
  for (const line of section) {
    if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) continue;
    const match = PROJECTION_ROW_PATTERN.exec(line);
    if (match === null) malformed.push(line);
    else
      rows.push({
        checked: match[1].toLowerCase() === 'x',
        id: match[2],
        status: match[3],
        taskPath: match[4],
      });
  }
  return { missing: false, rows, malformed };
}

function validateProjection({ parent, heading, expected }) {
  const findings = [];
  const projection = projectionRows(parent.body, heading);
  if (projection.missing) {
    findings.push(`missing ## ${heading} lifecycle projection`);
    return findings;
  }
  if (projection.malformed.length > 0) {
    findings.push(`malformed ## ${heading} row(s): ${projection.malformed.join(' | ')}`);
  }
  const expectedIds = new Set(expected.map((child) => child.id));
  for (const child of expected) {
    const matches = projection.rows.filter((row) => row.id === child.id);
    if (matches.length !== 1) {
      findings.push(`${heading} requires exactly one ${child.id} row; found ${matches.length}`);
      continue;
    }
    const [row] = matches;
    const terminal = child.lifecycle.state === 'terminal';
    if (
      row.checked !== terminal ||
      row.status !== child.lifecycle.status ||
      row.taskPath !== child.record.relative
    ) {
      findings.push(
        `${heading} ${child.id} row is stale; expected [${terminal ? 'x' : ' '}] ` +
          `${child.lifecycle.status} at ${child.record.relative}`,
      );
    }
  }
  for (const row of projection.rows) {
    if (!expectedIds.has(row.id))
      findings.push(`${heading} contains undeclared child row ${row.id}`);
  }
  return findings;
}

async function findAgreementProjectionFindings(root) {
  const taskRecords = await listMarkdownRecords(root, [TASKS_DIR, COMPLETED_DIR]);
  const specRecords = await listMarkdownRecords(root, await listSpecLifecycleDirs(root));
  const tasks = recordsById(taskRecords);
  const specs = recordsById(specRecords);
  const findings = [];
  const candidateIds = new Set();
  for (const spec of specRecords) {
    if (asScalar(spec.entries?.get('type')) === 'AGREEMENT' && spec.id !== null)
      candidateIds.add(spec.id);
  }
  for (const task of taskRecords) {
    if (task.entries?.has('children') && task.id !== null) candidateIds.add(task.id);
  }

  for (const agreementId of [...candidateIds].sort()) {
    const taskMatches = tasks.get(agreementId) ?? [];
    const specMatches = specs.get(agreementId) ?? [];
    const taskFile = taskMatches[0]?.relative ?? specMatches[0]?.relative ?? agreementId;
    if (specMatches.length !== 1) {
      findings.push({
        taskFile,
        reason: `${agreementId} requires exactly one paired spec; found ${specMatches.length}`,
      });
      continue;
    }
    if (taskMatches.length !== 1) {
      findings.push({
        taskFile,
        reason: `${agreementId} requires exactly one paired Task; found ${taskMatches.length}`,
      });
      continue;
    }

    const spec = specMatches[0];
    if (asScalar(spec.entries?.get('type')) !== 'AGREEMENT') {
      findings.push({
        taskFile,
        reason: `${agreementId} children declaration requires paired spec type: AGREEMENT`,
      });
      continue;
    }

    const task = taskMatches[0];
    const children = asList(task.entries?.get('children'));
    if (children.length === 0) {
      findings.push({
        taskFile,
        reason: `${agreementId} AGREEMENT Task requires a non-empty children declaration`,
      });
      continue;
    }
    if (new Set(children).size !== children.length) {
      findings.push({
        taskFile,
        reason: `${agreementId} children declaration contains duplicate IDs`,
      });
      continue;
    }
    if (children.includes(agreementId)) {
      findings.push({
        taskFile,
        reason: `${agreementId} children declaration must not reference itself`,
      });
      continue;
    }

    const resolved = [];
    for (const childId of children) {
      const matches = tasks.get(childId) ?? [];
      if (matches.length !== 1) {
        findings.push({
          taskFile,
          reason: `child ${childId} must resolve to exactly one Task; found ${matches.length}`,
        });
        continue;
      }
      const nestedAgreement = (specs.get(childId) ?? []).some(
        (candidate) => asScalar(candidate.entries?.get('type')) === 'AGREEMENT',
      );
      if (nestedAgreement) {
        findings.push({ taskFile, reason: `nested AGREEMENT child ${childId} is not supported` });
        continue;
      }
      const lifecycle = classifyTaskLifecycle(matches[0].content);
      if (!lifecycle.valid) {
        findings.push({
          taskFile,
          reason: `child ${childId} has invalid lifecycle: ${lifecycle.problems.join('; ')}`,
        });
        continue;
      }
      resolved.push({ id: childId, record: matches[0], lifecycle });
    }
    if (resolved.length !== children.length) continue;

    for (const reason of validateProjection({
      parent: task,
      heading: 'Children',
      expected: resolved,
    })) {
      findings.push({ taskFile, reason });
    }
    for (const reason of validateProjection({
      parent: spec,
      heading: 'Tasks',
      expected: resolved,
    })) {
      findings.push({ taskFile, reason });
    }

    const parentLifecycle = classifyTaskLifecycle(task.content);
    if (
      parentLifecycle.status === 'done' &&
      resolved.some((child) => child.lifecycle.status !== 'done')
    ) {
      findings.push({
        taskFile,
        reason: 'parent status: done requires every declared child to be status: done',
      });
    }
  }
  return findings;
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

  findings.push(...(await findAgreementProjectionFindings(root)));

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

  // An empty ACTIVE half is a legitimate state — every item archived — and the advisory below has
  // said so since HARNESS-063. But the marker is what the runner judges, and an undeclared zero
  // fails the suite: without this branch the scan would redden the suite in exactly the state it
  // already documents as correct. A prose sentence and a machine declaration are different things,
  // and having the first is not having the second.
  write(
    examined === 0
      ? `::examined:: 0 active task files ::expected-empty:: every task is archived under ${COMPLETED_DIR}/ (${archived} of them) — an empty active half is a finished backlog, not an unread one\n`
      : `::examined:: ${examined} active task files\n`,
  );

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
