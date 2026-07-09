#!/usr/bin/env node

/**
 * Entry-point-only guard for composition aggregators (ARCH-PROVIDER-004 / Stage C).
 *
 * `@robota-sdk/dag-nodes-default` is a composition aggregator: it statically pulls the whole default DAG node
 * catalog (15 concrete node packages + their SDKs). Only COMPOSITION ROOTS may import it statically —
 * application entry points and the CLI/command/MCP packages that assemble a runtime. Mid-layer libraries
 * (notably `@robota-sdk/dag-framework`) must NOT take a static edge to it: the framework loads it via a
 * dynamic `import()` so it keeps no hard concrete-node dependency. A static `import … from` / `export … from`
 * edge from a non-sanctioned package re-creates exactly the coupling Stage C removes.
 *
 * What this scans:
 * - STATIC edges only — `import … from '<pkg>'` / `export … from '<pkg>'`. A dynamic `import('<pkg>')` has no
 *   `from` and is intentionally NOT matched (that is the sanctioned framework seam).
 * - Non-test `src` of every workspace package. Test files (`*.test.ts` / `__tests__/`) are excluded — a
 *   test-only static import is a dev concern, not a production layering violation (same production-scope
 *   principle as `check-capability-placement`).
 * - Apps (`apps/*`) are always sanctioned (they are entry points by definition).
 *
 * Exit code 0 = clean, 1 = a non-sanctioned package statically imports a guarded aggregator.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * Guarded aggregators → the set of package names sanctioned to statically import them (beyond any `apps/*`,
 * which are always allowed). Keep this list tight: adding a sanctioned importer is a deliberate decision.
 */
const GUARDED_AGGREGATORS = {
  '@robota-sdk/dag-nodes-default': new Set([
    '@robota-sdk/agent-command-workflows',
    '@robota-sdk/dag-cli',
    '@robota-sdk/dag-mcp-server',
  ]),
};

function walkTs(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') {
        continue;
      }
      files.push(...walkTs(full));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      files.push(full);
    }
  }
  return files;
}

function listWorkspacePackageDirs() {
  const dirs = [];
  for (const group of ['packages', 'packages/dag-nodes', 'apps']) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(base, entry.name);
      if (existsSync(join(dir, 'package.json'))) dirs.push(dir);
    }
  }
  return dirs;
}

function readPackageName(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name ?? null;
  } catch {
    return null;
  }
}

/** Whether `dir` is an application entry point (`apps/<name>`), which is always a sanctioned composition root. */
function isApp(dir) {
  return basename(dirname(resolve(dir))) === 'apps';
}

/**
 * Pure scan (exported for the fixture self-test): return every violating static edge to a guarded aggregator.
 * @param {{dir: string, name: string|null, files: {path: string, text: string}[]}[]} packages
 */
export function findEntryPointOnlyViolations(packages) {
  const violations = [];
  for (const pkg of packages) {
    for (const [aggregator, sanctioned] of Object.entries(GUARDED_AGGREGATORS)) {
      if (pkg.name === aggregator) continue; // the aggregator itself
      if (isApp(pkg.dir)) continue; // apps are always entry points
      if (pkg.name !== null && sanctioned.has(pkg.name)) continue; // sanctioned root
      // Static edge: `... from '<aggregator>'` (import or export). Dynamic import('<aggregator>') has no `from`.
      const edge = new RegExp(`from\\s+['"]${aggregator.replace(/[/-]/g, '\\$&')}['"]`);
      for (const file of pkg.files) {
        if (edge.test(file.text)) {
          violations.push({ package: pkg.name ?? pkg.dir, aggregator, file: file.path });
        }
      }
    }
  }
  return violations;
}

function loadPackages() {
  return listWorkspacePackageDirs().map((dir) => ({
    dir,
    name: readPackageName(dir),
    files: walkTs(join(dir, 'src')).map((path) => ({
      path: path.replace(ROOT + '/', ''),
      text: readFileSync(path, 'utf8'),
    })),
  }));
}

function main() {
  const violations = findEntryPointOnlyViolations(loadPackages());
  if (violations.length === 0) {
    process.stdout.write('entry-point-only scan passed.\n');
    return;
  }
  process.stdout.write('entry-point-only scan failed — non-composition-root static imports:\n');
  for (const v of violations) {
    process.stdout.write(
      `- [entry-point-only] ${v.package} statically imports ${v.aggregator} (${v.file}). ` +
        `Load it dynamically or move the composition to an entry point.\n`,
    );
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
