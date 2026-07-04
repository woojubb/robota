#!/usr/bin/env node

/**
 * Enforce the interface-import rule (INFRA-010 / INFRA-013, AF-14).
 *
 * The transport-facing contract-type SSOT lives in
 * `@robota-sdk/agent-interface-transport`. Implementation packages must import
 * those moved types from the interface package — NOT from `@robota-sdk/agent-framework`.
 * Runtime values and framework-owned types (e.g. TInteractiveSessionOptions,
 * ICommandHostContext, ICommandModule) still come from agent-framework.
 *
 * This guard:
 *   1. Computes the export-name set of `@robota-sdk/agent-interface-transport`
 *      by parsing the interface-transport `src` tree.
 *   2. Scans every implementation-package `src` file under `packages` EXCEPT
 *      files inside `agent-framework` and any `agent-interface-*` package.
 *   3. Flags any import from `@robota-sdk/agent-framework` (type OR value) that
 *      pulls in a symbol belonging to the interface-transport export set.
 *
 * Exit code 0 = clean, 1 = violations found.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const TRANSPORT_SRC = join(ROOT, 'packages/agent-interface-transport/src');
const FRAMEWORK_SPECIFIER = '@robota-sdk/agent-framework';

/** Packages whose own src is allowed to import these names from framework. */
function isExemptPackage(pkgDirName) {
  return pkgDirName === 'agent-framework' || pkgDirName.startsWith('agent-interface-');
}

/**
 * Compute the set of symbol names exported by agent-interface-transport.
 * Covers `export interface|type|enum NAME` and `export { ... }` /
 * `export type { ... }` re-export blocks (honoring `as` aliases).
 */
function computeTransportExportSet() {
  const names = new Set();
  if (!existsSync(TRANSPORT_SRC)) {
    throw new Error(`agent-interface-transport src not found: ${TRANSPORT_SRC}`);
  }

  const stack = [TRANSPORT_SRC];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const src = readFileSync(full, 'utf8');

      for (const m of src.matchAll(/export\s+(?:interface|type|enum)\s+([A-Za-z0-9_]+)/g)) {
        names.add(m[1]);
      }
      for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
        for (let part of m[1].split(',')) {
          part = part.trim();
          if (!part) continue;
          const asMatch = part.match(/\bas\s+([A-Za-z0-9_]+)$/);
          names.add(asMatch ? asMatch[1] : part.split(/\s+/)[0]);
        }
      }
    }
  }

  return names;
}

/** Collect every `*.ts`/`*.tsx` file under a package's `src/` directory. */
function collectSourceFiles(srcDir) {
  const files = [];
  if (!existsSync(srcDir)) return files;
  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.push(full);
      }
    }
  }
  return files;
}

/**
 * Enumerate implementation directories whose `src/` is governed by the rule.
 *
 * The interface-import rule (INFRA-010 layering) governs implementation
 * packages in `packages/*` AND apps in `apps/*` (INFRA-014). agent-framework
 * and agent-interface-* are exempt (the former owns the runtime values; the
 * latter own the contract SSOT).
 */
function findScannablePackages() {
  const result = [];
  for (const baseName of ['packages', 'apps']) {
    const base = join(ROOT, baseName);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;
      if (isExemptPackage(dirName)) continue;
      const srcDir = join(base, dirName, 'src');
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) {
        result.push({ dirName: `${baseName}/${dirName}`, srcDir });
      }
    }
  }
  return result;
}

/**
 * Extract the named specifiers of every import OR re-export statement that targets
 * `@robota-sdk/agent-framework` (single or multi-line, type or value). `export … from`
 * pass-throughs previously evaded this scan (INFRA-025 P2 finding: transport-ws
 * re-exported four workspace contract types via framework undetected).
 * Returns array of { names: string[], snippet: string }.
 */
export function extractFrameworkImports(source) {
  const imports = [];
  const re =
    /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@robota-sdk\/agent-framework['"]\s*;?/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const names = match[1]
      .split(',')
      .map((spec) => spec.trim())
      .filter(Boolean)
      .map((spec) => {
        const bare = spec.startsWith('type ') ? spec.slice(5).trim() : spec;
        return bare.split(/\s+as\s+/)[0].trim();
      })
      .filter(Boolean);
    imports.push({ names, snippet: match[0] });
  }
  return imports;
}

function main() {
  const movedSet = computeTransportExportSet();
  const packages = findScannablePackages();

  const violations = [];
  let filesScanned = 0;

  for (const pkg of packages) {
    for (const file of collectSourceFiles(pkg.srcDir)) {
      filesScanned += 1;
      const source = readFileSync(file, 'utf8');
      if (!source.includes(FRAMEWORK_SPECIFIER)) continue;

      for (const imp of extractFrameworkImports(source)) {
        for (const name of imp.names) {
          if (movedSet.has(name)) {
            violations.push({ file: relative(ROOT, file), name });
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error('❌ Interface-import rule violations found:\n');
    console.error(
      `  Moved interface types must be imported from '@robota-sdk/agent-interface-transport',\n` +
        `  not from '${FRAMEWORK_SPECIFIER}'.\n`,
    );
    const byFile = new Map();
    for (const v of violations) {
      if (!byFile.has(v.file)) byFile.set(v.file, new Set());
      byFile.get(v.file).add(v.name);
    }
    for (const [file, names] of byFile) {
      console.error(`  [INTERFACE-IMPORT] ${file}: ${[...names].sort().join(', ')}`);
    }
    console.error('');
    console.error(
      `interface-imports summary: violations=${violations.length} files=${byFile.size} ` +
        `scanned=${filesScanned} moved-types=${movedSet.size} result=FAIL`,
    );
    process.exit(1);
  }

  console.log('✅ No interface-import rule violations found.');
  console.log(
    `interface-imports summary: violations=0 files=0 ` +
      `scanned=${filesScanned} moved-types=${movedSet.size} result=PASS`,
  );
  process.exit(0);
}

const isDirectExecution =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename);
if (isDirectExecution) {
  main();
}
