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
 * - Test files (__tests__/, *.test.*, *.spec.*) are exempt.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { listManifestPackageDirs } from './workspace-packages.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const DEPRECATED_MARKER = '@deprecated';

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

export function findDeprecatedMarkerFindings(root = WORKSPACE_ROOT) {
  const findings = [];

  // Nesting-aware: covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
  for (const packageDir of listManifestPackageDirs(root)) {
    const pkgPath = path.join(packageDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private === true) continue;

    for (const sourcePath of walkSources(path.join(packageDir, 'src'))) {
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
