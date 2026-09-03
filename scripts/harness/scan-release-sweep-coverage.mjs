#!/usr/bin/env node

/**
 * Release-sweep coverage floor (INFRA-063).
 *
 * THE DEFECT, measured. `release-grade verification` is the only substantive required context on
 * `protect-main` and it reached the workspace suites through `pnpm test` = `pnpm run -r
 * --if-present test`. `--if-present` matches the script named exactly `test`; every other name is
 * walked past in silence, with no warning and no line in the log. `packages/agent-cli-web` declared
 * a `test:e2e` the gate had never once invoked, and `harness:verify:release` carried a literal
 * `pnpm --filter @robota-sdk/agent-cli test:bin` — the same case, recognised once and patched for
 * one package. Two hand-written exceptions is the shape that produces a third.
 *
 * THE RULE, in five parts. Each one alone is satisfiable vacuously, which is why there are five.
 *
 *   R0 VACUITY.        Finding zero test scripts is a failure, not a pass. Every rule below is
 *                      quantified over the discovered set, so an enumerator that stopped
 *                      enumerating would certify the sweep as complete over nothing — the exact
 *                      shape being audited, one level up.
 *
 *   R1 COMPLETENESS.   Every workspace script matching `^test(:|$)` is classified exactly once, as
 *                      swept / run-as-an-extra / excluded-by-declaration. Derived from the
 *                      manifests, never hand-listed, so a new `test:*` script cannot appear without
 *                      someone answering for it.
 *
 *   R2 REACHABILITY.   Each classification's claim is checked against the ACTUAL
 *                      `harness:verify:release` string, expanded through the root scripts it calls.
 *                      The swept bucket needs a recursive `test` sweep present; each extra needs
 *                      either the enumerating runner or its own `--filter … <script>` literal. That
 *                      second branch is deliberate: it is what makes this scan go red on the
 *                      pre-fix, hand-maintained shape. Proven red before this scan landed by
 *                      deleting the `test:bin` literal from the REAL release script and watching
 *                      the scan name it, and pinned by a fixture test so the proof survives.
 *
 *   R3 EXCLUSION INTEGRITY. An exclusion must still match a live script (anti-rot), must carry a
 *                      reason, and must have its KIND verified rather than believed:
 *                      `covered-elsewhere` must name a workflow that really invokes the suite,
 *                      `sweep-variant` must sit in a workspace that really declares `test`. An
 *                      exclusion list nobody re-checks is a set of claims about the past presented
 *                      as facts about the present.
 *
 *   R4 LIVENESS.       A test script naming an entry file that does not exist is dead. `test:e2e`
 *                      ran `node e2e/run-smoke.mjs` against a directory that has never existed in
 *                      this repository's history — the hand-maintained list could not have noticed,
 *                      because a list only knows what someone remembered to write down.
 *
 * WHAT A PASS DOES NOT MEAN. It does not mean the release gate runs every suite — it means every
 * suite is either run or excluded for a stated, re-verified reason. The `unwired` exclusions are
 * live debt and their count is printed on every pass so it cannot go quiet.
 *
 * Exit code 0 = every test-named script is accounted for, 1 = at least one is not.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  EXCLUSIONS,
  EXCLUSION_KINDS,
  RECURSIVE_SWEEP_SCRIPT,
  RUNNER_PATH,
  classifyTestScripts,
  collectTestScripts,
  referencedEntryFile,
} from './release-test-suites.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

/** The release gate's entry point, as `.github/workflows/ci.yml` invokes it. */
export const RELEASE_SCRIPT = 'harness:verify:release';

/**
 * The release script with every `pnpm <root-script>` reference replaced by that script's body.
 *
 * `harness:verify:release` calls `pnpm test`, which is itself a root script — so reading the
 * release string alone would never see the `-r --if-present test` that does the sweeping. Expansion
 * is depth-bounded and cycle-guarded; a root script that referenced itself would otherwise hang the
 * guard rather than fail it.
 */
export function expandReleaseScript(root = WORKSPACE_ROOT) {
  const manifestPath = path.join(root, 'package.json');
  if (!existsSync(manifestPath))
    throw new Error('package.json is missing — the release sweep this scan judges cannot be read.');
  const scripts = JSON.parse(readFileSync(manifestPath, 'utf8')).scripts ?? {};
  const body = scripts[RELEASE_SCRIPT];
  if (typeof body !== 'string')
    throw new Error(
      `package.json declares no \`${RELEASE_SCRIPT}\` script. With no release sweep to read, every ` +
        'reachability assertion below would pass over nothing.',
    );

  const parts = [];
  const seen = new Set();
  const walk = (text, depth) => {
    parts.push(text);
    if (depth > 8) return;
    for (const match of text.matchAll(/\bpnpm\s+(?:run\s+)?([A-Za-z0-9:_-]+)/g)) {
      const name = match[1];
      if (seen.has(name) || typeof scripts[name] !== 'string') continue;
      seen.add(name);
      walk(scripts[name], depth + 1);
    }
  };
  walk(body, 0);
  return parts.join('\n');
}

