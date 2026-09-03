#!/usr/bin/env node

/**
 * A TUI render site cannot reach the terminal except through `SafeText` (#2222).
 *
 * `packages/agent-transport-tui/src/SafeText.tsx` sanitizes every string child before Ink sees it.
 * That boundary is worth exactly as much as this scan: without it, `SafeText` is one more thing to
 * remember, which is the shape SEC-019 measured failing three times in six review rounds. So every
 * OTHER production module in the package is refused a `Text` import from `ink` — the plain form,
 * the aliased form (`Text as T`), and the namespace form (`* as ink`, through which `ink.Text` is
 * reachable). Tests and fixtures are exempt: a test that renders raw Ink `Text` to PROVE a leak is
 * how the boundary's own suite stays falsifiable.
 *
 * Reads the tracked tree only (git ls-files), so a clone judges it offline; reports `::examined::`
 * per HARNESS-057.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const PACKAGE_SRC = 'packages/agent-transport-tui/src';
export const BOUNDARY_MODULE = `${PACKAGE_SRC}/SafeText.tsx`;

// One statement at a time: the clause cannot cross a `;`, so a later `from 'ink'` in the file does
// not pull an unrelated import (e.g. `{ Text } from './SafeText.js'`) into this match.
const IMPORT_FROM_INK = /import\s+(type\s+)?([^;]*?)\s+from\s+['"]ink['"]/g;

function isExempt(relative) {
  return (
    relative === BOUNDARY_MODULE ||
    relative.includes('/__tests__/') ||
    /\.test\.tsx?$/.test(relative) ||
    /\.d\.ts$/.test(relative)
  );
}

/** Every way `ink`'s `Text` becomes reachable from one import statement's clause. */
export function offendingImportForms(clause) {
  const forms = [];
  if (/^\*\s+as\s+\w+/.test(clause.trim())) forms.push('namespace');
  const named = clause.match(/\{([\s\S]*?)\}/);
  if (named) {
    for (const raw of named[1].split(',')) {
      const spec = raw.trim().replace(/^type\s+/, '');
      if (spec === 'Text') forms.push('plain');
      else if (/^Text\s+as\s+\w+$/.test(spec)) forms.push('aliased');
    }
  }
  return forms;
}

export function findBoundaryViolations(root = WORKSPACE_ROOT) {
  const listed = spawnSync('git', ['ls-files', '--', PACKAGE_SRC], { cwd: root, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`);
  const files = listed.stdout
    .split('\n')
    .filter((file) => /\.(ts|tsx)$/.test(file) && !isExempt(file));
  const violations = [];
  for (const relative of files) {
    const text = readFileSync(path.join(root, relative), 'utf8');
    for (const match of text.matchAll(IMPORT_FROM_INK)) {
      if (match[1]) continue; // a type-only import renders nothing
      for (const form of offendingImportForms(match[2])) {
        const line = text.slice(0, match.index).split('\n').length;
        violations.push({ file: relative, line, form });
      }
    }
  }
  return { examined: files.length, violations };
}

function main() {
  const { examined, violations } = findBoundaryViolations();
  console.log(`::examined:: ${examined} agent-transport-tui production module(s)`);
  if (violations.length === 0) {
    console.log('✓ tui-safe-text-boundary: only SafeText.tsx imports Text from ink');
    return;
  }
  console.error(
    "✗ tui-safe-text-boundary: a render site imports ink's Text outside SafeText.tsx (#2222).",
  );
  console.error("  Import { Text } from './SafeText.js' instead; it sanitizes every string child.");
  for (const v of violations)
    console.error(`  ${v.file}:${v.line}: ${v.form} import of Text from 'ink'`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
