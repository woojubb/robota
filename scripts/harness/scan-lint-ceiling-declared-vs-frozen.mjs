#!/usr/bin/env node

/**
 * INFRA-039 — the lint warning count is a RATCHET, and this scan is what keeps the number honest.
 *
 * THE PROBLEM THE SPEC NAMED. `pnpm lint` reports 0 errors and a large number of warnings, on
 * purpose: the repository runs a two-tier policy where `no-explicit-any`, hardcoded event names and
 * `no-require-imports` are errors, and `ban-types` on `unknown`, `no-magic-numbers`, `complexity`
 * and `max-lines-per-function` are visible-but-non-blocking nudges. The volume is not the defect.
 * The defect is that a genuinely NEW warning in a pull request is invisible inside it.
 *
 * MEASURED 2026-08-22: 0 errors, 2093 warnings across 1861 files. The spec recorded 1798 on
 * 2026-07-16, so the count GREW by 295 while the document sat in draft — which is the argument for
 * a ratchet before any reduction pass, not after one.
 *
 * WHERE THE RATCHET LIVES. Not here. It is `--max-warnings` on the root `lint` script, which is
 * eslint's own mechanism and needs no second implementation:
 *
 *   "lint": "eslint packages apps --ext .ts,.tsx --cache --max-warnings <N>"
 *
 * That script is part of `harness:verify:release` (asserted by `check-release-governance.mjs`), and
 * `release-grade verification` is a REQUIRED context on every pull request to `main`, and the
 * `quality` job runs the same script on every pull request to `develop` (issue #1984). So the
 * ceiling is enforced by the tool itself on BOTH paths.
 *
 * It was the promotion path alone until 2026-08-23, and the cost of that is the reason the second
 * one exists: 111 warnings accumulated across 42 commits with every develop pull request green, and
 * the first thing to notice was a promotion that could not merge. A gate that runs once per release
 * reports a number nobody can act on — by the time it speaks, the additions are spread across
 * dozens of merged commits and no author is left to attribute them to.
 *
 * WHAT THIS SCAN IS FOR. A number written into a script is a hand-maintained second source, and this
 * repository has spent whole items removing those. So the ceiling is checked against the tree:
 *
 *   * the flag must be PRESENT — without it the script gates nothing and the ratchet is decorative;
 *   * the frozen number must MATCH the baseline file, so the ceiling has one owner;
 *   * the baseline may FALL and must never RISE without a deliberate re-freeze.
 *
 * WHAT IT DOES NOT DO, stated rather than discovered: it does not run eslint. A full workspace lint
 * is minutes, and `harness:scan` runs on every pre-push — putting it here would move a required
 * gate onto a path that must stay fast. The COUNT is measured by the lint script itself, on the
 * lint script itself, on the release path AND on every develop pull request; this scan governs the
 * CEILING that script carries.
 *
 * NAMED FOR WHAT IT CHECKS (issue #2255). This file was `scan-lint-warning-ratchet` — a name that
 * promised a count. Measured on `c1dd93768`: the scan reported "passed (ceiling 2092, at baseline)"
 * while the workspace carried 2203 warnings, 111 over its own ceiling — green by construction,
 * because both of its inputs are declared numbers and neither is a measurement. The passing
 * message said so; the name and the registration, which are what a reader trusts, did not. So the
 * name now says exactly what is compared: the DECLARED ceiling against the FROZEN one. The count
 * itself is enforced where the passing message says it is.
 *
 * Exit code 0 = the ceiling is present and matches its baseline, 1 = otherwise.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/lint-warning-baseline.json');

/** The ceiling the root `lint` script carries, or null when it carries none. */
export function ceilingIn(manifestSource) {
  const scripts = JSON.parse(manifestSource).scripts ?? {};
  const lint = scripts.lint;
  if (typeof lint !== 'string') return { ceiling: null, reason: 'no `lint` script' };
  const match = /--max-warnings[= ]+(\d+)/.exec(lint);
  if (match === null) {
    return {
      ceiling: null,
      reason:
        'the `lint` script carries no `--max-warnings`, so it reports warnings and gates nothing',
    };
  }
  return { ceiling: Number(match[1]), reason: null };
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return undefined;
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

export function judge(ceiling, reason, baseline) {
  if (ceiling === null)
    return { ok: false, message: `lint-ceiling-declared-vs-frozen: ${reason}.` };
  if (baseline === undefined) {
    return {
      ok: false,
      message: 'lint-ceiling-declared-vs-frozen: no frozen baseline — run --write-baseline.',
    };
  }
  if (ceiling > baseline.warnings) {
    return {
      ok: false,
      message:
        `lint-ceiling-declared-vs-frozen ROSE: the \`lint\` script allows ${ceiling} warning(s), up from a ` +
        `frozen ${baseline.warnings}. A ceiling that rises is not a ratchet. Reduce the warnings, ` +
        'or re-freeze deliberately with --write-baseline.',
    };
  }
  if (ceiling < baseline.warnings) {
    return {
      ok: false,
      message:
        `lint-ceiling-declared-vs-frozen FELL (${baseline.warnings} → ${ceiling}). Re-freeze it in the SAME ` +
        'change — --write-baseline — or the gain is a licence to grow back.',
    };
  }
  return { ok: true, message: null };
}

function main() {
  requireGovernedTree(WORKSPACE_ROOT, ['package.json'], {
    scan: 'lint-ceiling-declared-vs-frozen',
    why: 'the ceiling is read from the root manifest; with no manifest there is no ceiling to judge and a pass would mean nothing',
  });
  const { ceiling, reason } = ceilingIn(
    readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'),
  );
  const verdict = judge(ceiling, reason, loadBaseline());
  if (!verdict.ok) {
    console.error(verdict.message);
    process.exitCode = 1;
    return;
  }
  // This scan declares NO measured size, deliberately. It judges exactly one thing — the root
  // manifest's lint script — always. A declared size of `1` cannot vary, and a number that cannot
  // vary is not a measurement; the provenance floor would then require a counter test pinning a
  // constant. The alternative offered was the pending-debt list, which is adoption of debt rather
  // than avoidance of it (the argument INFRA-038 made and this session kept).
  //
  // The marker string is deliberately not written anywhere in this file, including in comments:
  // the provenance scan detects it in the SOURCE, so mentioning it is enough to be judged as
  // declaring one. Found by doing exactly that.
  console.log(
    `lint-ceiling-declared-vs-frozen scan passed (ceiling ${ceiling}, at baseline; enforced by ` +
      '`--max-warnings` on the release path and on every develop pull request, not by this scan).',
  );
}

function writeBaseline() {
  const { ceiling, reason } = ceilingIn(
    readFileSync(path.join(WORKSPACE_ROOT, 'package.json'), 'utf8'),
  );
  if (ceiling === null) {
    console.error(`lint-ceiling-declared-vs-frozen: cannot freeze — ${reason}.`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify({ warnings: ceiling }, null, 2)}\n`);
  console.log(`lint-ceiling-declared-vs-frozen baseline frozen: ${ceiling} warning(s)`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--write-baseline')) writeBaseline();
  else main();
}
