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
import os from 'node:os';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Default scan concurrency (INFRA-037). Each scan is an independent, read-only subprocess, so they run
 * concurrently under a bounded pool instead of one-at-a-time. Cap leaves one core for the parent.
 */
const DEFAULT_SCAN_CONCURRENCY = Math.max(
  1,
  (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) -
    1,
);

/** Ordered scan list — mirrors the former harness:scan chain. */
const SCAN_COMMANDS = [
  { name: 'consistency', command: ['node', 'scripts/harness/scan-consistency.mjs'] },
  { name: 'memory-mirror', command: ['node', 'scripts/harness/scan-memory-mirror.mjs'] },
  { name: 'spec-research', command: ['node', 'scripts/harness/scan-spec-research.mjs'] },
  { name: 'orchestration-map', command: ['node', 'scripts/harness/scan-orchestration-map.mjs'] },
  {
    name: 'orchestration-neutrality',
    command: ['node', 'scripts/harness/scan-orchestration-neutrality.mjs'],
  },
  { name: 'review-findings', command: ['node', 'scripts/harness/scan-review-findings.mjs'] },
  { name: 'document-authority', command: ['node', 'scripts/harness/check-document-authority.mjs'] },
  { name: 'commands', command: ['node', 'scripts/harness/check-command-layering.mjs'] },
  {
    name: 'capability-placement',
    command: ['node', 'scripts/harness/check-capability-placement.mjs'],
  },
  {
    name: 'nested-package-glob-coverage',
    command: ['node', 'scripts/harness/check-nested-package-glob-coverage.mjs'],
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
    name: 'arch-map-paths',
    command: ['node', 'scripts/harness/check-architecture-map-paths.mjs'],
  },
  {
    name: 'arch-map-completeness',
    command: ['node', 'scripts/harness/check-architecture-map-completeness.mjs'],
  },
  {
    name: 'document-standards',
    command: ['node', 'scripts/harness/check-document-standards-index.mjs'],
  },
  {
    name: 'agent-def-convention',
    command: ['node', 'scripts/harness/check-agent-def-convention.mjs'],
  },
  {
    name: 'design-doc',
    command: ['node', 'scripts/harness/check-design-doc-completeness.mjs'],
  },
  {
    name: 'adr',
    command: ['node', 'scripts/harness/check-adr-completeness.mjs'],
  },
  {
    name: 'spec-doc-frontmatter',
    command: ['node', 'scripts/harness/check-spec-doc-frontmatter.mjs'],
  },
  {
    name: 'spec-public-surface',
    command: ['node', 'scripts/harness/check-spec-public-surface.mjs'],
  },
  {
    name: 'harness-config-paths',
    command: ['node', 'scripts/harness/check-harness-config-paths.mjs'],
  },
  { name: 'workspace-refs', command: ['node', 'scripts/harness/check-workspace-refs.mjs'] },
  {
    name: 'ghost-package-refs',
    command: ['node', 'scripts/harness/check-ghost-package-refs.mjs'],
  },
  { name: 'stub-markers', command: ['node', 'scripts/harness/check-stub-markers.mjs'] },
  { name: 'conflict-markers', command: ['node', 'scripts/harness/scan-conflict-markers.mjs'] },
  { name: 'no-fallback', command: ['node', 'scripts/harness/scan-no-fallback.mjs'] },
  { name: 'deprecated-markers', command: ['node', 'scripts/harness/scan-deprecated-markers.mjs'] },
  { name: 'done-evidence', command: ['node', 'scripts/harness/check-done-evidence.mjs'] },
  { name: 'task-archival', command: ['node', 'scripts/harness/check-task-archival.mjs'] },
  { name: 'test-module-mocks', command: ['node', 'scripts/harness/check-test-module-mocks.mjs'] },
  { name: 'backlog-placement', command: ['node', 'scripts/harness/check-backlog-placement.mjs'] },
  { name: 'doc-examples', command: ['node', 'scripts/harness/check-doc-examples.mjs'] },
  { name: 'llms-txt', command: ['node', 'scripts/harness/check-llms-txt.mjs'] },
  {
    name: 'temp-script-placement',
    command: ['node', 'scripts/harness/check-temp-script-placement.mjs'],
  },
  { name: 'orphan-exports', command: ['node', 'scripts/harness/check-orphan-exports.mjs'] },
  { name: 'entry-point-only', command: ['node', 'scripts/harness/check-entry-point-only.mjs'] },
  { name: 'deps', command: ['node', 'scripts/harness/check-dependency-direction.mjs'] },
  { name: 'dep-kind', command: ['node', 'scripts/harness/check-dep-kind.mjs'] },
  {
    name: 'interface-imports',
    command: ['node', 'scripts/harness/check-interface-imports.mjs'],
  },
  {
    name: 'interface-runtime',
    command: ['node', 'scripts/harness/scan-interface-runtime.mjs'],
  },
  { name: 'sdk-react-free', command: ['node', 'scripts/harness/check-sdk-react-free.mjs'] },
  { name: 'publish', command: ['node', 'scripts/harness/check-publish-safety.mjs'] },
  {
    name: 'spec-publish-claims',
    command: ['node', 'scripts/harness/check-spec-publish-claims.mjs'],
  },
  { name: 'release-governance', command: ['node', 'scripts/harness/check-release-governance.mjs'] },
  { name: 'test-plans', command: ['node', 'scripts/harness/scan-test-plan.mjs'] },
  {
    name: 'functional-coverage',
    command: ['node', 'scripts/harness/check-functional-coverage.mjs'],
  },
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
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
    child.on('error', (err) => resolve({ code: 1, output: `${output}${err?.message ?? err}\n` }));
  });
}

