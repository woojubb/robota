#!/usr/bin/env node

/**
 * Check that the SDK assembly layer (packages/agent-framework) has no React imports.
 *
 * Rules enforced:
 * 1. No `from 'react'` or `from "react"` imports in packages/agent-framework/src/
 * 2. No 'react' in packages/agent-framework/package.json dependencies/devDependencies/peerDependencies.
 * 3. The scan target must exist — a missing src/ or package.json is a hard finding, not a silent pass
 *    (HARNESS-016 / ARL-16g: this guard previously pointed at the absorbed `agent-sdk` husk, so it scanned
 *    nothing and enforced nothing while its docstring claimed `agent-framework`; assert the real relation).
 *
 * agent-framework is a platform-neutral assembly layer. React hooks/context/components belong in the
 * product/UI packages (agent-cli, agent-transport-tui, agent-transport-gui) only.
 *
 * Exit code 0 = clean, 1 = violations found.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const SDK_PKG = 'agent-framework';

function walkTs(dir) {
  const files = [];
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTs(full));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Pure scan (exported for the fixture self-test): find React-free violations for `packages/<pkg>` under
 * `root`. Returns `{type, message, ...}[]` — empty = clean.
 */
export function findSdkReactViolations(root = ROOT, pkg = SDK_PKG) {
  const srcDir = join(root, 'packages', pkg, 'src');
  const pkgJson = join(root, 'packages', pkg, 'package.json');
  const violations = [];

  // Check 0: the scan target must exist — otherwise this guard would silently enforce nothing.
  if (!existsSync(srcDir)) {
    violations.push({
      type: 'SCAN-TARGET-MISSING',
      message: `Scan target packages/${pkg}/src does not exist — the guard would enforce nothing (rename/absorb?).`,
    });
  }
  if (!existsSync(pkgJson)) {
    violations.push({
      type: 'SCAN-TARGET-MISSING',
      message: `Scan target packages/${pkg}/package.json does not exist — the guard would enforce nothing.`,
    });
  }

  // Check 1: No React imports in source files.
  const reactImportPattern = /from\s+['"]react['"]/g;
  for (const file of walkTs(srcDir)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      if (reactImportPattern.test(line)) {
        violations.push({
          type: 'REACT-IMPORT',
          message: `React import in ${pkg} source: ${file.replace(root + '/', '')}:${idx + 1}`,
        });
      }
      reactImportPattern.lastIndex = 0;
    });
  }

  // Check 2: No 'react' in package.json dependencies/devDependencies/peerDependencies.
  if (existsSync(pkgJson)) {
    const manifest = JSON.parse(readFileSync(pkgJson, 'utf8'));
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
      if (manifest[section] && manifest[section]['react']) {
        violations.push({
          type: 'REACT-DEP',
          message: `React listed in packages/${pkg}/package.json [${section}]. ${pkg} must be React-free.`,
        });
      }
    }
  }

  return violations;
}

function runScan() {
  const violations = findSdkReactViolations();
  if (violations.length > 0) {
    console.error(`❌ ${SDK_PKG} React-free violations found:\n`);
    for (const v of violations) {
      console.error(`  [${v.type}] ${v.message}`);
    }
    console.error('');
    console.error(`  ${SDK_PKG} is a platform-neutral assembly layer.`);
    console.error(
      '  React hooks/context/components belong in agent-cli / agent-transport-tui / agent-transport-gui.',
    );
    process.exit(1);
  } else {
    console.log(`✅ ${SDK_PKG} is React-free.`);
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runScan();
}
