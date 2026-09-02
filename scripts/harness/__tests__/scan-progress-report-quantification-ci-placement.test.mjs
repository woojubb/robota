import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SCAN_COMMANDS } from '../run-all-scans.mjs';

/**
 * HARNESS-063, second decision: does `scan-progress-report-quantification` belong on the full
 * integration scan's `--skip` list beside `dist`?
 *
 * **No**, and the two reasons the item gave were both measured rather than accepted:
 *
 * - "it is the 3rd slowest scan at 1281 ms" is a DEVELOPER-HOST figure — the host where it has
 *   transcripts to read and therefore verifies something. Measured with no transcript directory,
 *   which is the CI condition, it costs **27–31 ms**. The cost premise does not hold for CI.
 * - "the summary implies it verified something" was closed by HARNESS-057/#1561: the scan now prints
 *   its examined count and an advisory naming the zero AND the reason.
 *
 * What keeping it buys, for that ~30 ms: the full integration scan executes the module, so a crash,
 * a bad config key or a broken import fails the `scans-full` job. On the `--skip` list it would
 * never run there at all, and `run-all-scans` would print `skipped: … (--skip)` — a line that drops
 * the REASON the scan itself reports today. PR CI deliberately runs an affected suite assembled in
 * `scan_args`; it is not the authoritative whole-registry coverage point for this invariant.
 *
 * This file is the anchor for that decision. Reversing it should mean revisiting the reasons, not
 * editing a workflow line in passing.
 */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const SCAN_NAME = 'progress-report-quantification';

/**
 * The FULL-SUITE `harness:scan` invocations the post-merge `scans-full` workflow runs.
 *
 * Matching on the substring `pnpm harness:scan` was written first and was vacuous: `pnpm
 * harness:scan:build-contracts` contains it and appears EARLIER in the file, so taking the first
 * match read a line that can never carry a `--skip` and the assertion below passed with the skip
 * actually present. The word boundary is what makes it the suite entry point rather than any script
 * whose name starts the same way.
 */
function integrationFullScanCommands() {
  const workflow = readFileSync(
    path.join(WORKSPACE_ROOT, '.github/workflows/scans-full.yml'),
    'utf8',
  );
  const lines = workflow.split('\n').filter((l) => /pnpm harness:scan(\s|$)/.test(l));
  // Fail closed: no match means the workflow changed shape and this decision needs re-reading, not
  // that nothing is skipped.
  expect(
    lines.length,
    'scans-full no longer runs the full `pnpm harness:scan` suite',
  ).toBeGreaterThan(0);
  return lines;
}

describe('HARNESS-063 — the progress-report scan stays in the CI scan suite', () => {
  it('is registered, so CI runs it rather than never reaching it', () => {
    expect(SCAN_COMMANDS.map((s) => s.name)).toContain(SCAN_NAME);
  });

  it('is NOT on the full integration scan --skip list', () => {
    // `dist` and `build-contracts` are skipped because they CANNOT run on a fresh checkout at all.
    // This one runs, in ~30 ms, and reports why it judged nothing.
    for (const command of integrationFullScanCommands()) {
      expect(command).toContain('--context integration');
      expect(command).not.toContain(`--skip ${SCAN_NAME}`);
    }
  });

  it('exits 0 on a host with no narrative channel, and says both the count and the reason', () => {
    // The property that makes leaving it in CI harmless: absent transcripts are a reported SKIP, not
    // a failure and not a silent pass. If this ever became a failure, CI would go red for an absence
    // rather than a defect, and the skip-list decision would have to be retaken.
    const result = spawnScan();

    expect(result.status, result.output).toBe(0);
    expect(result.output).toMatch(/examined 0 transcript/);
    expect(result.output, 'it reported a zero without saying why').toMatch(
      /no session transcript|no agent-narrative channel/,
    );
  });

  it('costs CI about what starting node costs, not the developer-host figure', () => {
    // The measurement that falsified the cost argument, expressed RELATIVE to a bare node start so
    // it reads the same on a fast laptop and a loaded runner — an absolute millisecond bound here
    // would be a flake, and a guard that fires on correct work gets switched off.
    const bareNode = timed(() =>
      execFileSync('node', ['-e', ''], { cwd: WORKSPACE_ROOT, encoding: 'utf8' }),
    );
    const withScan = timed(spawnScan);

    expect(withScan).toBeLessThan(bareNode * 4 + 200);
  });
});

function timed(fn) {
  const started = Date.now();
  fn();
  return Date.now() - started;
}

/** Runs the scan with HOME pointed at a directory that does not exist — the CI condition. */
function spawnScan() {
  const env = { ...process.env, HOME: path.join(os.tmpdir(), 'harness-no-such-home') };
  try {
    const stdout = execFileSync(
      'node',
      ['scripts/harness/scan-progress-report-quantification.mjs'],
      { cwd: WORKSPACE_ROOT, encoding: 'utf8', env },
    );
    return { status: 0, output: stdout };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}