/**
 * Run scans with BOUNDED CONCURRENCY (INFRA-037), never early-exiting, then emit a final summary.
 * Each scan is `{ name, run: () => Promise<{code, output}> | Promise<number> }`. Output is CAPTURED per
 * scan and printed only for FAILURES (passes stay a one-line ✓), so parallel runs do not interleave.
 * Returns the aggregate exit code (0 = all passed). The summary + exit code are order-independent.
 */
export async function runScans(
  scans,
  write = (line) => process.stdout.write(`${line}\n`),
  concurrency = DEFAULT_SCAN_CONCURRENCY,
) {
  const results = new Array(scans.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= scans.length) return;
      const scan = scans[index];
      const outcome = await scan.run();
      results[index] =
        typeof outcome === 'number'
          ? { name: scan.name, code: outcome, output: '' }
          : { name: scan.name, code: outcome.code, output: outcome.output ?? '' };
    }
  }
  const poolSize = Math.max(1, Math.min(concurrency, scans.length));
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  // Surface the full captured output of each FAILED scan (in original order) for debuggability.
  for (const result of results) {
    if (result.code !== 0 && result.output.trim().length > 0) {
      write(`\n----- ${result.name} (FAILED) -----`);
      write(result.output.replace(/\n+$/, ''));
    }
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

/**
 * Parse `--skip <name>` occurrences (repeatable). Skips are REPORTED, never silent
 * (INFRA-026: CI runs the suite on a fresh checkout, where the `dist` freshness scan —
 * a local pre-CI check by charter — has nothing to measure).
 */
export function parseSkips(argv) {
  const skips = new Set();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--skip' && argv[i + 1]) {
      skips.add(argv[i + 1]);
      i++;
    }
  }
  return skips;
}

export async function main() {
  const skips = parseSkips(process.argv.slice(2));
  const unknownSkips = [...skips].filter(
    (name) => !SCAN_COMMANDS.some((scan) => scan.name === name),
  );
  if (unknownSkips.length > 0) {
    process.stderr.write(`unknown --skip scan name(s): ${unknownSkips.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  for (const name of skips) {
    process.stdout.write(`skipped: ${name} (--skip)\n`);
  }
  const scans = SCAN_COMMANDS.filter(({ name }) => !skips.has(name)).map(({ name, command }) => ({
    name,
    run: () => spawnScan(command),
  }));
  process.exitCode = await runScans(scans);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
