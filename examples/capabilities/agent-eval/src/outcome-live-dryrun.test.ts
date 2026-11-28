import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { countLeaksInPath } from './outcome-coding-credential.js';
import { planScriptedTrial } from './outcome-coding-scripts.js';
import { CODING_TASKS, type ICodingTask } from './outcome-coding-tasks.js';
import type { ILaunchInput, IWorkerLaunch } from './outcome-coding-trial.js';
import { observeTree, type ICodingObservation } from './outcome-coding-verify.js';
import { planDelegationTrial } from './outcome-delegation-scripts.js';
import { runDriver, type IDriverDeps, type IRuntime } from './outcome-live-driver.js';
import { makeHarness, SECRET, type IHarness } from './outcome-live-testing.js';

const exampleDir = join(import.meta.dirname, '..');
const task = CODING_TASKS.find((candidate) => candidate.id === 'bug-repair') as ICodingTask;

/** Starts the worker as a plain node process with the host's pipes; the container is opt-in. */
function launchProcess(input: ILaunchInput): IWorkerLaunch {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/outcome-coding-worker.ts'], {
    cwd: exampleDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH ?? '' },
  });
  const exited = new Promise<number | null>((done) => {
    child.on('close', (code) => done(code));
    child.on('error', () => done(null));
  });
  return {
    paths: {
      projectDir: input.tree,
      gitRoot: input.trialDir,
      homeDir: join(input.trialDir, '.home'),
      stateDir: join(input.trialDir, '.state'),
    },
    worker: {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      exited,
      kill: () => {
        child.kill('SIGKILL');
      },
    },
  };
}

/** Without a container there is no verifier program to run: the verdict is whether the tree holds the solved files. */
async function observeSolved(candidate: ICodingTask, tree: string): Promise<ICodingObservation> {
  const solved = Object.entries(candidate.solved).every(([path, content]) => {
    const file = join(tree, path);
    return existsSync(file) && readFileSync(file, 'utf8') === content;
  });
  return observeTree(candidate, tree, { exitCode: solved ? 0 : 1 });
}

function dryDeps(harness: IHarness): IDriverDeps {
  const runtime: IRuntime = {
    commit: 'abc123',
    launch: launchProcess,
    verify: observeSolved,
    dispose: () => undefined,
  };
  return harness.deps({
    prepareRuntime: async () => runtime,
    plan: { tasks: [task], trialsPerTask: 1 },
    dryRun: {
      gateway: harness.gateway,
      replyFor: (candidate, arm, projectDir) => {
        const plan =
          arm === 'delegation'
            ? planDelegationTrial(candidate, 'pass', projectDir)
            : planScriptedTrial(candidate, 'solve', projectDir);
        if (plan === undefined) throw new Error('no scripted reply');
        return plan.steps;
      },
    },
  });
}

const options = { skip: process.platform === 'win32', timeout: 300_000 } as const;

test(
  'a dry run end to end: real worker and relay, the ledger gate and a loopback gateway, both arms, one request per admission',
  options,
  async () => {
    const harness = await makeHarness();
    try {
      const result = await runDriver(
        harness.config({ dryRun: true, decisionRuleUrl: undefined, deadlineMs: 90_000 }),
        dryDeps(harness),
      );
      const { summary } = result;
      assert.equal(result.exitCode, 0, JSON.stringify([summary.halt, summary.cleanup]));
      assert.equal(summary.finished, true);
      // Two smoke trials and one counted trial per arm; the counted ones pass by the verifier's verdict.
      assert.equal(summary.slotsTotal, 4);
      assert.equal(summary.arms.delegation?.passes, 1);
      assert.equal(summary.arms.control?.passes, 1);
      assert.deepEqual(
        summary.uncounted.smoke.map((smoke) => [smoke.arm, smoke.outcome]),
        [
          ['delegation', 'pass'],
          ['control', 'pass'],
        ],
      );
      // With fewer than three counted trials per task and arm the outcome stays inconclusive.
      assert.equal(summary.outcome, 'inconclusive');
      // One admission, one upstream request, and every request carried the credential only to the loopback gateway.
      const admitted = (summary.bound as { callsAdmitted: number }).callsAdmitted;
      assert.ok(admitted > 4);
      assert.equal(harness.gateway.chatBodies.length, admitted);
      assert.ok(harness.gateway.chatAuth.every((value) => value === `Bearer ${SECRET}`));
      assert.equal(summary.bound?.settledMicros, admitted * 100);
      assert.equal(summary.bound?.reservedMicros, 0);
      // Roles are attributed in the delegation arm and the control arm has its single role.
      const delegationRoles = Object.keys(summary.arms.delegation?.byRole ?? {});
      assert.ok(delegationRoles.includes('parent') && delegationRoles.includes('implementer'));
      assert.deepEqual(Object.keys(summary.arms.control?.byRole ?? {}), ['agent']);
      // The observations were written once per trial, before scoring, with the measures beside them.
      const observations = readdirSync(join(harness.evidence, 'observations'));
      assert.equal(observations.length, 4);
      const first = JSON.parse(
        readFileSync(join(harness.evidence, 'observations', observations[0] as string), 'utf8'),
      ) as { measures?: unknown };
      assert.ok(first.measures !== undefined);
      assert.ok(summary.cleanup.every((check) => check.ok));
      assert.equal(summary.leakScan?.leaks, 0);
      assert.equal(countLeaksInPath(SECRET, harness.evidence).leaks, 0);
      assert.deepEqual(readdirSync(harness.base), []);
    } finally {
      await harness.close();
    }
  },
);

test(
  'a dry run whose gateway answers with another provider stops after the first mismatching call and sends nothing more',
  options,
  async () => {
    const harness = await makeHarness();
    try {
      harness.gateway.behavior = (index) =>
        index === 1
          ? { kind: 'receipt', generation: { provider_name: 'some-other-route' } }
          : { kind: 'receipt' };
      const result = await runDriver(
        harness.config({ dryRun: true, decisionRuleUrl: undefined, deadlineMs: 90_000 }),
        dryDeps(harness),
      );
      assert.equal(result.exitCode, 1);
      assert.equal(result.summary.halt?.kind, 'spend-gate');
      assert.match(result.summary.halt?.reason ?? '', /provider differs/);
      assert.equal(harness.gateway.chatBodies.length, 2);
      assert.equal(result.summary.uncounted.infrastructureStops.length, 1);
      assert.equal(result.summary.slotsClosed, 0);
      assert.ok(result.summary.cleanup.every((check) => check.ok));
    } finally {
      await harness.close();
    }
  },
);
