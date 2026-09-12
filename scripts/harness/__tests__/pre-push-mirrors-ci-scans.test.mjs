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
 * Read the CI-owned scans job's commands from the workflow. The legacy command reference remains
 * checked in both directions; it is no longer an automatic pre-push execution plan (LOCAL-2655).
 */
/**
 * Steps that PROVISION the environment rather than check anything.
 *
 * These are excluded from the command reference, not from CI execution. Anything else must remain
 * represented so adding a CI verification command cannot silently escape this contract test.
 */
const PROVISIONING = [/^pnpm install\b/];

/**
 * Steps that TRANSPORT a CI-only input rather than check anything.
 *
 * The pull-request body is written to `HARNESS_PR_BODY_FILE` for `scan-lane-declaration`
 * (PROC-016).
 * Pinned to the exact `printf '%s' "$PR_BODY"` shape so a real check written as a `printf` would
 * still count as a verification command in the CI reference.
 */
const CI_TRANSPORT = [/^printf '%s' "\$PR_BODY" > "\$HARNESS_PR_BODY_FILE"$/];

const CI_ONLY = [...PROVISIONING, ...CI_TRANSPORT];

/**
 * Normalise the workflow's interpolated base and the command reference's base placeholder.
 * Every other flag must agree verbatim.
 */
function normaliseRefs(command) {
  return command
    .replaceAll('"', '')
    .replace(/--base-ref \S+/, '--base-ref <ref>')
    .replace(/--base \S+/, '--base <ref>');
}

function prValueOfShellArray(job, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const definition = new RegExp(`^\\s*${escapedName}=\\(([^\\r\\n]*)\\)\\s*$`);
  const append = new RegExp(`^\\s*${escapedName}\\+=\\(([^\\r\\n]*)\\)\\s*$`);
  const values = [];
  const ifStack = [];

  for (const line of job.split('\n')) {
    const trimmed = line.trim();
    if (/^if\b.*;\s*then$/.test(trimmed)) {
      ifStack.push(/^if \[\[ "\$BENCHMARK_MODE" == "true" \]\]; then$/.test(trimmed));
      continue;
    }
    if (trimmed === 'fi') {
      ifStack.pop();
      continue;
    }
    const initial = definition.exec(line);
    if (initial) {
      values.push(initial[1]);
      continue;
    }
    if (append.test(line) && !ifStack.includes(true)) {
      throw new Error(
        `\`${name}\` is appended outside the BENCHMARK_MODE-only branch; its PR value is ambiguous.`,
      );
    }
  }

  if (values.length !== 1) {
    throw new Error(
      `expected exactly one initial \`${name}=(...)\` definition, found ${values.length}.`,
    );
  }
  return values[0];
}

function ciScansJobCommands(ci = CI) {
  const start = ci.indexOf('\n  scans:');
  expect(
    start,
    'the `scans` job is gone from ci.yml — this contract has no subject',
  ).toBeGreaterThan(-1);
  // The next top-level job key ends it. Two-space indent, a name, a colon, end of line.
  const rest = ci.slice(start + 1);
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
    command = command
      .replace(/^start_check \S+ /, '')
      .replace(/\s+/g, ' ')
      .trim();
    const dynamic = /^pnpm "\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\]\}"$/.exec(command);
    if (dynamic) command = `pnpm ${prValueOfShellArray(job, dynamic[1])}`;
    commands.push(normaliseRefs(command));
  }
  return commands.filter((command) => !CI_ONLY.some((pattern) => pattern.test(command)));
}

describe('CI-owned scans retain their command coverage after local mirror removal (LOCAL-2655)', () => {
  const rendered = CI_SCANS_JOB_MIRROR.map(([command, args]) =>
    normaliseRefs([command, ...args].join(' ')),
  );

  it('accounts for every command that job runs, with the same flags', () => {
    for (const command of ciScansJobCommands()) {
      expect(
        rendered,
        `the required \`scans\` job runs \`${command}\` but the command reference omits it`,
      ).toContain(command);
    }
  });

  it('claims no command that job does not run', () => {
    const ciCommands = ciScansJobCommands();

    for (const command of rendered) {
      expect(
        ciCommands,
        `the command reference includes \`${command}\` but the required \`scans\` job does not`,
      ).toContain(command);
    }
  });

  it('reads a job that actually has commands', () => {
    // Fail closed. A parser that finds nothing would satisfy the loop above vacuously and report a
    // contract over an empty set — the accidental green this repository measures in its own work.
    const commands = ciScansJobCommands();
    console.log(`::examined:: ${commands.length} required-job commands`);
    expect(commands.length).toBeGreaterThan(0);

    // And the exclusion must not have eaten the subject: a CI_ONLY pattern loose enough to
    // match a real check would empty the list above and pass everything.
    expect(commands.every((command) => /harness:/.test(command))).toBe(true);
  });

  it('expands the PR value of scan_args and excludes only its benchmark-only additions', () => {
    const scan = ciScansJobCommands().find((command) => /harness:scan\b/.test(command));
    expect(scan).toBe(
      'pnpm harness:scan -- --skip dist --skip build-contracts --affected --context pr --base <ref>',
    );
    expect(scan).not.toContain('lane-declaration');
    expect(scan).not.toContain('user-execution-plan-order');
    expect(scan).not.toContain('work-run-measurement');
  });

  it('fails closed if scan_args gains a non-benchmark append', () => {
    const unguarded = CI.replace(
      'if [[ "$BENCHMARK_MODE" == "true" ]]; then',
      'if [[ "$RUN_HERMETIC" == "true" ]]; then',
    );
    expect(() => ciScansJobCommands(unguarded)).toThrow(/outside the BENCHMARK_MODE-only branch/);
  });

  it('represents affected contracts and scans, omitting hermetic only for a proven false verdict', () => {
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

  it('preserves the legacy full command-reference variant without executing it', () => {
    const mirror = createCiScansJobMirror(
      { harness: false },
      { baseRef: 'origin/develop', full: true },
    );
    expect(mirror[0]).toEqual(['pnpm', ['harness:test:contracts']]);
    expect(mirror.flatMap(([, args]) => args)).not.toContain('harness:test:contracts:affected');
  });

  it('substitutes the supplied base in the affected PR command reference', () => {
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
