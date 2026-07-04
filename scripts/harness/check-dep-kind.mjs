#!/usr/bin/env node

/**
 * Dep-kind conformance scan (INFRA-024).
 *
 * A runtime VALUE import of a `@robota-sdk/*` module in a package's production source must
 * resolve to `dependencies` or `peerDependencies` — never to a devDependencies-only
 * declaration. A devDeps-only runtime import works locally by hoisting accident and breaks
 * for published consumers under strictly-isolated installs (found: agent-cli value-importing
 * agent-executor, 2026-07-04 architecture audit F1). Direction-only scans (`deps`,
 * `dependency-direction`) cannot see this class.
 *
 * False-positive classes excluded by construction (audit-probe verified):
 * - `import type` / inline type-only imports (erased at build) — allowed against devDeps;
 * - JSDoc example lines (`* import ...` — not at line start);
 * - generated-code string literals (line does not START with `import`);
 * - test and testing-surface files (dev-time execution).
 *
 * Exit code 0 = conformant, 1 = violation found. Allowlist entries require a reason and are
 * reported on every run — never silent.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { WORKSPACE_ROOT } from './shared.mjs';

/** Allowlist: `${packageName}:${importedModule}` → reason. Empty today by design. */
export const DEP_KIND_ALLOWLIST = new Map();

const VALUE_IMPORT_RE = /^import\s+(?!type\b)[^;]*?from\s+['"](@robota-sdk\/[a-z0-9-]+)['"]/gm;
const SIDE_EFFECT_IMPORT_RE = /^import\s+['"](@robota-sdk\/[a-z0-9-]+)['"]/gm;

function isTestSurface(filePath) {
  return (
    filePath.includes('__tests__') ||
    /\.(test|spec)\.[cm]?tsx?$/.test(filePath) ||
    filePath.split(path.sep).includes('testing')
  );
}

async function listSourceFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      found.push(...(await listSourceFiles(full)));
    } else if (/\.[cm]?tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

function collectValueImports(source) {
  const modules = new Set();
  for (const re of [VALUE_IMPORT_RE, SIDE_EFFECT_IMPORT_RE]) {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) {
      modules.add(match[1]);
    }
  }
  return modules;
}

/** Scan every workspace package; returns findings + applied allowlist exemptions. */
export async function findDevDepOnlyRuntimeImports(root = WORKSPACE_ROOT) {
  const findings = [];
  const exemptions = [];
  const packageDirs = [];
  for (const tier of ['packages', 'apps']) {
    let entries = [];
    try {
      entries = await fs.readdir(path.join(root, tier), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) packageDirs.push(path.join(root, tier, entry.name));
    }
  }

  for (const pkgDir of packageDirs) {
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const runtimeDeclared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);
    const devDeclared = new Set(Object.keys(manifest.devDependencies ?? {}));

    for (const filePath of await listSourceFiles(path.join(pkgDir, 'src'))) {
      if (isTestSurface(filePath)) continue;
      const source = await fs.readFile(filePath, 'utf8');
      for (const module of collectValueImports(source)) {
        if (module === manifest.name || runtimeDeclared.has(module)) continue;
        if (!devDeclared.has(module)) continue; // undeclared entirely → owned by the deps scan
        const key = `${manifest.name}:${module}`;
        if (DEP_KIND_ALLOWLIST.has(key)) {
          exemptions.push({ key, reason: DEP_KIND_ALLOWLIST.get(key) });
          continue;
        }
        findings.push({
          package: manifest.name,
          module,
          file: path.relative(root, filePath),
        });
      }
    }
  }
  const seen = new Set();
  return {
    findings: findings.filter((f) => {
      const key = `${f.package}:${f.module}:${f.file}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    exemptions,
  };
}

export async function main() {
  const { findings, exemptions } = await findDevDepOnlyRuntimeImports();
  for (const exemption of exemptions) {
    process.stdout.write(`  allowlisted: ${exemption.key} — ${exemption.reason}\n`);
  }
  if (findings.length > 0) {
    process.stdout.write(
      'dep-kind scan failed — runtime value imports declared only in devDependencies:\n',
    );
    for (const finding of findings) {
      process.stdout.write(`  - ${finding.package} imports ${finding.module} (${finding.file})\n`);
    }
    process.stdout.write(
      'Move the module to dependencies (or peerDependencies) of the importing package.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('dep-kind scan passed.\n');
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