/** Whether the expanded sweep contains a recursive run of the given script name. */
export function sweepsRecursively(expanded, script) {
  return new RegExp(`pnpm\\s+run\\s+-r\\b[^\\n]*\\b${script}\\b`).test(expanded);
}

/** Whether the expanded sweep names one package's script explicitly, the hand-maintained way. */
export function namesExplicitly(expanded, packageName, script) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`--filter\\s+${escaped}\\s+(?:run\\s+)?${script}\\b`).test(expanded);
}

/** Whether the expanded sweep invokes the enumerating runner. */
export function invokesRunner(expanded) {
  return expanded.includes(RUNNER_PATH);
}

/** Findings across R0–R4. */
export function findReleaseSweepCoverageFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const discovered = collectTestScripts(root);

  // ---- R0 -------------------------------------------------------------------------------------
  if (discovered.length === 0) {
    findings.push({
      type: 'no-test-scripts-found',
      subject: 'workspace',
      detail:
        'ZERO scripts matching `^test(:|$)` were discovered across the workspace. This repository ' +
        'has dozens. Finding none means the enumerator stopped reading the manifests, not that the ' +
        'sweep is complete — and every rule below is quantified over what it found.',
    });
    return findings;
  }

  const expanded = expandReleaseScript(root);
  const { recursive, extra, excluded } = classifyTestScripts(root);

  // ---- R1 -------------------------------------------------------------------------------------
  const classified = new Set(
    [...recursive, ...extra, ...excluded].map((entry) => `${entry.workspace}#${entry.script}`),
  );
  for (const entry of discovered) {
    const key = `${entry.workspace}#${entry.script}`;
    if (classified.has(key)) continue;
    findings.push({
      type: 'unclassified-test-script',
      subject: key,
      detail:
        'matches `^test(:|$)` but is in no bucket. Classify it in ' +
        '`scripts/harness/release-test-suites.mjs`: let it be run as an extra suite, or exclude it ' +
        'with a kind and a reason.',
    });
  }

  // ---- R2 -------------------------------------------------------------------------------------
  if (recursive.length > 0 && !sweepsRecursively(expanded, RECURSIVE_SWEEP_SCRIPT)) {
    findings.push({
      type: 'no-recursive-sweep',
      subject: RELEASE_SCRIPT,
      detail:
        `runs no recursive \`${RECURSIVE_SWEEP_SCRIPT}\` sweep, yet ${recursive.length} workspace(s) ` +
        `declare \`${RECURSIVE_SWEEP_SCRIPT}\` and are classified as swept by it. Those suites are ` +
        'not being run by the release gate at all.',
    });
  }
  const runnerWired = invokesRunner(expanded);
  for (const entry of extra) {
    if (runnerWired) continue;
    if (namesExplicitly(expanded, entry.packageName, entry.script)) continue;
    findings.push({
      type: 'unreachable-suite',
      subject: `${entry.workspace}#${entry.script}`,
      detail:
        `is a suite under a non-\`${RECURSIVE_SWEEP_SCRIPT}\` name, so \`pnpm run -r --if-present ` +
        `${RECURSIVE_SWEEP_SCRIPT}\` walks past it in silence — and \`${RELEASE_SCRIPT}\` neither ` +
        `invokes \`${RUNNER_PATH}\` nor names \`${entry.packageName} ${entry.script}\` itself. The ` +
        'release gate is required on `protect-main`; a suite it never invokes is coverage the ' +
        'promotion does not have. Wire the runner (it discovers this suite without being told), or ' +
        'exclude the suite with a kind and a reason.',
    });
  }

  // ---- R3 -------------------------------------------------------------------------------------
  const liveKeys = new Set(discovered.map((entry) => `${entry.workspace}#${entry.script}`));
  const scriptNames = new Set(discovered.map((entry) => entry.script));
  for (const exclusion of EXCLUSIONS) {
    const label = `${exclusion.workspace ?? '*'}#${exclusion.script}`;
    const matchesSomething =
      exclusion.workspace === undefined
        ? scriptNames.has(exclusion.script)
        : liveKeys.has(`${exclusion.workspace}#${exclusion.script}`);
    if (!matchesSomething) {
      findings.push({
        type: 'stale-exclusion',
        subject: label,
        detail:
          'is excluded here but no workspace declares that script any more. A stale exclusion is a ' +
          'reason kept for a thing that no longer exists — remove it, or fix the workspace it names.',
      });
      continue;
    }
    if (EXCLUSION_KINDS[exclusion.kind] === undefined) {
      findings.push({
        type: 'unknown-exclusion-kind',
        subject: label,
        detail: `declares an unknown exclusion kind \`${exclusion.kind}\`.`,
      });
    }
    if (typeof exclusion.why !== 'string' || exclusion.why.trim().length < 40) {
      findings.push({
        type: 'reasonless-exclusion',
        subject: label,
        detail:
          'carries no substantive `why`. An exclusion without a reason is indistinguishable from ' +
          'the silent skip this scan exists to end.',
      });
    }
  }
  for (const entry of excluded) {
    const label = `${entry.workspace}#${entry.script}`;
    const { exclusion } = entry;
    if (exclusion.kind === 'sweep-variant') {
      const sibling = discovered.find(
        (other) => other.workspace === entry.workspace && other.script === RECURSIVE_SWEEP_SCRIPT,
      );
      if (!sibling) {
        findings.push({
          type: 'variant-without-base',
          subject: label,
          detail:
            `is excluded as a variant of \`${RECURSIVE_SWEEP_SCRIPT}\`, but ${entry.workspace} ` +
            `declares no \`${RECURSIVE_SWEEP_SCRIPT}\` script for it to be a variant OF. That makes ` +
            "it the workspace's only suite, parked behind a label that says it is a duplicate.",
        });
      }
    }
    if (exclusion.kind === 'covered-elsewhere') {
      const workflowPath = exclusion.workflow ? path.join(root, exclusion.workflow) : undefined;
      if (!workflowPath || !existsSync(workflowPath)) {
        findings.push({
          type: 'uncheckable-coverage-claim',
          subject: label,
          detail:
            `claims it is covered elsewhere but names no readable workflow (\`${exclusion.workflow}\`). ` +
            'The claim is the whole exclusion; it has to be checkable.',
        });
        continue;
      }
      const workflow = readFileSync(workflowPath, 'utf8');
      if (!namesExplicitly(workflow, entry.packageName, entry.script)) {
        findings.push({
          type: 'unverified-coverage-claim',
          subject: label,
          detail:
            `claims ${exclusion.workflow} runs it, but that workflow contains no invocation of ` +
            `\`${entry.packageName} ${entry.script}\`. The suite is excluded from the release gate ` +
            'on the strength of coverage that is not there.',
        });
      }
    }
  }

  // ---- R4 -------------------------------------------------------------------------------------
  for (const entry of discovered) {
    const file = referencedEntryFile(entry.command);
    if (file === undefined) continue;
    if (existsSync(path.join(root, entry.workspace, file))) continue;
    findings.push({
      type: 'dead-entry-point',
      subject: `${entry.workspace}#${entry.script}`,
      detail:
        `runs \`${entry.command}\`, and \`${entry.workspace}/${file}\` does not exist. The script ` +
        'is dead: anything that invoked it would fail on a missing entry point, and anything that ' +
        'counted it as coverage was counting nothing.',
    });
  }

  return findings;
}

