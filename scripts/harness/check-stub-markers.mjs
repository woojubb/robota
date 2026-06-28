#!/usr/bin/env node

/**
 * Check that publishable package sources contain no stub markers.
 *
 * Lesson source: @robota-sdk/agent-tool-mcp shipped to npm with
 * "TODO: Implement" / "Not implemented" in its core execution path
 * (HARNESS-008, 2026-06-11).
 *
 * Rules:
 * - Applies to packages/<name>/src of packages without `"private": true`.
 * - Test files (__tests__/, *.test.*, *.spec.*) are exempt.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

// "placeholder for actual" caught shipped, consumed storage classes that only
// logged a warning and returned a stub value (silent data loss) — PLUGIN-001.
const STUB_MARKERS = [
  'TODO: Implement',
  'Not implemented',
  'NotImplementedError',
  'placeholder for actual',
];

function walkSources(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      files.push(...walkSources(full));
    } else if (entry.isFile()) {
      if (!/\.(ts|tsx|mjs|cjs|js)$/.test(entry.name)) continue;
      if (/\.(test|spec)\./.test(entry.name)) continue;
      files.push(full);
    }
  }
  return files;
}

export async function findStubMarkerFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const packagesDir = path.join(root, 'packages');
  if (!existsSync(packagesDir)) return findings;

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(packagesDir, entry.name);
    const pkgPath = path.join(packageDir, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private === true) continue;

    for (const sourcePath of walkSources(path.join(packageDir, 'src'))) {
      const content = readFileSync(sourcePath, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const marker of STUB_MARKERS) {
          if (lines[i].includes(marker)) {
            findings.push({
              file: path.relative(root, sourcePath),
              type: 'stub-marker',
              detail: `line ${i + 1} contains stub marker "${marker}" in a publishable package.`,
            });
          }
        }
      }
    }
  }

  return findings;
}

export async function main() {
  const findings = await findStubMarkerFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('stub marker scan passed.\n');
    return;
  }
  process.stdout.write('stub marker scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
