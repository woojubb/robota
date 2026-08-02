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
 * Sentinel a scan prints to mark ONE line as an ADVISORY finding (HARNESS-053).
 *
 * THE GAP THIS CLOSES, measured. Passing scans' output is discarded — `expect(out).not.toContain
 * ('quiet pass')` is a pinned property of this runner, and a correct one: 78 scans printing their
 * successes is noise nobody reads. But it left no third channel, so a scan that measured something
 * worth saying while still passing had nowhere to say it. Measured on the real path:
 * `touch packages/agent-core/src/index.ts && pnpm harness:scan | grep -i stale` printed NOTHING,
 * while the `dist` scan had detected and reported the staleness. A finding nobody sees is not a
 * finding, and this is the exact sequence that cost a misdiagnosis cycle: run `harness:scan`, see
 * green, conclude the branch is healthy, then blame missing barrel exports for a stale `dist`.
 *
 * WHY A LINE MARKER RATHER THAN AN EXIT CODE. Advisories must not be able to change a scan's
 * verdict — a second non-zero code would eventually be treated as failure by something downstream,
 * and then "advisory" becomes blocking by accident. A marker is opt-in per LINE, so a scan chooses
 * exactly which of its output reaches the summary and the rest stays suppressed as before.
 *
 * GENERAL, not a special case for one scan: any scan may print it, and several in this repo have
 * advisory output currently thrown away (e.g. `scan-file-size`'s ratchet-tighten notices).
 */
export const ADVISORY_MARKER = '::advisory::';

/**
 * SGR colour sequences, stripped so a scan's own colouring does not leak into the summary.
 *
 * The ESC is written `\x1b`, not as a raw control byte, and it is part of the pattern deliberately:
 * without it the regex is `/\[[0-9;]*m/`, which matches any bracketed digits ending in `m`, so an
 * advisory whose text happened to mention `[12m` would have had it silently deleted. A sanitiser
 * that corrupts the message it is sanitising is worse than none. Both properties are pinned below.
 */
const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Advisory texts a scan emitted, in the order printed. Pure, so the rule is testable without
 * spawning anything.
 *
 * A marked line with no text after the marker is DROPPED rather than surfaced as an empty bullet —
 * an advisory channel that can print a contentless line is a way to look like it reported
 * something while reporting nothing, which is the class this whole item exists to close.
 */
export function extractAdvisories(output) {
  const advisories = [];
  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.replace(ANSI_SGR_PATTERN, '');
    const markerAt = line.indexOf(ADVISORY_MARKER);
    if (markerAt === -1) continue;
    const text = line.slice(markerAt + ADVISORY_MARKER.length).trim();
    if (text.length > 0) advisories.push(text);
  }
  return advisories;
}

/**
 * Default scan concurrency (INFRA-037). Each scan is an independent, read-only subprocess, so they run
 * concurrently under a bounded pool instead of one-at-a-time. Cap leaves one core for the parent.
 */
const DEFAULT_SCAN_CONCURRENCY = Math.max(
  1,
  (typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length) -
    1,
);

/**
 * Ordered scan list — mirrors the former harness:scan chain.
 *
 * EXPORTED (HARNESS-052) so a scan can ask whether it is registered by reading this ARRAY rather
 * than by grepping this file's text. `check-test-coverage-scripts` proved its own wiring with
 * `readFileSync(run-all-scans.mjs).includes('check-test-coverage-scripts.mjs')`, which stays true
 * when the registration is commented out, deleted from the array but named in a comment, or
 * mentioned in this very docstring. A presence-of-a-string standing in for a structural property is
 * the sub-shape that item's second axis is about; the structure is here, so read the structure.
 */
export const SCAN_COMMANDS = [
  { name: 'consistency', command: ['node', 'scripts/harness/scan-consistency.mjs'] },
  { name: 'memory-mirror', command: ['node', 'scripts/harness/scan-memory-mirror.mjs'] },
  { name: 'spec-research', command: ['node', 'scripts/harness/scan-spec-research.mjs'] },
  { name: 'orchestration-map', command: ['node', 'scripts/harness/scan-orchestration-map.mjs'] },
  { name: 'deployment-matrix', command: ['node', 'scripts/harness/scan-deployment-matrix.mjs'] },
  {
    name: 'orchestration-neutrality',
    command: ['node', 'scripts/harness/scan-orchestration-neutrality.mjs'],
  },
  { name: 'hook-catalog', command: ['node', 'scripts/harness/scan-hook-catalog.mjs'] },
  {
    // INFRA-078 — `hooks-have-execution-coverage` proves a hook CAN run; nothing read the file that
    // decides whether the deployment CALLS it, so a hook registered to no event, and a matcher
    // naming a deleted file, both stayed green.
    name: 'hook-registration',
    command: ['node', 'scripts/harness/scan-hook-registration.mjs'],
  },
  { name: 'review-findings', command: ['node', 'scripts/harness/scan-review-findings.mjs'] },
  {
    name: 'review-token-supply',
    command: ['node', 'scripts/harness/scan-review-token-supply.mjs'],
  },
  {
    name: 'workflow-permissions',
    command: ['node', 'scripts/harness/scan-workflow-permissions.mjs'],
  },
  {
    // INFRA-059 — `deploy.yml` referenced a repository that does not exist for eight months: an
    // unresolvable `uses:` dies at `Set up job`, so there is no failing step to read and a skipped
    // job reports the run green. The resolvability half runs in CI (see the scan's header for why
    // it stays off on a promotion to `main`); the static half runs everywhere.
    name: 'action-references',
    command: ['node', 'scripts/harness/scan-action-references.mjs'],
  },
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
  { name: 'shell-portability', command: ['node', 'scripts/harness/scan-shell-portability.mjs'] },
  { name: 'ci-base-history', command: ['node', 'scripts/harness/scan-ci-base-history.mjs'] },
  {
    name: 'automerge-disarm-permission',
    command: ['node', 'scripts/harness/scan-automerge-disarm-permission.mjs'],
  },
  {
    name: 'promotion-ancestry',
    command: ['node', 'scripts/harness/scan-promotion-ancestry.mjs'],
  },
  {
    name: 'main-required-checks',
    command: ['node', 'scripts/harness/scan-main-required-checks.mjs'],
  },
  {
    name: 'required-check-needs',
    command: ['node', 'scripts/harness/scan-required-check-needs.mjs'],
  },
  {
    name: 'test-selection-tolerance',
    command: ['node', 'scripts/harness/scan-test-selection-tolerance.mjs'],
  },
  {
    // INFRA-063 D7 — `pnpm test` is `-r --if-present test`, which walks past every suite declared
    // under any other name. The release gate ran one of them (`test:bin`) only because someone had
    // written it in by hand, and never saw `agent-cli-web`'s `test:e2e` at all. Enumerates every
    // `^test(:|$)` script and requires each to be run or excluded with a re-verified reason.
    name: 'release-sweep-coverage',
    command: ['node', 'scripts/harness/scan-release-sweep-coverage.mjs'],
  },
  {
    // INFRA-060 D4 — the affected-scope calculator resolved build tooling to ZERO scopes, so a PR
    // changing how every package is built left the REQUIRED `build` and `quality` checks green
    // having verified nothing. Executes the calculator against each declared path.
    name: 'build-tooling-scope',
    command: ['node', 'scripts/harness/scan-build-tooling-scope.mjs'],
  },
  { name: 'no-fallback', command: ['node', 'scripts/harness/scan-no-fallback.mjs'] },
  { name: 'authority-bypass', command: ['node', 'scripts/harness/scan-authority-bypass.mjs'] },
  {
    name: 'contract-cast-ratchet',
    command: ['node', 'scripts/harness/scan-contract-cast-ratchet.mjs'],
  },
  {
    name: 'literal-cast-union',
    command: ['node', 'scripts/harness/scan-literal-cast-union.mjs'],
  },
  {
    name: 'option-reachability',
    command: ['node', 'scripts/harness/scan-option-reachability.mjs'],
  },
  {
    name: 'publish-registry',
    command: ['node', 'scripts/harness/scan-publish-registry.mjs'],
  },
  {
    name: 'product-identity',
    command: ['node', 'scripts/harness/scan-product-identity.mjs'],
  },
  {
    name: 'release-verification-gate',
    command: ['node', 'scripts/harness/scan-release-verification-gate.mjs'],
  },
  {
    name: 'legacy-typescript',
    command: ['node', 'scripts/harness/scan-legacy-typescript.mjs'],
  },
  { name: 'no-fake-in-src', command: ['node', 'scripts/harness/scan-no-fake-in-src.mjs'] },
  { name: 'helper-limits', command: ['node', 'scripts/harness/scan-helper-limits.mjs'] },
  {
    // HARNESS-052 — the audited "success over work it did not do" shape wearing a test: an
    // assertion that no implementation of the code under test could fail.
    name: 'tautological-assertions',
    command: ['node', 'scripts/harness/scan-tautological-assertions.mjs'],
  },
  {
    // HARNESS-052 — and the same shape wearing a GUARD: a scan whose governed tree is absent and
    // which reports a pass rather than an error.
    name: 'guard-scope-fail-closed',
    command: ['node', 'scripts/harness/scan-guard-scope-fail-closed.mjs'],
  },
  { name: 'api-pagination', command: ['node', 'scripts/harness/scan-api-pagination.mjs'] },
  {
    name: 'live-smoke-provider-coverage',
    command: ['node', 'scripts/harness/scan-live-smoke-provider-coverage.mjs'],
  },
  {
    name: 'composition-neutrality',
    command: ['node', 'scripts/harness/scan-composition-neutrality.mjs'],
  },
  {
    name: 'session-artifact-neutrality',
    command: ['node', 'scripts/harness/scan-session-artifact-neutrality.mjs'],
  },
  {
    name: 'agent-tools-neutrality',
    command: ['node', 'scripts/harness/scan-agent-tools-neutrality.mjs'],
  },
  {
    name: 'memory-neutrality',
    command: ['node', 'scripts/harness/scan-memory-neutrality.mjs'],
  },
  {
    name: 'evals-neutrality',
    command: ['node', 'scripts/harness/scan-evals-neutrality.mjs'],
  },
  {
    name: 'prompt-prose',
    command: ['node', 'scripts/harness/scan-prompt-prose.mjs'],
  },
  {
    name: 'capability-reachability',
    command: ['node', 'scripts/harness/scan-capability-reachability.mjs'],
  },
  {
    name: 'progress-report-quantification',
    command: ['node', 'scripts/harness/scan-progress-report-quantification.mjs'],
  },
  { name: 'deprecated-markers', command: ['node', 'scripts/harness/scan-deprecated-markers.mjs'] },
  { name: 'done-evidence', command: ['node', 'scripts/harness/check-done-evidence.mjs'] },
  {
    // HARNESS-050 — the companion to done-evidence: that one guards evidence DECAY (a cited path
    // that later vanished), this one guards evidence that was NEVER THERE.
    name: 'unearned-done-claims',
    command: ['node', 'scripts/harness/scan-unearned-done-claims.mjs'],
  },
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
  { name: 'publish', command: ['node', 'scripts/harness/check-publish-safety.mjs'] },
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
  {
    name: 'doc-folder-status',
    command: ['node', 'scripts/harness/scan-doc-folder-status-agreement.mjs'],
  },
  {
    name: 'vitest-resource-ceiling',
    command: ['node', 'scripts/harness/scan-vitest-resource-ceiling.mjs'],
  },
  { name: 'docs-structure', command: ['pnpm', 'docs:validate-structure'] },
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
 *
 * THREE output channels, not two (HARNESS-053): failures print in full, `ADVISORY_MARKER` lines
 * print from every scan regardless of verdict, and everything else from a passing scan stays
 * suppressed. Advisories never touch the return value — `runScans` returns 0 for a suite whose only
 * findings are advisory, and that is pinned by a test.
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

  // ADVISORIES from EVERY scan, passing or failing (HARNESS-053). Deliberately placed after the
  // ✓/✗ list and before the verdict: high enough to be read, low enough that the verdict is still
  // the last line, so a green run still ENDS in green and the advisory cannot be mistaken for one.
  const advisories = results.flatMap((result) =>
    extractAdvisories(result.output).map((text) => ({ name: result.name, text })),
  );
  if (advisories.length > 0) {
    write('');
    write(
      `⚑ ${advisories.length} advisory finding(s) — NOT failures. The verdict below is unaffected.`,
    );
    for (const advisory of advisories) write(`⚑ ${advisory.name}: ${advisory.text}`);
    write('');
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
