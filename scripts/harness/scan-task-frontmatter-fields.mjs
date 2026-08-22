#!/usr/bin/env node

/**
 * Required-field floor for Task records (INFRA-127).
 *
 * `.agents/tasks/README.md` § "File Format" declares seven fields REQUIRED at the top of every Task
 * file. Only one of them was mechanically checked. `check-backlog-placement` and
 * `check-task-archival` both read `status:` — placement and lifecycle — and neither asks whether the
 * other six are present at all, so a record could omit `urgency`, `area` and `depends_on` and pass
 * the whole suite.
 *
 * MEASURED at filing, over 108 active records: four omit required fields, and three of those carry
 * an `id:` / `type:` pair the declared schema does not mention — an older shape with no owner and no
 * check, sitting beside 105 records that follow the current one. A contract 97% of the tree obeys is
 * worth the twenty lines that make the remaining 3% visible.
 *
 * ## What it does NOT judge
 *
 * PRESENCE, not content. Whether `area` names the right packages, whether `priority` is honest, and
 * whether `depends_on` lists every blocker are judgements no regex makes, and a scan that pretended
 * to make them would be measuring the wrong thing. `status` VALUE is checked because the vocabulary
 * is closed and its two consumers already depend on it; every other field is asked only to exist and
 * be non-blank.
 *
 * A blank value is a finding rather than a pass. `area:` with nothing after it satisfies "the key is
 * present" while telling the next reader nothing, and the failure this floor exists to stop is a
 * record that looks complete to a grep.
 *
 * ## fail-direction
 *
 * refuse — a file whose frontmatter cannot be read is reported, not skipped. "I could not parse it"
 * is not "it has the fields", and permitting on an unreadable block would make a malformed block the
 * way past the floor.
 *
 * ## No baseline, deliberately
 *
 * The four records failing when this was written were FIXED in the same change rather than frozen,
 * so this lands as a hard floor with no exception list. A burn-down would have been machinery with
 * nothing to burn down, and an empty exception file is an invitation to put the first entry in it.
 * If a record ever needs an exemption, add the mechanism then, with that record as its reason.
 *
 * Parsing goes through `frontmatter.mjs`, the declared SSOT — `frontmatter-parser-ssot` refuses a
 * re-forked `^<key>:` regex, and it is right to: the per-line form reads a prettier-reflowed
 * `depends_on: [` flow array as empty, which is 441 files here.
 *
 * Exit 0 = every record carries the declared fields, 1 = findings.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { frontmatterObject, isBlank } from './frontmatter.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** The seven `.agents/tasks/README.md` § "File Format" declares required. */
const REQUIRED = ['title', 'status', 'created', 'priority', 'urgency', 'area', 'depends_on'];

/** Open and terminal statuses, from the same section. `blocked` is open and README says so. */
const STATUSES = new Set([
  'todo',
  'in-progress',
  'blocked',
  'done',
  'wontfix',
  'skipped',
  'superseded',
]);

/**
 * Active records only. `completed/` is a different population with its own scans.
 *
 * THROWS when the tree is absent rather than returning an empty list. Measured while classifying
 * this scan for `guard-scope-fail-closed`: the empty-list form made `findTaskFrontmatterFindings`
 * return zero findings over a root with no `.agents/tasks`, which reads as "every record carries its
 * fields" when nothing was read. `main()` had a fail-closed branch, but the guard tests the exported
 * FINDER, and the finder is what another caller gets — so the check lives here, where every caller
 * reaches it.
 */
export function activeTaskFiles(root = WORKSPACE_ROOT) {
  const dir = path.join(root, '.agents/tasks');
  if (!existsSync(dir)) throw new Error(`.agents/tasks missing from ${root}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map((f) => path.join(dir, f));
}

export function judgeRecord(name, text) {
  const problems = [];
  const front = frontmatterObject(text);
  if (front === null || Object.keys(front).length === 0) {
    problems.push('no readable YAML frontmatter block');
    return problems;
  }
  const missing = REQUIRED.filter((k) => !(k in front));
  if (missing.length > 0) problems.push(`missing required field(s): ${missing.join(', ')}`);

  // `depends_on: []` is a legitimate empty LIST and must not read as a blank value; every other
  // required field is prose and blank means absent in everything but the grep.
  for (const key of REQUIRED) {
    if (!(key in front) || key === 'depends_on') continue;
    if (isBlank(front[key])) problems.push(`\`${key}:\` is present but blank`);
  }

  const status = String(front.status ?? '')
    .trim()
    .replace(/^['"]|['"]$/g, '');
  if (status && !STATUSES.has(status)) problems.push(`unknown status \`${status}\``);
  return problems;
}

/**
 * The published size, readable by a test.
 *
 * Module state RESET at the top of every sweep, not accumulated. `measurement-provenance` asks for
 * the reset specifically, and the reason is the failure it was built for: a counter that only ever
 * rises reports a healthy scan on its second run in the same process while examining the same tree.
 */
let examinedRecords = 0;

/** How many active task records the last sweep read. */
export function examinedRecordCount() {
  return examinedRecords;
}

export function findTaskFrontmatterFindings(root = WORKSPACE_ROOT) {
  examinedRecords = 0;
  const findings = [];
  const files = activeTaskFiles(root);
  examinedRecords = files.length;
  for (const file of files) {
    const name = path.basename(file);
    const problems = judgeRecord(name, readFileSync(file, 'utf8'));
    if (problems.length > 0) findings.push({ name, problems });
  }
  return { findings, examined: files.length };
}

export function main() {
  let findings;
  let examined;
  try {
    ({ findings, examined } = findTaskFrontmatterFindings());
  } catch (error) {
    process.stdout.write('::examined:: 0 task records\n');
    process.stderr.write(
      `task-frontmatter-fields scan FAILED — ${error.message}, so nothing was read. A pass over a ` +
        'directory that is not there is a pass over nothing.\n',
    );
    process.exitCode = 1;
    return;
  }

  // HARNESS-057: report the size of the subject. A zero here is only meaningful beside it, and an
  // empty tasks directory is refused above rather than excused as expected-empty.
  process.stdout.write(`::examined:: ${examined} active task record(s)\n`);

  if (findings.length === 0) {
    process.stdout.write(
      `task-frontmatter-fields scan passed (${examined} record(s); each carries the seven fields ` +
        '`.agents/tasks/README.md` declares required).\n',
    );
    return;
  }

  process.stdout.write('task-frontmatter-fields scan failed:\n');
  for (const f of findings) {
    for (const p of f.problems) process.stdout.write(`  ${f.name}: ${p}\n`);
  }
  process.stdout.write(
    '\nThe required set is `title, status, created, priority, urgency, area, depends_on`\n' +
      '(.agents/tasks/README.md § "File Format"). Add the field to the record. This floor has no\n' +
      'exception list on purpose — see "No baseline, deliberately" in this file.\n',
  );
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
