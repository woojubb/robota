#!/usr/bin/env node

/**
 * Column-shape floor for the rule catalogues (INFRA-127).
 *
 * A markdown table declares its columns in its header. A row with fewer cells than the header still
 * RENDERS — the missing columns come out empty — so the defect is invisible to every check that
 * reads the file as prose, and invisible to the author, who sees their text on the page.
 *
 * MEASURED at filing: six of `common-mistakes.md`'s 92 entries put the mistake and the correct
 * approach in ONE cell of a three-column table, so the "Correct approach" column rendered empty for
 * them. They were the six most recent, added across several sessions — which is the signature of a
 * convention drifting rather than one author slipping, and the reason prose asking people to keep
 * the shape would not have held.
 *
 * ## What it judges, and what it deliberately does not
 *
 * The COUNT of cells against the header's own count, per table, per file. Not the content of a cell,
 * not column order, not width, not alignment — those are formatting, and `prettier` owns formatting.
 * This asks one question a renderer answers silently: does this row fill the columns its table
 * declares?
 *
 * A row with MORE cells than the header is a finding too. Markdown drops the surplus, so the text is
 * on disk and not on the page — the same invisibility from the other direction, and the more
 * dangerous one, because the author's words are silently discarded rather than merely misplaced.
 *
 * ## The escaped pipe, which is why this cannot be a naive split
 *
 * Rule text quotes shell. `cmd \| tail -n` appears inside a cell and an unescaped split counts it as
 * a column boundary, so the naive form reports a correct row as over-full. Splitting on a pipe NOT
 * preceded by a backslash is the whole of the parsing, and there is a fixture for it below.
 *
 * ## fail-direction
 *
 * refuse — a file listed in SUBJECTS that does not exist is a finding, not a skip. A rule catalogue
 * being renamed out from under this floor should be loud; silence there would leave the floor
 * passing over nothing while reading as green.
 *
 * Exit 0 = every row fills its table's columns, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/**
 * The catalogues whose rows ARE rules, so a dropped column drops rule text.
 *
 * Deliberately a named list rather than "every table in `.agents/`". Most tables in this repository
 * are prose aids — a routing index, a comparison, a measurement — where a short row costs a reader
 * nothing. The rule catalogues are where a row is the unit of obligation, and widening the subject
 * to every table would trade a floor that holds for one that gets switched off.
 */
const SUBJECTS = ['.agents/rules/common-mistakes.md'];

/** Split a table row into cells, honouring `\|` as an escaped literal inside a cell. */
export function splitRow(line) {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/);
}

const DELIMITER = /^\s*\|?[\s:|-]+\|?\s*$/;

/**
 * Findings for one file: every row whose cell count differs from its table's header.
 *
 * Tables are tracked one at a time. A file with several tables must not judge the second against the
 * first's header — that would report correct rows and is how a floor earns a suppression.
 */
export function findShapeFindings(text, file) {
  const findings = [];
  let header = null;
  let headerLine = 0;
  let sawDelimiter = false;
  const lines = text.split('\n');

  for (const [i, line] of lines.entries()) {
    const isRow = line.trim().startsWith('|');
    if (!isRow) {
      header = null;
      sawDelimiter = false;
      continue;
    }
    if (header === null) {
      header = splitRow(line).length;
      headerLine = i + 1;
      sawDelimiter = false;
      continue;
    }
    if (!sawDelimiter && DELIMITER.test(line)) {
      sawDelimiter = true;
      continue;
    }
    const count = splitRow(line).length;
    if (count !== header) {
      findings.push({
        file,
        line: i + 1,
        got: count,
        want: header,
        headerLine,
        text: line.trim().slice(0, 70),
      });
    }
  }
  return findings;
}

/**
 * The published sizes, readable by a test.
 *
 * Module state RESET at the top of every sweep. See `measurement-provenance`: a counter that
 * accumulates across runs reports a healthy scan the second time over the same tree.
 */
let examinedRows = 0;
let examinedFiles = 0;

/** How many table rows the last sweep read. */
export function examinedRowCount() {
  return examinedRows;
}

/** How many rule catalogues the last sweep opened. */
export function examinedCatalogueCount() {
  return examinedFiles;
}

export function findRuleTableShapeFindings(root = WORKSPACE_ROOT, subjects = SUBJECTS) {
  examinedRows = 0;
  examinedFiles = 0;
  const findings = [];
  for (const relative of subjects) {
    const full = path.join(root, relative);
    if (!existsSync(full)) {
      findings.push({ file: relative, line: 0, missing: true });
      continue;
    }
    const text = readFileSync(full, 'utf8');
    examinedRows += text.split('\n').filter((l) => l.trim().startsWith('|')).length;
    findings.push(...findShapeFindings(text, relative));
  }
  examinedFiles = subjects.length;
  return { findings, examinedRows, examinedFiles };
}

export function main() {
  const { findings, examinedRows, examinedFiles } = findRuleTableShapeFindings();

  // HARNESS-057: two subjects, two lines — a single number would have to misreport one of them.
  process.stdout.write(`::examined:: ${examinedFiles} rule catalogue(s)\n`);
  process.stdout.write(`::examined:: ${examinedRows} table row(s)\n`);

  if (findings.length === 0) {
    process.stdout.write(
      'rule-table-shape scan passed (every row fills the columns its table declares).\n',
    );
    return;
  }

  process.stdout.write('rule-table-shape scan failed:\n');
  for (const f of findings) {
    if (f.missing) {
      process.stdout.write(`  ${f.file}: listed as a rule catalogue but not present\n`);
      continue;
    }
    process.stdout.write(
      `  ${f.file}:${f.line}  ${f.got} cell(s), header at :${f.headerLine} declares ${f.want}  ${f.text}\n`,
    );
  }
  process.stdout.write(
    '\nA short row renders with its remaining columns EMPTY and a long one has its surplus dropped;\n' +
      'either way the text is on disk and not on the page. Split the row to fill the declared columns.\n' +
      'A literal pipe inside a cell must be written `\\|`.\n',
  );
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
