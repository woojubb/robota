import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CI_SCANS_JOB_MIRROR } from '../pre-push.mjs';

const CI = readFileSync(
  path.resolve(import.meta.dirname, '../../../.github/workflows/ci.yml'),
  'utf8',
);

/**
 * Every `run:` command the required `scans` job executes, READ from the workflow.
 *
 * Read rather than restated. A hand-copied list is a second source that agrees on the day it is
 * written and silently stops agreeing afterwards — the drift this whole item is about, since the
 * declared mirror `verify-like-ci` was described as CI-equivalent while being invoked by nothing.
 */
/**
 * Steps that PROVISION the environment rather than check anything.
 *
 * A developer's checkout is the environment, so reproducing its creation locally verifies nothing.
 * Kept deliberately narrow, and narrow is the safety property: anything NOT matched here is treated
 * as a check the local gate owes, so a verification step added to the job tomorrow fails this case
 * instead of quietly widening the gap the item was filed about.
 */
const PROVISIONING = [/^pnpm install\b/];

function ciScansJobCommands() {
  const start = CI.indexOf('\n  scans:');
  expect(start, 'the `scans` job is gone from ci.yml — this mirror has no subject').toBeGreaterThan(
    -1,
  );
  // The next top-level job key ends it. Two-space indent, a name, a colon, end of line.
  const rest = CI.slice(start + 1);
  const next = /\n {2}[a-z][a-z0-9-]*:\n/.exec(rest.slice(1));
  const job = next ? rest.slice(0, next.index + 1) : rest;
  return [...job.matchAll(/^ +run: (.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((command) => !PROVISIONING.some((pattern) => pattern.test(command)));
}

describe('the pre-push gate mirrors the required `scans` context (INFRA-069)', () => {
  const rendered = CI_SCANS_JOB_MIRROR.map(([command, args]) => [command, ...args].join(' '));

  it('runs every command that job runs, with the same flags', () => {
    // Same flags in BOTH directions. Running less locally is the defect this item filed; running
    // more would refuse pushes CI accepts, which is how a gate earns a habitual --no-verify.
    for (const command of ciScansJobCommands()) {
      expect(
        rendered,
        `the required \`scans\` job runs \`${command}\` and pre-push does not`,
      ).toContain(command);
    }
  });

  it('runs nothing that job does not run', () => {
    // The other direction, and it was missing while two comments claimed both were covered. A local
    // gate that runs MORE than CI refuses pushes CI would accept — the guard-fires-on-correct-work
    // failure this change argues against in its own docstring, which would have stayed green here.
    //
    // Provisioning is excluded on the CI side, so it must be excluded from the comparison rather
    // than from the mirror: the local gate legitimately does not reinstall dependencies.
    const ciCommands = ciScansJobCommands();

    for (const command of rendered) {
      expect(
        ciCommands,
        `pre-push runs \`${command}\` and the required \`scans\` job does not`,
      ).toContain(command);
    }
  });

  it('reads a job that actually has commands', () => {
    // Fail closed. A parser that finds nothing would satisfy the loop above vacuously and report a
    // mirror over an empty set — the accidental green this repository measures in its own work.
    const commands = ciScansJobCommands();
    console.log(`::examined:: ${commands.length} required-job commands`);
    expect(commands.length).toBeGreaterThan(0);

    // And the exclusion must not have eaten the subject: a PROVISIONING pattern loose enough to
    // match a real check would empty the list above and pass everything.
    expect(commands.every((command) => /harness:/.test(command))).toBe(true);
  });
});
