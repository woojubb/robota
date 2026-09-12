import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { makeTemp } from './make-temp.mjs';

const workflow = parse(
  readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
);
const examples = workflow.jobs['examples-typecheck'];
const guarantee = examples.steps.find(
  (step) => step.name === 'Guarantee affected example consumer dist',
);

// Execute the actual workflow shell and inline Node parser. Only external planning,
// building and archive transfer are replaced; no Git fixture or real build is invoked.
function execute(run, { plan = {}, full = false, failure = 0, restoreFailure = 0 } = {}) {
  const temp = makeTemp('robota-ci-consumer-');
  const result = spawnSync(
    'bash',
    [
      '--noprofile',
      '--norc',
      '-euo',
      'pipefail',
      '-c',
      `
    node() {
      if [[ "$1" == scripts/harness/workspace-affected.mjs ]]; then
        printf '%s' "$PLAN"
      elif [[ "$1" == scripts/artifacts/transfer.mjs ]]; then
        if [[ "$RESTORE_FAILURE" != 0 ]]; then printf 'corrupt archive\\n' >&2; fi
        return "$RESTORE_FAILURE"
      else
        "$NODE_BINARY" "$@"
      fi
    }
    pnpm() { printf 'pnpm %s\\n' "$*"; return "$BUILD_FAILURE"; }
    ${run}
  `,
    ],
    {
      encoding: 'utf8',
      cwd: temp,
      env: {
        ...process.env,
        BASH_ENV: '',
        ENV: '',
        NODE_BINARY: process.execPath,
        RUNNER_TEMP: temp,
        GITHUB_OUTPUT: path.join(temp, 'output'),
        HARNESS_BASE_REF: 'origin/develop',
        FULL_VERIFICATION: String(full),
        PLAN: JSON.stringify(plan),
        BUILD_FAILURE: String(failure),
        RESTORE_FAILURE: String(restoreFailure),
      },
    },
  );
  return {
    ...result,
    output: () =>
      existsSync(path.join(temp, 'output')) ? readFileSync(path.join(temp, 'output'), 'utf8') : '',
  };
}

describe('CI consumer artifact recovery', () => {
  it.each([
    'workspace-wide input changed: .github/workflows/ci.yml',
    'unknown changed path: mystery',
    'changed-file set is empty',
  ])('honors the planner global mode without interpreting its reason: %s', (reason) => {
    const result = execute(guarantee.run, {
      plan: {
        mode: 'global',
        reason,
        packages: [],
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('pnpm build\n');
  });

  it('uses the existing full build for explicit full verification after a missing download', () => {
    const result = execute(guarantee.run, { full: true });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('pnpm build\n');
  });

  it('preserves exact affected example owner targets after a missing or partial restore', () => {
    const result = execute(guarantee.run, {
      plan: {
        mode: 'packages',
        packages: [{ directory: 'examples/cli' }, { directory: 'custom/example-owner' }],
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      'pnpm harness:workspace:run -- --operation build --changed-file examples/cli/__ci_consumer_target__.ts --changed-file custom/example-owner/__ci_consumer_target__.ts\n',
    );
  });

  it.each([
    ['full', {}, true],
    [
      'global',
      { mode: 'global', reason: 'workspace-wide input changed: package.json', packages: [] },
      false,
    ],
    ['affected', { mode: 'packages', packages: [{ directory: 'examples/cli' }] }, false],
  ])('propagates %s build failure', (_name, plan, full) => {
    const result = execute(guarantee.run, { plan, full, failure: 23 });
    expect(result.status, result.stderr).toBe(23);
  });

  it.each([
    { mode: 'unknown', packages: [] },
    { mode: 'none', packages: [] },
    { mode: 'global', packages: {} },
    { mode: 'global' },
    { mode: 'packages', packages: [] },
    { mode: 'packages', packages: [{ directory: '' }] },
    { mode: 'packages', packages: [{}] },
    {},
  ])('refuses an unknown, ownerless or malformed plan without building: %j', (plan) => {
    const result = execute(guarantee.run, { plan });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
  });

  it.each([
    ['examples-typecheck', 'EXAMPLES', 'Guarantee affected example consumer dist'],
    ['tui-e2e', 'TUI', 'Guarantee CLI and TUI consumer dist'],
  ])(
    '%s reuses uploaded output independently of producer quality and fails hard on corrupt restore',
    (jobId, capability, name) => {
      const steps = workflow.jobs[jobId].steps;
      const download = steps.find((step) => step.id === 'dist');
      const restore = steps.find((step) => step.id === 'restore');
      const consumer = steps.find((step) => step.name === name);
      expect(download.if).toBe(
        `env.${capability}_APPLICABLE == 'true' && needs.build.outputs.package_dist_required == 'true'`,
      );
      expect(download['continue-on-error']).toBe(true);
      expect(restore.if).toBe(
        `env.${capability}_APPLICABLE == 'true' && steps.dist.outcome == 'success'`,
      );
      expect(restore['continue-on-error']).toBeUndefined();
      expect(consumer.if).toBe(
        `env.${capability}_APPLICABLE == 'true' && (steps.restore.outputs.restored != 'true' || needs.build.outputs.package_dist_complete != 'true')`,
      );
      expect(consumer['continue-on-error']).toBeUndefined();
      expect(steps.indexOf(consumer)).toBeGreaterThan(steps.indexOf(restore));
      const restored = execute(restore.run);
      expect(restored.status, restored.stderr).toBe(0);
      expect(restored.output()).toBe('restored=true\n');
      const corrupt = execute(restore.run, { restoreFailure: 23 });
      expect(corrupt.status).toBe(23);
      expect(corrupt.stderr).toBe('corrupt archive\n');
      expect(corrupt.output()).toBe('');
    },
  );

  it('retains exact TUI prerequisites and the subsequent real PTY suite', () => {
    const steps = workflow.jobs['tui-e2e'].steps;
    const index = steps.findIndex((step) => step.name === 'Guarantee CLI and TUI consumer dist');
    const result = execute(steps[index].run);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      'pnpm harness:workspace:run -- --operation build --changed-file packages/agent-cli/src/__ci_consumer_target__.ts --changed-file packages/agent-transport-tui/src/__ci_consumer_target__.ts\n',
    );
    expect(steps[index + 1].run).toBe('pnpm --filter @robota-sdk/agent-transport-tui test:pty');
    expect(execute(steps[index].run, { failure: 23 }).status).toBe(23);
  });
});
