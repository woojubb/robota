#!/usr/bin/env node

/**
 * Whitebox-leakage advisory scan for package SPEC.md files (RULE-013, WU-A).
 *
 * A package `SPEC.md` is a BLACKBOX contract — what the package promises to consumers. Its internal
 * realization (module decomposition, render pipelines, internal state transitions) belongs in
 * `docs/design/`, per the consumer-impact test owned by
 * `.agents/skills/design-doc-authoring/SKILL.md` > "Placement criterion".
 *
 * When whitebox material accumulates inside the contract document, two things follow: the contract
 * churns on every internal refactor, so the Live Spec update mandate becomes expensive enough that
 * drift is structurally guaranteed; and the actual contract becomes unfindable inside it
 * (`agent-cli`'s Public API table was 9 lines of a 1,939-line document). This scan measures how much
 * of each SPEC sits outside the standard sections and reports the outliers.
 *
 * ADVISORY, on purpose. Whether a given section is whitebox is a semantic judgement no regex makes;
 * the scan measures a proxy (share of the document outside the standard section set) and hands the
 * judgement to a reader. It never blocks.
 *
 * THRESHOLD: >= MIN_LINES absolute AND >= MIN_RATIO share. Both, because either alone misfires — a
 * small file can be 100% non-standard and still be a few lines, and a large file can carry 400
 * unremarkable lines. At introduction this flags exactly the two files whose contents were read by
 * hand and confirmed to be design documents appended to a contract.
 *
 * QUIET ON THE HAPPY PATH. Only above-threshold findings and the `::examined::` line go to stdout;
 * the full ranked table is behind `--report-file` / `--all`. A guard that narrates on every run is
 * one everyone learns to scroll past, after which its refusals scroll past too
 * (enforcement-architecture.md property 4).
 *
 * ENUMERATION AND MATCHING ARE BOTH DELEGATED, deliberately:
 * - `listWorkspacePackageDirs()` owns "which workspaces exist" — a hand-written depth-1 glob misses
 *   the nested `packages/dag-nodes/*` group entirely (20 files, 1,122 lines).
 * - `spec-sections.mjs` owns the section list and the heading normalizer — exact string matching
 *   scored `apps/www` and `packages/agent-transport` at 100% non-standard when both carry all nine
 *   required sections under ordinal prefixes.
 *
 * Exit code 0 = clean or advisory findings only, 1 = the scan could not read its own criteria.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { ADVISORY_MARKER, EXAMINED_MARKER } from './run-all-scans.mjs';
import { normalizeSpecHeading, readSpecSectionContract } from './spec-sections.mjs';
import { listWorkspacePackageDirs } from './workspace-packages.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Both conditions must hold for a row to become a finding. See THRESHOLD above. */
const MIN_LINES = 300;
const MIN_RATIO = 0.4;

/**
 * Line span of every `##` section, split by whether its heading names a standard section.
 * Content before the first `##` (title, intro) counts as standard — it is not a leaked section.
 *
 * BLIND SPOT (HARNESS-052 G8): only `##` creates a span, so every `###` is attributed to its enclosing
 * `##`. Demoting a non-standard `##` to `###` under a standard one drives the residual to zero WITHOUT
 * moving a line. This measures heading conformance, not placement — which is why it is advisory, and
 * why no acceptance criterion should be written against its number alone. To prove a split actually
 * moved content, use `verify-doc-split-preservation.mjs` and assert on the destination documents.
 */
export function measure(content, contract) {
  const lines = content.split(/\r?\n/);
  const marks = [];
  lines.forEach((line, index) => {
    if (/^##\s+/.test(line)) marks.push({ index, name: normalizeSpecHeading(line) });
  });

  let nonStandard = 0;
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? marks[i + 1].index : lines.length;
    if (!contract.all.has(marks[i].name)) nonStandard += end - marks[i].index;
  }

  return { total: lines.length, nonStandard };
}

/**
 * The declared counter (`::examined:: N package SPEC.md files`) as an exported, testable value.
 *
 * `dirs` is injectable so a test can assert an EXACT count against a fixture of known size rather
 * than against a corpus that grows — a bound would admit an over-count, and a live count cannot tell
 * an accumulating counter apart from a growing subject (measurement-provenance.md).
 */
export function collectRows(root, contract, dirs = listWorkspacePackageDirs(root)) {
  // HARNESS-052: the finder itself must refuse a root it cannot judge. Without this, a root with no
  // packages yields an empty row list and the scan reports a clean corpus it never read.
  requireGovernedTree(root, ['.agents/skills', 'packages'], {
    scan: 'spec-whitebox-leakage',
    why: 'the standard section list is parsed from the skill that owns it, and the corpus is the workspace packages.',
  });
  const rows = [];
  for (const dir of dirs) {
    const specPath = path.join(dir, 'docs', 'SPEC.md');
    if (!existsSync(specPath)) continue;
    rows.push({
      relative: path.relative(root, specPath),
      ...measure(readFileSync(specPath, 'utf8'), contract),
    });
  }
  for (const row of rows) row.ratio = row.total > 0 ? row.nonStandard / row.total : 0;
  rows.sort((a, b) => b.nonStandard - a.nonStandard);
  return rows;
}

/**
 * The declared size, as a reader a test can call (`measurement-provenance.md` naming convention).
 * Same injectable `dirs` as `collectRows`, so the value can be asserted exactly against a fixture.
 */
export function examinedSpecCount(root, contract, dirs = listWorkspacePackageDirs(root)) {
  return collectRows(root, contract, dirs).length;
}

function main() {
  const args = process.argv.slice(2);
  const showAll = args.includes('--all');
  const reportFlag = args.indexOf('--report-file');
  const reportFile = reportFlag !== -1 ? args[reportFlag + 1] : null;

  let contract;
  try {
    contract = readSpecSectionContract(WORKSPACE_ROOT);
  } catch (error) {
    // Fail-closed. Reporting "no leakage" because the criteria were unreadable would be the exact
    // vacuous green this scan exists to prevent.
    console.error(`spec-whitebox-leakage: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const rows = collectRows(WORKSPACE_ROOT, contract);
  const findings = rows.filter((row) => row.nonStandard >= MIN_LINES && row.ratio >= MIN_RATIO);

  const format = (row) =>
    `${row.relative}: ${row.nonStandard}/${row.total} lines (${(row.ratio * 100).toFixed(1)}%) ` +
    'outside the standard sections';

  for (const row of findings) {
    console.log(`${ADVISORY_MARKER} ${format(row)} — consider extracting to docs/design/`);
  }

  const table = rows.map(format).join('\n');
  if (showAll) console.log(table);
  if (reportFile) {
    writeFileSync(path.resolve(WORKSPACE_ROOT, reportFile), `${table}\n`, 'utf8');
    console.log(`spec-whitebox-leakage: full ranked table written to ${reportFile}`);
  }

  const totalLines = rows.reduce((sum, row) => sum + row.total, 0);
  const totalNonStandard = rows.reduce((sum, row) => sum + row.nonStandard, 0);
  console.log(
    `${EXAMINED_MARKER} ${rows.length} package SPEC.md files ` +
      `(${totalNonStandard}/${totalLines} lines outside the standard sections, ` +
      `${((totalNonStandard / totalLines) * 100).toFixed(1)}%; ${findings.length} above threshold)`,
  );
}

// Importing a harness script must do nothing (HARNESS-065). The `file://` string comparison is the
// idiom that breaks on paths containing escapable characters; this is the sanctioned one.
if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
