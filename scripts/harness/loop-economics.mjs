#!/usr/bin/env node

/**
 * HARNESS-114 — what a loop spent, against what it finished.
 *
 * ## The gap
 *
 * `.agents/evals/metrics.md` declared five metrics — One-Shot CI Pass Rate, Human Intervention Rate,
 * Tool Diversity Score, Spec Conformance, Build Verification Rate. Every one measures correctness,
 * autonomy or process compliance. None related what a loop spent to what it produced.
 *
 * This repository has taken that number exactly once, by hand: `record-local-review.mjs` records 38
 * review rounds across five pull requests, 24 of them blocking, at 6-10 minutes of CI each. That
 * measurement produced the local-review record and the pre-push refusal, so it demonstrably changes
 * decisions here — and it was taken by reading five pull requests, with no way to take it again.
 *
 * ## Why this reports a PROXY, and says so
 *
 * The quantity worth having is cost per accepted change. Cost is not observable from here. Under the
 * OpenTelemetry GenAI convention, token usage is emitted at the model call site by an instrumented
 * client (`gen_ai.usage.input_tokens` / `output_tokens`); this harness reads the tree and the GitHub
 * API, and neither carries a token count. Deriving a cost number from something that is not the work
 * is `measurement-provenance.md` clause 1 — the floor this repository enforces on every published
 * size — so the honest move is the one DORA made when it added deployment rework rate in 2024:
 * publish a NAMED proxy for the unobservable quantity, and say what it substitutes for.
 *
 * So this reports **loop rework rate** — the share of CLOSED runs whose terminal reason is not
 * `converged` — plus the rounds distribution per loop.
 *
 * ## What it cannot see, published with the number rather than left to be discovered
 *
 * Tokens and wall-clock. Whether a converged run's output was later reverted. Whether a run that took
 * forty rounds was worth more than one that took two — the rounds figure distinguishes them and
 * nothing here judges them.
 *
 * ## Advisory, deliberately
 *
 * No threshold blocks. The corpus starts empty, and a threshold taken from an article's assertion
 * rather than from this repository's own runs is the tautology `measurement-provenance.md` refuses.
 * The `patch-coverage` precedent: it runs and prints on every code PR and never blocks, and
 * `.github/required-status-checks.json` records why. Exit is 0 even with a poor rate; only a corrupt
 * ledger exits 1, because a report that silently drops unreadable rows publishes a denominator smaller
 * than the truth, and that error flatters in exactly one direction.
 *
 * Usage: `node scripts/harness/loop-economics.mjs`
 * Exit 0 = reported, 1 = a ledger could not be read.
 */

import path from 'node:path';

import { ledgerSkills, readLedger } from './loop-run.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** The terminal reason that means the loop finished the job it was driving. */
export const CONVERGED = 'converged';

let examinedRuns = 0;

/** How many ledger entries the last report READ. */
export function examinedRunCount() {
  return examinedRuns;
}

/**
 * Per-loop economics over the committed ledgers.
 *
 * `rounds` for a run is `roundFindings.length` and is never read from a stored count — HARNESS-112
 * deliberately stores no such field, so there is no second source for this figure to drift from.
 *
 * OPEN runs are counted separately and excluded from the rework denominator: an unfinished run has no
 * terminal reason, so including it would make it read as either converged or not, and it is neither.
 *
 * @param {string} root
 * @returns {Array<{loop: string, closed: number, open: number, reworked: number, reworkRate: number|null, rounds: number[], terminals: Record<string, number>}>}
 */
export function collectLoopEconomics(root = WORKSPACE_ROOT) {
  examinedRuns = 0;
  const report = [];
  for (const loop of ledgerSkills(root)) {
    // A line that does not parse THROWS out of readLedger. Deliberately not caught: dropping it would
    // shrink the denominator, and every rate computed from a short denominator reads better than it is.
    const entries = readLedger(root, loop);
    const rounds = [];
    const terminals = {};
    let closed = 0;
    let open = 0;
    let reworked = 0;
    for (const entry of entries) {
      examinedRuns += 1;
      if (entry.terminal === null || entry.terminal === undefined) {
        open += 1;
        continue;
      }
      closed += 1;
      rounds.push(Array.isArray(entry.roundFindings) ? entry.roundFindings.length : 0);
      terminals[entry.terminal] = (terminals[entry.terminal] ?? 0) + 1;
      if (entry.terminal !== CONVERGED) reworked += 1;
    }
    report.push({
      loop,
      closed,
      open,
      reworked,
      reworkRate: closed === 0 ? null : reworked / closed,
      rounds,
      terminals,
    });
  }
  return report;
}

/** The report as lines. `NO DATA` is printed where a rate would be, never `0%`. */
export function renderLoopEconomics(report) {
  if (report.length === 0) {
    return [
      'loop-economics: NO DATA — no loop-run ledger exists yet. A rate over zero runs is not 0%.',
    ];
  }
  const lines = [];
  for (const row of report) {
    if (row.reworkRate === null) {
      lines.push(
        `${row.loop}: NO DATA — ${row.open} open run(s), no closed run. A rate over zero closed runs is not 0%.`,
      );
      continue;
    }
    const sorted = [...row.rounds].sort((a, b) => a - b);
    const median =
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const breakdown = Object.entries(row.terminals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, n]) => `${name}=${n}`)
      .join(' ');
    lines.push(
      `${row.loop}: rework ${Math.round(row.reworkRate * 100)}% (${row.reworked}/${row.closed})  ` +
        `rounds median ${median} max ${sorted.at(-1)}  ${breakdown}` +
        (row.open > 0 ? `  [${row.open} open, excluded]` : ''),
    );
  }
  return lines;
}

function main() {
  let report;
  try {
    report = collectLoopEconomics();
  } catch (error) {
    console.error(`loop-economics: ${error.message}`);
    console.error(
      'A row that cannot be read is not a row that can be dropped — every rate below it would read better than it is.',
    );
    return 1;
  }
  for (const line of renderLoopEconomics(report)) console.log(line);
  console.log(
    '\nloop rework rate is a PROXY for cost per accepted change. It does not observe tokens or ' +
      'wall-clock (those are emitted at the model call site, which this harness has no access to), and ' +
      'it does not know whether a converged run was later reverted. Advisory — nothing blocks on it.',
  );
  // Split out of the `::examined::` template rather than inlined. The inline form was valid — backticks
  // inside a single-quoted string are literal characters, and `node --check` accepted it — but it read
  // as nested template literals to a reviewer, and a line whose correctness has to be argued is worse
  // than one that does not raise the question.
  const expectedEmpty =
    examinedRunCount() === 0
      ? ' ::expected-empty:: no loop run has been recorded yet; a ledger is created by the first `loop-run.mjs open`'
      : '';
  console.error(`::examined:: ${examinedRunCount()} loop runs${expectedEmpty}`);
  return 0;
}

const isDirectExecution =
  process.argv[1] !== undefined && process.argv[1].endsWith('loop-economics.mjs');
if (isDirectExecution) process.exitCode = main();
