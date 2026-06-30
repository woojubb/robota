#!/usr/bin/env node

/**
 * Keep the document-standards index (`.agents/specs/document-standards/index.md`) honest.
 *
 * Owning spec: RULE-007. The index is the router for every design/architecture document type
 * (the artifact taxonomy). This guard's scope is exactly that one file:
 *
 *  A. Link integrity — every repo-relative markdown link in the index resolves to a real file or
 *     directory (no ghost pointers). Same axis as `check-architecture-map-paths.mjs`, scoped to the
 *     index instead of the architecture-map family.
 *  B. Taxonomy integrity — in the artifact-taxonomy table, every row's `Status` is one of
 *     defined / partial / gap, and every partial/gap row names a non-empty follow-on.
 *
 * Out-of-scope findings (e.g. a stale pointer in some other doc) are filed as backlog, not folded in
 * here (harness-governance scope discipline).
 *
 * Usage: `node scripts/harness/check-document-standards-index.mjs [path-to-index]`
 *        (path defaults to the real index; a fixture path is used by the self-test).
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const DEFAULT_INDEX = path.join(WORKSPACE_ROOT, '.agents/specs/document-standards/index.md');

const LINK_PATTERN = /\[[^\]]*\]\(([^)]+)\)/g;
const STATUS_ENUM = new Set(['defined', 'partial', 'gap']);
const EMPTY_CELL = /^(?:—|-|–|n\/a|none)?$/i;

function isExternalOrAnchor(target) {
  return /^(?:https?:|mailto:|#)/i.test(target);
}

/** A. Every repo-relative markdown link target resolves, relative to the index file's directory. */
function checkLinkIntegrity(indexPath, lines, findings) {
  const baseDir = path.dirname(indexPath);
  lines.forEach((line, i) => {
    for (const match of line.matchAll(LINK_PATTERN)) {
      const raw = match[1].trim();
      if (!raw || isExternalOrAnchor(raw)) continue;
      const target = raw.split('#')[0]; // strip in-page anchor
      if (!target) continue;
      const resolved = path.resolve(baseDir, target);
      if (!existsSync(resolved)) {
        findings.push({
          type: 'ghost-pointer',
          detail: `line ${i + 1}: link target "${raw}" does not resolve (${path.relative(WORKSPACE_ROOT, resolved)}).`,
        });
      }
    }
  });
}

/** Parse the first markdown table whose header includes "Document type" and "Status". */
function findTaxonomyTable(lines) {
  const rows = [];
  let header = null;
  let inTable = false;
  for (const line of lines) {
    const isRow = /^\s*\|.*\|\s*$/.test(line);
    if (!isRow) {
      if (inTable) break; // table ended
      continue;
    }
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (!header) {
      if (cells.some((c) => /document type/i.test(c)) && cells.some((c) => /status/i.test(c))) {
        header = cells;
        inTable = true;
      }
      continue;
    }
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue; // separator row
    rows.push(cells);
  }
  return { header, rows };
}

/** B. Status enum + follow-on presence for partial/gap rows. */
function checkTaxonomyIntegrity(lines, findings) {
  const { header, rows } = findTaxonomyTable(lines);
  if (!header) {
    findings.push({ type: 'taxonomy-missing', detail: 'no artifact-taxonomy table found.' });
    return;
  }
  const statusIdx = header.findIndex((c) => /status/i.test(c));
  const followIdx = header.findIndex((c) => /follow-?on/i.test(c));
  const typeIdx = header.findIndex((c) => /document type/i.test(c));
  for (const row of rows) {
    const docType = (row[typeIdx] ?? '').replace(/[`*]/g, '').trim() || '(unnamed row)';
    const status = (row[statusIdx] ?? '').replace(/[`*]/g, '').trim().toLowerCase();
    if (!STATUS_ENUM.has(status)) {
      findings.push({
        type: 'bad-status',
        detail: `"${docType}": status "${status}" is not one of defined/partial/gap.`,
      });
      continue;
    }
    if ((status === 'partial' || status === 'gap') && followIdx >= 0) {
      const follow = (row[followIdx] ?? '').replace(/[`*]/g, '').trim();
      if (EMPTY_CELL.test(follow)) {
        findings.push({
          type: 'missing-follow-on',
          detail: `"${docType}": status ${status} but no follow-on named.`,
        });
      }
    }
  }
}

export function findDocumentStandardsFindings(indexPath = DEFAULT_INDEX) {
  const findings = [];
  if (!existsSync(indexPath)) {
    findings.push({ type: 'index-missing', detail: `${indexPath} does not exist.` });
    return findings;
  }
  const lines = readFileSync(indexPath, 'utf8').split('\n');
  checkLinkIntegrity(indexPath, lines, findings);
  checkTaxonomyIntegrity(lines, findings);
  return findings;
}

export function main(argv = process.argv) {
  const arg = argv[2];
  const indexPath = arg ? path.resolve(WORKSPACE_ROOT, arg) : DEFAULT_INDEX;
  const findings = findDocumentStandardsFindings(indexPath);
  if (findings.length === 0) {
    process.stdout.write('document-standards index scan passed.\n');
    return;
  }
  process.stdout.write('document-standards index scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
