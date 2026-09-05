#!/usr/bin/env node

/** Validate the machine-readable exception used when a gate tool defect blocks closure. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const ROOT = resolveWorkspaceRoot(import.meta);
const EXAMINED = ['::', 'examined::'].join('');
const SPEC_ROOT = path.join(ROOT, '.agents/spec-docs');
export const CLOSED_UNDER =
  /^\*\*Closed under:\*\* `tool-defect` — ([^;]+); gate `([^`]+)`; defect record `([^`]+)`; evidence `([^`]+)`$/;

function documents(dir) {
  if (!readdirSync(dir, { withFileTypes: true })) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return documents(full);
    return entry.isFile() && entry.name.endsWith('.md') ? [full] : [];
  });
}

export function dispositionFindings(root = ROOT) {
  const specs = documents(path.join(root, '.agents/spec-docs'));
  const findings = [];
  for (const file of specs) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const matches = lines.filter((line) => line.startsWith('**Closed under:**'));
    if (matches.length > 1)
      findings.push({
        file: path.relative(root, file),
        detail: 'more than one Closed under disposition',
      });
    for (const line of matches) {
      if (!CLOSED_UNDER.test(line))
        findings.push({
          file: path.relative(root, file),
          detail: `malformed Closed under disposition: ${line}`,
        });
    }
  }
  return findings;
}

export function main() {
  const findings = dispositionFindings();
  process.stdout.write(`${EXAMINED} ${documents(SPEC_ROOT).length} gate spec document(s)\n`);
  if (findings.length === 0) {
    process.stdout.write('gate-closure-disposition scan passed.\n');
    return 0;
  }
  process.stdout.write('gate-closure-disposition scan failed:\n');
  for (const finding of findings)
    process.stdout.write(`- [gate-closure-disposition] ${finding.file}: ${finding.detail}\n`);
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename))
  process.exitCode = main();
