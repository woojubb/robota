import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const CI_WORKFLOW = path.join(WORKSPACE_ROOT, '.github/workflows/ci.yml');
const PROMOTE_SCRIPT = path.join(WORKSPACE_ROOT, 'scripts/harness/promote.mjs');

/**
 * The job name `protect-main` requires. Not a guess — `scan-main-required-checks` pins the ruleset's
 * contexts, and this is the substantive one.
 */
const MAIN_ONLY_JOB = 'release-grade verification';

/**
 * The `pnpm harness:*` entry points inside ONE named job.
 *
 * Scoped to the job's own block rather than grepped over the whole file: `ci.yml` runs several
 * harness entry points across its jobs, so a file-wide match would answer a different question than
 * the one being asked and pass for the wrong reason. The harness parses workflows as text
 * throughout — no YAML dependency exists here — so this reads the block boundary instead of the
 * document, which is the narrowest honest version of that.
 *
 * Returns `null` when the job is absent, so a rename fails loudly instead of vacuously.
 */
export function harnessEntryPointsOfJob(workflowText, jobDisplayName) {
  const lines = workflowText.split('\n');
  const nameIndex = lines.findIndex((line) => line.trim() === `name: ${jobDisplayName}`);
  if (nameIndex === -1) return null;

  // A job's key sits at 2-space indent; its body is deeper. Walk to the next key at that depth.
  const entryPoints = [];
  for (let i = nameIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}\S/.test(line)) break;
    // Both shapes: `run: pnpm harness:x` inline, and a block scalar's own line.
    const match = /^\s*(?:-\s+)?(?:run:\s*)?(pnpm\s+harness:[\w:-]+)\s*$/.exec(line);
    if (match) entryPoints.push(match[1]);
  }
  return entryPoints;
}

/**
 * INFRA-056 pinned `verify-like-ci`'s stages against `protect-develop`'s required jobs, and stopped
 * there. `protect-main`'s substantive required context — `release-grade verification` — runs on NO
 * other branch, so nothing local told you what it would say until the promotion PR was already open.
 *
 * Measured 2026-07-27: two consecutive promotions failed on that job, each costing an
 * open-PR → CI → diagnose → fix → re-promote round trip. `pnpm harness:verify:release` is what the
 * job runs, existed the whole time, and was simply never wired to the act of promoting.
 *
 * That is the same defect shape INFRA-056 fixed one level over: an entry point NAMED as a gate's
 * equivalent while nothing connected it to the gate. `verify-like-ci.mjs`'s own header names this
 * command — writing it down was not enough, which is the general lesson here.
 *
 * So the pin is on the CONNECTION, not on a literal: whatever entry point `protect-main`'s required
 * job runs, `promote.mjs` must run the same one before declaring a promotion branch ready. Change
 * the job and this fails until the preflight follows.
 */
describe('promotion preflight mirrors protect-main', () => {
  const workflowText = readFileSync(CI_WORKFLOW, 'utf8');
  const promoteSource = readFileSync(PROMOTE_SCRIPT, 'utf8');

  it('finds the main-only required job', () => {
    // Fail closed: a rename would make every assertion below pass over nothing.
    expect(harnessEntryPointsOfJob(workflowText, MAIN_ONLY_JOB)).not.toBeNull();
  });

  it('reads exactly one harness entry point from that job', () => {
    // More than one means "which command mirrors this gate" has several answers and the pin below
    // would silently check whichever came first.
    expect(harnessEntryPointsOfJob(workflowText, MAIN_ONLY_JOB)).toHaveLength(1);
  });

  it('runs, before promoting, the same entry point that job runs', () => {
    const [entryPoint] = harnessEntryPointsOfJob(workflowText, MAIN_ONLY_JOB) ?? [];
    const [command, script] = entryPoint.split(/\s+/);
    const invoked = new RegExp(`['"\`]${command}['"\`][\\s\\S]{0,80}?['"\`]${script}['"\`]`).test(
      promoteSource,
    );

    expect(
      invoked,
      `promote.mjs must run \`${entryPoint}\` — what \`${MAIN_ONLY_JOB}\` runs — before it declares a ` +
        "promotion branch ready. Otherwise the first time anyone learns that gate's verdict is on an " +
        'open promotion PR.',
    ).toBe(true);
  });

  it('treats a failing preflight as blocking, not advisory', () => {
    // A preflight that runs and ignores its exit code is decoration. The script must branch on the
    // status and abandon the branch rather than print a warning beside a "ready" line.
    expect(promoteSource).toMatch(/status\s*!==\s*0/);
    expect(promoteSource).toMatch(/PromoteError/);
  });
});
