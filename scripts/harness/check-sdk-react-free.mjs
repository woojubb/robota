#!/usr/bin/env node

/**
 * Check that agent-sdk (packages/agent-sdk) has no React imports.
 *
 * Rules enforced:
 * 1. No `from 'react'` or `from "react"` imports in packages/agent-sdk/src/
 * 2. No 'react' in packages/agent-sdk/package.json dependencies or devDependencies.
 *
 * agent-sdk is a platform-neutral assembly layer. React hooks/context/components
 * belong in CLI packages (agent-cli, agent-command-*) only.
 *
 * Exit code 0 = clean, 1 = violations found.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const SDK_SRC = join(ROOT, 'packages', 'agent-sdk', 'src');
const SDK_PKG_JSON = join(ROOT, 'packages', 'agent-sdk', 'package.json');

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

const violations = [];

// Check 1: No React imports in source files
const reactImportPattern = /from\s+['"]react['"]/g;
for (const file of walkTs(SDK_SRC)) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    if (reactImportPattern.test(line)) {
      violations.push({
        type: 'REACT-IMPORT',
        file: file.replace(ROOT + '/', ''),
        line: idx + 1,
        message: `React import in agent-sdk source: ${file.replace(ROOT + '/', '')}:${idx + 1}`,
      });
    }
    reactImportPattern.lastIndex = 0;
  });
}

// Check 2: No 'react' in package.json dependencies or devDependencies
if (existsSync(SDK_PKG_JSON)) {
  const pkg = JSON.parse(readFileSync(SDK_PKG_JSON, 'utf8'));
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (pkg[section] && pkg[section]['react']) {
      violations.push({
        type: 'REACT-DEP',
        section,
        message: `React listed in packages/agent-sdk/package.json [${section}]. agent-sdk must be React-free.`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error('❌ agent-sdk React-free violations found:\n');
  for (const v of violations) {
    console.error(`  [${v.type}] ${v.message}`);
  }
  console.error('');
  console.error('  agent-sdk is a platform-neutral assembly layer.');
  console.error(
    '  React hooks/context/components belong in agent-cli or agent-command-* packages.',
  );
  process.exit(1);
} else {
  console.log('✅ agent-sdk is React-free.');
  process.exit(0);
}
