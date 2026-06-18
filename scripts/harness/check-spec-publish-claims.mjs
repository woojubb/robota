#!/usr/bin/env node

/**
 * Check that no package SPEC.md claims npm publication while the package is private.
 *
 * Guard G4 (architecture audit 2026-06-19, AF-15). agent-tool-mcp SPEC said "published to
 * npm" while package.json had `"private": true`.
 *
 * Rule: a SPEC line asserting npm publication (and not negating it) is a finding when the
 * package's package.json has `private: true`.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const PUBLISH_CLAIM = /\bpublish(?:ed|es)?\b[^.\n]*\bnpm\b/i;
const NEGATED = /\b(not|never|un-?published|internal|private|do(?:es)? not)\b/i;

export async function findPublishClaimFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return findings;

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgDir = path.join(packagesDir, entry.name);
    const specPath = path.join(pkgDir, 'docs', 'SPEC.md');
    const pkgJsonPath = path.join(pkgDir, 'package.json');
    if (!existsSync(specPath) || !existsSync(pkgJsonPath)) continue;

    const isPrivate = JSON.parse(readFileSync(pkgJsonPath, 'utf8')).private === true;
    if (!isPrivate) continue;

    const lines = readFileSync(specPath, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (PUBLISH_CLAIM.test(line) && !NEGATED.test(line)) {
        findings.push({
          file: path.relative(root, specPath),
          type: 'spec-false-publish-claim',
          detail: `line ${i + 1} claims npm publication but package.json has "private": true.`,
        });
      }
    });
  }
  return findings;
}

export async function main() {
  const findings = await findPublishClaimFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('spec publish-claim scan passed.\n');
    return;
  }
  process.stdout.write('spec publish-claim scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
