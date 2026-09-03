#!/usr/bin/env node

/**
 * Provider normalization must not read ambient `process.env` (#2347 / #2051).
 *
 * The normalization path — `$ENV:` reference resolution, core provider-config normalization and the
 * executor's profile helpers — takes an injected `TEnvResolver`. The ONE module allowed to touch
 * `process.env` for this purpose is `agent-core/src/utils/env-resolver.ts`, which defines the default
 * resolver. This scan refuses `process.env` in every normalization module, so a branch that goes
 * "around" the resolver (the defect #2347 measured) cannot come back.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** Normalization modules that must resolve the environment ONLY through the injected resolver. */
export const NORMALIZATION_MODULES = Object.freeze([
  'packages/agent-core/src/utils/env-ref.ts',
  'packages/agent-core/src/providers/provider-factory.ts',
  'packages/agent-executor/src/providers/provider-factory.ts',
]);

const AMBIENT_ENV = /\bprocess\s*\.\s*env\b/;

export function findAmbientEnvReads(root = WORKSPACE_ROOT, modules = NORMALIZATION_MODULES) {
  const findings = [];
  for (const relative of modules) {
    const lines = readFileSync(path.join(root, relative), 'utf8').split('\n');
    lines.forEach((line, index) => {
      // A comment that NAMES the forbidden read (documenting the guard) is not a read.
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      if (AMBIENT_ENV.test(code) && !/^\s*\*/.test(line)) {
        findings.push({ file: relative, line: index + 1, text: line.trim() });
      }
    });
  }
  return findings;
}

function main() {
  const findings = findAmbientEnvReads();
  console.log(`::examined:: ${NORMALIZATION_MODULES.length} normalization module(s)`);
  if (findings.length === 0) {
    console.log('✓ provider-env-resolution: no normalization module reads process.env');
    return;
  }
  console.error('✗ provider-env-resolution: ambient process.env read in a normalization module.');
  console.error(
    '  Take a TEnvResolver parameter instead (agent-core/src/utils/env-resolver.ts). #2347',
  );
  for (const finding of findings)
    console.error(`  ${finding.file}:${finding.line}: ${finding.text}`);
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
