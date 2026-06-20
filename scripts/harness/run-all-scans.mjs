#!/usr/bin/env node

/**
 * Run every harness scan and report ALL results in one pass.
 *
 * Lesson source: the previous `&&` chain stopped at the first failing scan,
 * masking every scan behind it — pre-existing background-workspace findings
 * failed unseen on every release until an unrelated fix unmasked them
 * (HARNESS-011, 2026-06-11). A real NEW failure must never hide behind a
 * known baseline failure.
 *
 * Exit code 0 = all scans passed, 1 = at least one scan failed.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Ordered scan list — mirrors the former harness:scan chain. */
const SCAN_COMMANDS = [
  { name: 'consistency', command: ['node', 'scripts/harness/scan-consistency.mjs'] },
  { name: 'document-authority', command: ['node', 'scripts/harness/check-document-authority.mjs'] },
  { name: 'commands', command: ['node', 'scripts/harness/check-command-layering.mjs'] },
  {
    name: 'capability-placement',
    command: ['node', 'scripts/harness/check-capability-placement.mjs'],
  },
  {
    name: 'background-workspace',
    command: ['node', 'scripts/harness/check-background-workspace-conformance.mjs'],
  },
  {
    name: 'agent-server-boundary',
    command: ['node', 'scripts/harness/check-agent-server-boundary.mjs'],
  },
  { name: 'sdk-public-surface', command: ['node', 'scripts/harness/check-sdk-public-surface.mjs'] },
  { name: 'specs', command: ['node', 'scripts/harness/audit-spec-coverage.mjs'] },
  { name: 'spec-paths', command: ['node', 'scripts/harness/check-spec-paths.mjs'] },
  {
    name: 'harness-config-paths',
    command: ['node', 'scripts/harness/check-harness-config-paths.mjs'],
  },
  { name: 'workspace-refs', command: ['node', 'scripts/harness/check-workspace-refs.mjs'] },
  { name: 'stub-markers', command: ['node', 'scripts/harness/check-stub-markers.mjs'] },
  { name: 'done-evidence', command: ['node', 'scripts/harness/check-done-evidence.mjs'] },
  { name: 'task-archival', command: ['node', 'scripts/harness/check-task-archival.mjs'] },
  { name: 'orphan-exports', command: ['node', 'scripts/harness/check-orphan-exports.mjs'] },
  { name: 'deps', command: ['node', 'scripts/harness/check-dependency-direction.mjs'] },
  {
    name: 'interface-imports',
    command: ['node', 'scripts/harness/check-interface-imports.mjs'],
  },
  { name: 'sdk-react-free', command: ['node', 'scripts/harness/check-sdk-react-free.mjs'] },
  { name: 'publish', command: ['node', 'scripts/harness/check-publish-safety.mjs'] },
  { name: 'release-governance', command: ['node', 'scripts/harness/check-release-governance.mjs'] },
  { name: 'test-plans', command: ['node', 'scripts/harness/scan-test-plan.mjs'] },
  {
    name: 'coverage-scripts',
    command: ['node', 'scripts/harness/check-test-coverage-scripts.mjs'],
  },
  { name: 'file-size', command: ['node', 'scripts/harness/scan-file-size.mjs'] },
  {
    name: 'build-contracts',
    command: ['node', 'scripts/harness/check-build-output-contracts.mjs'],
  },
  { name: 'dist', command: ['node', 'scripts/harness/scan-dist-freshness.mjs'] },
  { name: 'docs-structure', command: ['pnpm', 'docs:validate-structure'] },
  { name: 'conformance', command: ['node', 'scripts/harness/check-architecture-conformance.mjs'] },
];

function spawnScan(command) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit',
      shell: false,
    });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

/**
 * Run scans sequentially without early exit; emit a final summary.
 * Each scan is { name, run: () => Promise<exitCode> }.
 * Returns the aggregate exit code (0 = all passed).
 */
export async function runScans(scans, write = (line) => process.stdout.write(`${line}\n`)) {
  const results = [];
  for (const scan of scans) {
    const code = await scan.run();
    results.push({ name: scan.name, code });
  }

  write('');
  write('harness scan summary:');
  for (const result of results) {
    write(`${result.code === 0 ? '✓' : '✗'} ${result.name}`);
  }

  const failed = results.filter((result) => result.code !== 0);
  if (failed.length === 0) {
    write(`all ${results.length} scans passed`);
    return 0;
  }
  write(`${failed.length} of ${results.length} scans failed`);
  return 1;
}

export async function main() {
  const scans = SCAN_COMMANDS.map(({ name, command }) => ({
    name,
    run: () => spawnScan(command),
  }));
  process.exitCode = await runScans(scans);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
