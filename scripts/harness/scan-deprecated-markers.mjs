#!/usr/bin/env node

/**
 * Enforces the "no deprecated" rule mechanically (HARNESS-018).
 *
 * This is a pre-1.0, unpublished project: deprecated symbols are banned — delete
 * them or migrate consumers in the same change (see feedback_no_deprecated). A
 * `@deprecated` JSDoc tag in shipped (publishable) package source is therefore a
 * violation.
 *
 * - Applies to packages/<name>/src of packages without `"private": true`.
 * - Test files (__tests__/, *.test.*, *.spec.*) are exempt, as are dependency and build-output
 *   directories (node_modules/, dist/, coverage/) — the shared `listSourceFiles` exclusion set.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listManifestPackageDirs, listSourceFiles } from './workspace-packages.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

const DEPRECATED_MARKER = '@deprecated';

export function findDeprecatedMarkerFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['packages'], {
    scan: 'deprecated-markers',
    why: 'Deprecated markers are searched in shipped package source; the absence of that source is not their absence.',
  });
  const findings = [];

  // Nesting-aware: covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
  for (const packageDir of listManifestPackageDirs(root)) {
    const pkgPath = path.join(packageDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private === true) continue;

    // HARNESS-062: this walker was byte-identical to check-stub-markers'. Both now import the one
    // lister. Measured on the real tree when routed: 1620 files before, 1620 after.
    for (const sourcePath of listSourceFiles(path.join(packageDir, 'src'))) {
      const lines = readFileSync(sourcePath, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(DEPRECATED_MARKER)) {
          findings.push({ file: path.relative(root, sourcePath), line: i + 1 });
        }
      }
    }
  }
  return findings;
}

export function main() {
  const findings = findDeprecatedMarkerFindings();
  if (findings.length === 0) {
    process.stdout.write('deprecated marker scan passed.\n');
  } else {
    process.stdout.write('deprecated marker scan failed:\n');
    for (const f of findings) {
      process.stdout.write(`  ${f.file}:${f.line} contains "${DEPRECATED_MARKER}"\n`);
    }
    process.stdout.write(
      '\nDelete the deprecated symbol or migrate consumers (no-deprecated rule).\n',
    );
    process.exitCode = 1;
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
