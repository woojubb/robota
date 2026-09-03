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
 * - Test files (__tests__/, *.test.*, *.spec.*) are exempt, as are dependency and build-output
 *   directories (node_modules/, dist/, coverage/) — the shared `listSourceFiles` exclusion set.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listManifestPackageDirs, listSourceFiles } from './workspace-packages.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

// "placeholder for actual" caught shipped, consumed storage classes that only
// logged a warning and returned a stub value (silent data loss) — PLUGIN-001.
const STUB_MARKERS = [
  'TODO: Implement',
  'Not implemented',
  'NotImplementedError',
  'placeholder for actual',
];

/**
 * How many publishable source files the last walk read — HARNESS-057. A module-level holder set
 * where the walk happens and read where the line is printed, so the finder's return shape and the
 * tests that assert on its findings stay untouched.
 */
let examinedSourceFiles = 0;

/** What the last `findStubMarkerFindings` run actually read — exported so it can be asserted. */
export function examinedSourceFileCount() {
  return examinedSourceFiles;
}

export async function findStubMarkerFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['packages'], {
    scan: 'stub-markers',
    why: 'Stub markers are searched in shipped package source; no packages/ means no search, not a clean search.',
  });
  const findings = [];
  examinedSourceFiles = 0;

  // Nesting-aware: covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
  for (const packageDir of listManifestPackageDirs(root)) {
    const pkgPath = path.join(packageDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private === true) continue;

    // HARNESS-062: the private copy of this walk excluded `__tests__`/`node_modules` but NOT `dist`,
    // so a file under `src/dist/` was source here and invisible to `no-fake-in-src`. One lister,
    // one exclusion set. Measured on the real tree when routed: 1620 files before, 1620 after.
    for (const sourcePath of listSourceFiles(path.join(packageDir, 'src'))) {
      examinedSourceFiles++;
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
    // HARNESS-057: the size of the subject — publishable source files, which is what the walk reads
    // and therefore what a reader can check against the workspace at a glance. Zero of them would
    // mean the package walk found nothing publishable, which is a pass over nothing rather than a
    // tree with no stubs, so it carries no expected-empty excuse.
    process.stdout.write(`::examined:: ${examinedSourceFiles} publishable source files\n`);
    process.stdout.write('stub marker scan passed.\n');
    return;
  }
  process.stdout.write('stub marker scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
