#!/usr/bin/env node

/**
 * Design / LLD document STRUCTURE completeness gate (RULE-009).
 *
 * The design/LLD type owns component-internal realization. This guard validates the STRUCTURE of any
 * design doc that EXISTS — it does NOT assert that a doc must exist (the "when required" judgment is
 * process guidance in the `design-doc-authoring` skill, not mechanically detectable).
 *
 * Scope: package-local design docs under `packages/<pkg>/docs/design/**.md`. (Cross-cutting design
 * docs under `.agents/specs/` are validated when explicitly passed as an argument; they are not
 * auto-discovered because that folder also holds non-design specs.)
 *
 *   MUST sections (blocking): Context & Goal, Constraints, Internal Structure, Key Flows, Test Approach.
 *   SHOULD (warning): a link to the owning SPEC.md.
 *
 * Usage: `node scripts/harness/check-design-doc-completeness.mjs [path-to-dir-or-file]`
 * Exit code 0 = clean (warnings allowed; no design docs = vacuously clean), 1 = blocking findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const PACKAGES_DIR = path.join(WORKSPACE_ROOT, 'packages');

const MUST_SECTIONS = [
  { label: 'Context & Goal', re: /^##\s+Context\b/im },
  { label: 'Constraints', re: /^##\s+Constraints\b/im },
  { label: 'Internal Structure', re: /^##\s+Internal Structure\b/im },
  { label: 'Key Flows', re: /^##\s+Key Flows\b/im },
  { label: 'Test Approach', re: /^##\s+Test Approach\b/im },
];
const SPEC_LINK = /\]\([^)]*SPEC\.md[^)]*\)/;

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Discover package-local design docs: packages/<pkg>/docs/design/**.md */
function discoverDesignDocs() {
  if (!existsSync(PACKAGES_DIR)) return [];
  const out = [];
  for (const pkg of readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    out.push(...walkMarkdown(path.join(PACKAGES_DIR, pkg.name, 'docs', 'design')));
  }
  return out;
}

export function findDesignDocFindings(target) {
  const blocking = [];
  const warnings = [];
  let files;
  if (target) {
    files = existsSync(target) && statSync(target).isFile() ? [target] : walkMarkdown(target);
  } else {
    files = discoverDesignDocs();
  }
  for (const file of files) {
    const rel = path.relative(WORKSPACE_ROOT, file);
    const text = readFileSync(file, 'utf8');
    for (const s of MUST_SECTIONS) {
      if (!s.re.test(text)) blocking.push({ file: rel, detail: `missing "## ${s.label}" section` });
    }
    if (!SPEC_LINK.test(text)) {
      warnings.push({ file: rel, detail: 'no link to the owning SPEC.md — recommended' });
    }
  }
  return { blocking, warnings };
}

export function main(argv = process.argv) {
  const arg = argv[2];
  const target = arg ? path.resolve(WORKSPACE_ROOT, arg) : undefined;
  const { blocking, warnings } = findDesignDocFindings(target);
  for (const w of warnings) process.stdout.write(`- [warn] ${w.file}: ${w.detail}\n`);
  if (blocking.length === 0) {
    process.stdout.write('design-doc completeness scan passed.\n');
    return;
  }
  process.stdout.write('design-doc completeness scan failed:\n');
  for (const f of blocking) process.stdout.write(`- [missing-section] ${f.file}: ${f.detail}\n`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
