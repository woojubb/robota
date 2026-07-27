#!/usr/bin/env node

/**
 * Spec-document folder ↔ status agreement floor (HARNESS-049).
 *
 * THE GAP THIS CLOSES, measured. `.agents/rules/spec-workflow.md`
 * § Spec-Document Status and Lifecycle Folders states that "a gate PASS that changes the status and
 * the folder does both or neither" — but the only force behind it was a prose sentence saying the
 * mismatch is NON-COMPLIANCE *on the document's next gate run*. A document that has already reached
 * `done/` has no next gate run, so for that population the mandate was unenforceable by construction.
 * Six documents demonstrate it on the live tree: `INFRA-016`, `INFRA-019`, `INFRA-020` sit in
 * `spec-docs/done/` at `status: draft`, `PM-026` and `PM-030` at `approved`, `DATA-002` at
 * `in-progress`. Five of the six carry a recorded `[GATE-COMPLETE] — ✅ PASS` entry in their own
 * Evidence Log, so their frontmatter contradicts their own evidence.
 *
 * Distinct from `check-spec-doc-frontmatter.mjs`, deliberately. That gate validates a status VALUE
 * (is it one of the seven?); this one validates the RELATION between that value and the document's
 * location. A doc with no frontmatter, or a status outside the vocabulary, is that gate's finding and
 * is skipped here — one finding per defect, reported by its owner.
 *
 * THE MAPPING IS NOT COPIED HERE. `spec-workflow.md` owns it (AGENTS.md: one owner per fact), so this
 * scan PARSES the rule's table and derives the expected folder for each status. A second hard-coded
 * copy is exactly the drift this repo's document-authority rules exist to prevent, and it would fail
 * silently the first time the rule gained a status. The parse is FAIL-CLOSED: an unreadable or empty
 * table exits 1 rather than passing vacuously, because a floor that cannot read its own criteria has
 * not verified anything.
 *
 * `in-progress` and `verifying` share `active/` — the mapping is status → folder, many-to-one, and
 * the reverse direction is deliberately NOT checked.
 *
 * Usage: `node scripts/harness/scan-doc-folder-status-agreement.mjs [spec-docs-dir] [rule-file]`
 * Exit code 0 = every document's folder agrees with its status, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { frontmatterObject } from './frontmatter.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const SPEC_DIR = path.join(WORKSPACE_ROOT, '.agents/spec-docs');
const RULE_FILE = path.join(WORKSPACE_ROOT, '.agents/rules/spec-workflow.md');

/** The rule heading whose table owns the mapping. */
const MAPPING_HEADING = 'Spec-Document Status and Lifecycle Folders';

/** A mapping row: `| `draft` | `.agents/spec-docs/draft/` | … |`. */
const MAPPING_ROW = /^\|\s*`([a-z][a-z-]*)`\s*\|\s*`\.agents\/spec-docs\/([a-z][a-z-]*)\/`\s*\|/;

/**
 * Derive `status -> folder` from the rule's own table.
 *
 * Scoped to the section under MAPPING_HEADING so a future table elsewhere in the rule cannot
 * contribute rows. Returns an empty Map when the heading or the table is missing — the caller
 * treats that as a failure, never as "nothing to check".
 */
export function parseStatusFolderMapping(ruleText) {
  const mapping = new Map();
  let inSection = false;
  for (const line of String(ruleText ?? '').split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      inSection = line.includes(MAPPING_HEADING);
      continue;
    }
    if (!inSection) continue;
    const match = MAPPING_ROW.exec(line);
    if (match) mapping.set(match[1], match[2]);
  }
  return mapping;
}

/** Every spec document, as a path relative to the spec-docs root. README.md is not a spec document. */
function specDocuments(dir, prefix = '') {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...specDocuments(path.join(dir, entry.name), relative));
    else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
      out.push(relative);
  }
  return out;
}

/**
 * Findings for one tree. Each is `{ file, status, actualFolder, expectedFolder }`.
 *
 * A document whose status is absent or outside the mapping is SKIPPED (that is
 * `check-spec-doc-frontmatter`'s finding, not this one). A document sitting directly in the
 * spec-docs root is reported: it is in no lifecycle folder at all.
 */
export function findFolderStatusFindings(specDir = SPEC_DIR, mapping) {
  const findings = [];
  for (const relative of specDocuments(specDir)) {
    const segments = relative.split('/');
    const actualFolder = segments.length > 1 ? segments[0] : null;
    const status = frontmatterObject(readFileSync(path.join(specDir, relative), 'utf8')).status;
    if (typeof status !== 'string' || !mapping.has(status)) continue;
    const expectedFolder = mapping.get(status);
    if (actualFolder !== expectedFolder) {
      findings.push({ file: relative, status, actualFolder, expectedFolder });
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file));
}

function main() {
  const specDir = process.argv[2] ? path.resolve(process.argv[2]) : SPEC_DIR;
  const ruleFile = process.argv[3] ? path.resolve(process.argv[3]) : RULE_FILE;

  if (!existsSync(ruleFile)) {
    console.error(`❌ Folder/status mapping owner not found: ${path.relative(WORKSPACE_ROOT, ruleFile)}`);
    process.exit(1);
  }
  const mapping = parseStatusFolderMapping(readFileSync(ruleFile, 'utf8'));
  if (mapping.size === 0) {
    console.error(
      `❌ Could not read the status ↔ folder table from ${path.relative(WORKSPACE_ROOT, ruleFile)} ` +
        `§ ${MAPPING_HEADING}. The floor derives its criteria from that table and refuses to pass ` +
        `without them.`,
    );
    process.exit(1);
  }
  if (!existsSync(specDir) || !statSync(specDir).isDirectory()) {
    console.error(`❌ Spec-doc directory not found: ${path.relative(WORKSPACE_ROOT, specDir)}`);
    process.exit(1);
  }

  const findings = findFolderStatusFindings(specDir, mapping);
  if (findings.length === 0) {
    console.log(
      `✅ Folder ↔ status agreement: every spec document sits in the folder its status maps to ` +
        `(${mapping.size} statuses).`,
    );
    console.log('doc-folder-status-agreement summary: violations=0 result=PASS');
    return;
  }

  console.error('❌ Spec documents whose folder disagrees with their `status:` frontmatter:\n');
  for (const { file, status, actualFolder, expectedFolder } of findings) {
    const where = actualFolder ? `${actualFolder}/` : '(spec-docs root)';
    console.error(`  ${file}`);
    console.error(`    status: ${status} → expected ${expectedFolder}/, found ${where}`);
  }
  console.error(
    `\nspec-workflow.md § ${MAPPING_HEADING}: a gate PASS that changes the status and the folder ` +
      `does both or neither. Fix each by correcting the status to the one its Evidence Log records, ` +
      `or by moving the document to the folder its status maps to.`,
  );
  console.error(`doc-folder-status-agreement summary: violations=${findings.length} result=FAIL`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
