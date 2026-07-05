#!/usr/bin/env node

/**
 * ADR completeness gate (RULE-010).
 *
 * Over `.design/decisions/ADR-*.md`, assert each ADR carries the MUST sections and a legal Status.
 * The `architecture-decision-records` skill owns the template/content; this guard enforces presence
 * (no duplication).
 *
 *   MUST sections (blocking): Status, Context, Alternatives Considered, Decision, Consequences.
 *   Status value (blocking): one of proposed / accepted / superseded / rejected / deprecated.
 *
 * Usage: `node scripts/harness/check-adr-completeness.mjs [path-to-dir-or-file]`
 * Exit code 0 = clean (no ADRs = vacuously clean), 1 = blocking findings.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const ADR_DIR = path.join(WORKSPACE_ROOT, '.design/decisions');

const MUST_SECTIONS = [
  /^##\s+Status\b/im,
  /^##\s+Context\b/im,
  /^##\s+Alternatives Considered\b/im,
  /^##\s+Decision\b/im,
  /^##\s+Consequences\b/im,
];
const SECTION_LABELS = ['Status', 'Context', 'Alternatives Considered', 'Decision', 'Consequences'];
const STATUS_VALUES = ['proposed', 'accepted', 'superseded', 'rejected', 'deprecated'];

function adrFiles(target) {
  if (target) {
    if (existsSync(target) && statSync(target).isFile()) return [target];
    if (existsSync(target))
      return readdirSync(target)
        .filter((f) => /^ADR-.*\.md$/.test(f) || f.endsWith('.md'))
        .map((f) => path.join(target, f));
    return [];
  }
  if (!existsSync(ADR_DIR)) return [];
  return readdirSync(ADR_DIR)
    .filter((f) => /^ADR-.*\.md$/.test(f))
    .map((f) => path.join(ADR_DIR, f));
}

export function findAdrFindings(target) {
  const findings = [];
  for (const file of adrFiles(target)) {
    const rel = path.relative(WORKSPACE_ROOT, file);
    const text = readFileSync(file, 'utf8');
    MUST_SECTIONS.forEach((re, i) => {
      if (!re.test(text))
        findings.push({ file: rel, detail: `missing "## ${SECTION_LABELS[i]}" section` });
    });
    // Status value: the first non-empty line under `## Status`.
    const statusMatch = text.match(/^##\s+Status\b[^\n]*\n+([^\n]+)/im);
    if (statusMatch) {
      const value = statusMatch[1].toLowerCase();
      if (!STATUS_VALUES.some((v) => value.includes(v))) {
        findings.push({
          file: rel,
          detail: `Status "${statusMatch[1].trim()}" is not one of ${STATUS_VALUES.join(' / ')}.`,
        });
      }
    }
  }
  return findings;
}

export function main(argv = process.argv) {
  const arg = argv[2];
  const target = arg ? path.resolve(WORKSPACE_ROOT, arg) : undefined;
  const findings = findAdrFindings(target);
  if (findings.length === 0) {
    process.stdout.write('ADR completeness scan passed.\n');
    return;
  }
  process.stdout.write('ADR completeness scan failed:\n');
  for (const f of findings) process.stdout.write(`- [adr] ${f.file}: ${f.detail}\n`);
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
