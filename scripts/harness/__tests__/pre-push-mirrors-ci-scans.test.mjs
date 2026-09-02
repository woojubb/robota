import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CI_BASE_REF_PLACEHOLDER,
  CI_HEAD_REF_PLACEHOLDER,
  CI_SCANS_JOB_MIRROR,
  createCiScansJobMirror,
} from '../pre-push.mjs';

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

/**
 * Steps that TRANSPORT a CI-only input rather than check anything.
 *
 * The pull-request body is written to `HARNESS_PR_BODY_FILE` for `scan-lane-declaration`
 * (PROC-016). Before the push there is no pull request and so no body: the local gate reads the
 * lane from the spec-document frontmatter and the commit trailers, the scan's two other sources.
 * Pinned to the exact `printf '%s' "$PR_BODY"` shape so a real check written as a `printf` would
 * still count as a command the local gate owes.
 */
const CI_TRANSPORT = [/^printf '%s' "\$PR_BODY" > "\$HARNESS_PR_BODY_FILE"$/];

const CI_ONLY = [...PROVISIONING, ...CI_TRANSPORT];

/**
 * `--base <ref>` is the one token the two sides legitimately spell differently: the workflow writes
 * `origin/${GITHUB_BASE_REF}` and the local gate writes the base it resolved. Every other flag must
 * agree verbatim, so only that value is normalised.
 */
function normaliseRefs(command) {
  return command
    .replaceAll('"', '')
    .replace(/--base-ref \S+/, '--base-ref <ref>')
    .replace(/--base \S+/, '--base <ref>');
}

function ciScansJobCommands() {
  const start = CI.indexOf('\n  scans:');
  expect(start, 'the `scans` job is gone from ci.yml — this mirror has no subject').toBeGreaterThan(
    -1,
  );
  // The next top-level job key ends it. Two-space indent, a name, a colon, end of line.
  const rest = CI.slice(start + 1);
  const next = /\n {2}[a-z][a-z0-9-]*:\n/.exec(rest.slice(1));
  const job = next ? rest.slice(0, next.index + 1) : rest;
  const lines = job.split('\n');
  const commands = [];
  for (let index = 0; index < lines.length; index++) {
    const first = lines[index].trim();
    if (!/^start_check \S+ /.test(first)) continue;
    let command = first;
    while (command.endsWith('\\')) {
      command = `${command.slice(0, -1)} ${lines[++index].trim()}`;
    }
    commands.push(
      normaliseRefs(
        command
          .replace(/^start_check \S+ /, '')
          .replace(/\s+/g, ' ')
          .trim(),
      ),
    );
  }
  return commands.filter((command) => !CI_ONLY.some((pattern) => pattern.test(command)));
}

describe('the pre-push gate mirrors the required `scans` context (INFRA-069)', () => {
  const rendered = CI_SCANS_JOB_MIRROR.map(([command, args]) =>
    normaliseRefs([command, ...args].join(' ')),
  );

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

    // And the exclusion must not have eaten the subject: a CI_ONLY pattern loose enough to
    // match a real check would empty the list above and pass everything.
    expect(commands.every((command) => /harness:/.test(command))).toBe(true);
  });

  it('runs affected contracts and scans, and skips only hermetic tests for a proven false verdict', () => {
    const scanArgs = CI_SCANS_JOB_MIRROR.find(([, args]) => args[0] === 'harness:scan')[1];
    const withoutBase = scanArgs.filter(
      (arg) => arg !== '--base' && arg !== CI_BASE_REF_PLACEHOLDER,
    );
    expect(createCiScansJobMirror({ harness: false })).toEqual([
      ['pnpm', ['harness:test:contracts:affected', '--', '--head-ref', CI_HEAD_REF_PLACEHOLDER]],
      ['pnpm', withoutBase],
    ]);
    expect(createCiScansJobMirror({ harness: false }).flatMap(([, args]) => args)).not.toContain(
      'harness:test:hermetic',
    );
    // An absent or unresolved verdict is harness-applicable: both tiers run.
    const withRefs = (base, head = CI_HEAD_REF_PLACEHOLDER) =>
      CI_SCANS_JOB_MIRROR.map(([command, args]) => [
        command,
        args.map((arg) =>
          arg === CI_BASE_REF_PLACEHOLDER ? base : arg === CI_HEAD_REF_PLACEHOLDER ? head : arg,
        ),
      ]);
    expect(createCiScansJobMirror({ harness: true }, { baseRef: 'origin/develop' })).toEqual(
      withRefs('origin/develop'),
    );
    expect(createCiScansJobMirror(undefined, { baseRef: 'abc123', headRef: 'def456' })).toEqual(
      withRefs('abc123', 'def456'),
    );
  });

  it('keeps explicit full pre-push verification on the complete contract command', () => {
    const mirror = createCiScansJobMirror(
      { harness: false },
      { baseRef: 'origin/develop', full: true },
    );
    expect(mirror[0]).toEqual(['pnpm', ['harness:test:contracts']]);
    expect(mirror.flatMap(([, args]) => args)).not.toContain('harness:test:contracts:affected');
  });

  it('runs the affected set in the pr context, with the base the gate resolved', () => {
    const [, args] = createCiScansJobMirror({ harness: true }, { baseRef: 'origin/develop' }).find(
      ([, a]) => a[0] === 'harness:scan',
    );
    expect(args).toContain('--affected');
    expect(args.slice(args.indexOf('--context'), args.indexOf('--context') + 2)).toEqual([
      '--context',
      'pr',
    ]);
    expect(args.slice(args.indexOf('--base'), args.indexOf('--base') + 2)).toEqual([
      '--base',
      'origin/develop',
    ]);
    // No base resolved: the pair is dropped rather than sent as a placeholder the runner cannot
    // resolve — the runner then falls back to the full suite and says so.
    const [, bare] = createCiScansJobMirror({ harness: true }).find(
      ([, a]) => a[0] === 'harness:scan',
    );
    expect(bare).not.toContain('--base');
    expect(bare).not.toContain(CI_BASE_REF_PLACEHOLDER);
  });

  it('aggregates concurrent child logs and fails on any missing or unsuccessful result', () => {
    const job = CI.slice(CI.indexOf('\n  scans:'), CI.indexOf('\n  dependency-audit:'));
    expect(job).toContain('pids+=("$!")');
    expect(job).toContain('wait "${pids[$index]}" || status=$?');
    expect(job).toContain('if ! cat "${logs[$index]}"');
    expect(job).toContain('if (( status != 0 ))');
    expect(job).toContain('exit "$failed"');
    expect(job).toContain('RUN_HERMETIC:');
  });
});