export async function main() {
  let findings;
  try {
    findings = findReleaseSweepCoverageFindings();
  } catch (error) {
    process.stdout.write(`release-sweep-coverage scan failed: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (findings.length > 0) {
    process.stdout.write('release-sweep-coverage scan failed (INFRA-063):\n');
    for (const finding of findings) {
      process.stdout.write(`  - ${finding.subject}: ${finding.detail}\n`);
    }
    process.stdout.write(
      '\n`--if-present` skips silently. A suite the release gate never invokes is coverage the\n' +
        'promotion does not have, however complete the gate is declared to be. See INFRA-063.\n',
    );
    process.exitCode = 1;
    return;
  }

  const { recursive, extra, excluded } = classifyTestScripts();
  const debt = excluded.filter((entry) => EXCLUSION_KINDS[entry.exclusion.kind]?.debt);
  process.stdout.write(
    `::examined:: ${recursive.length + extra.length + excluded.length} test-named package scripts\n`,
  );
  process.stdout.write(
    `release-sweep-coverage scan passed — ${recursive.length + extra.length + excluded.length} ` +
      `test-named script(s) accounted for: ${recursive.length} swept by \`pnpm ` +
      `${RECURSIVE_SWEEP_SCRIPT}\`, ${extra.length} run by ${RUNNER_PATH}, ${excluded.length} ` +
      `excluded by declaration (${debt.length} of those unwired debt: ` +
      `${debt.map((entry) => `${entry.workspace}#${entry.script}`).join(', ') || 'none'}).\n` +
      'This is not a claim that the release gate runs every suite.\n',
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
