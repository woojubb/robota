import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createScriptedUpstream } from './outcome-coding-relay.js';
import { CODING_TASKS, type ICodingTask } from './outcome-coding-tasks.js';
import {
  DEFAULT_TRIAL_CALL_CAP,
  materializeWorkerTree,
  runTrial,
  type ILaunchInput,
  type ITrialRecord,
  type IWorkerLaunch,
} from './outcome-coding-trial.js';
import { observeTree, type ICodingObservation } from './outcome-coding-verify.js';
import { planScriptedTrial } from './outcome-coding-scripts.js';
import { scoreTrial } from './outcome-coding-score.js';
import { delegationRoles, IMPLEMENTER_ROLE } from './outcome-delegation-roles.js';
import { planDelegationTrial, type TDelegationBehavior } from './outcome-delegation-scripts.js';

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = 'https://relay.invalid/v1/chat/completions';
const model = 'offline-scripted-model';
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

/**
 * Without a container there is no verifier program to run, so the verdict is computed here from the
 * tree itself: the task's own verifier is not used, only whether the tree holds the solved files.
 */
async function observeSolved(candidate: ICodingTask, tree: string): Promise<ICodingObservation> {
  const solved = Object.entries(candidate.solved).every(([path, content]) => {
    const file = join(tree, path);
    return existsSync(file) && readFileSync(file, 'utf8') === content;
  });
  return observeTree(candidate, tree, { exitCode: solved ? 0 : 1 });
}

async function run(
  behavior: TDelegationBehavior,
  extra: Partial<Parameters<typeof runTrial>[0]> = {},
): Promise<{ record: ITrialRecord; calls: number; planFailures: readonly string[] }> {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'delegation-trial-test-'));
  try {
    let scripted: ReturnType<typeof createScriptedUpstream> | undefined;
    let planned: ReturnType<typeof planDelegationTrial> | undefined;
    const record = await runTrial({
      task,
      model,
      endpoint,
      upstream: (call) => (scripted as NonNullable<typeof scripted>)(call),
      launch: (input) => {
        planned = planDelegationTrial(task, behavior, input.tree);
        scripted = createScriptedUpstream(planned?.steps ?? []);
        return launchProcess(input);
      },
      verify: observeSolved,
      baseDir: base,
      deadlineMs: 90_000,
      delegation: {},
      trialName: `delegation-${behavior}`,
      ...extra,
    });
    return {
      record,
      calls: (scripted as NonNullable<typeof scripted>).calls(),
      planFailures: planned?.expectedFailures ?? [],
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const options = { skip: process.platform === 'win32', timeout: 180_000 } as const;

test(
  'a scripted delegation passes: implementer, reviewer, serially, every call attributed',
  options,
  async () => {
    const { record, calls } = await run('pass');
    assert.deepEqual(record.score.failures, [], JSON.stringify(record.diagnostics));
    assert.equal(record.score.passed, true);
    assert.equal(record.capReached, false);
    assert.equal(record.stopReason, undefined);
    assert.equal(record.upstreamAttempts, calls);
    const roles = record.relayLog.map((entry) => entry.role);
    // parent, implementer (read, write, done), parent, reviewer (read, done), parent
    assert.deepEqual(roles.slice(0, 2), ['parent', 'implementer']);
    assert.ok(roles.includes('reviewer'));
    assert.ok(
      roles.every((role) => role === 'parent' || role === 'implementer' || role === 'reviewer'),
    );
    assert.equal(record.measures.childJobsStarted, 2);
    assert.equal(record.measures.childJobsRefused, 0);
    assert.ok((record.measures.byRole.implementer?.calls ?? 0) >= 2);
    assert.equal(record.measures.total.calls, calls);
    assert.ok((record.measures.coordination.idleBetweenJobsMs ?? -1) >= 0);
    assert.equal(
      record.measures.coordination.calls,
      (record.measures.byRole.parent?.calls ?? 0) + (record.measures.byRole.reviewer?.calls ?? 0),
    );
  },
);

test(
  'a reviewer that approves broken code does not make the trial pass: the verdict is the tree',
  options,
  async () => {
    const { record } = await run('broken-approved');
    assert.deepEqual(
      record.score.failures,
      ['verifier-failed'],
      JSON.stringify(record.diagnostics),
    );
    assert.equal(record.result?.completed, true);
    assert.match(record.result?.response ?? '', /Done/);
    assert.equal(record.measures.childJobsStarted, 2);
  },
);

test('a parent that claims the work is done without delegating fails', options, async () => {
  const { record, planFailures } = await run('no-delegation');
  assert.deepEqual([...record.score.failures].sort(), [...planFailures].sort());
  assert.equal(record.measures.childJobsStarted, 0);
  assert.equal(record.measures.byRole.parent?.calls, 1);
  assert.equal(record.measures.byRole.implementer, undefined);
});

test(
  'a parent has no write tool: its own write is not executed and the tree stays broken',
  options,
  async () => {
    const { record, planFailures } = await run('parent-writes');
    assert.deepEqual([...record.score.failures].sort(), [...planFailures].sort());
    assert.equal(record.observation.exitCode, 1);
  },
);

test(
  'a reviewer has no write tool either: a write attempt leaves the tree broken',
  options,
  async () => {
    const { record, planFailures } = await run('reviewer-writes');
    assert.deepEqual([...record.score.failures].sort(), [...planFailures].sort());
    assert.equal(record.observation.exitCode, 1);
  },
);

test(
  'a fourth child job is refused and recorded, and the verdict still comes from the tree',
  options,
  async () => {
    const { record } = await run('fourth-spawn');
    assert.equal(record.measures.childJobsStarted, 3, JSON.stringify(record.diagnostics));
    assert.equal(record.measures.childJobsRefused, 1);
    assert.equal(record.result?.delegation?.jobsRefused, 1);
    // Three jobs ran and the tree was solved by the first: the refusal alone is not a failure.
    assert.deepEqual(record.score.failures, []);
  },
);

test(
  'the call past the per-trial cap is refused, the trial ends failed and stays counted',
  options,
  async () => {
    const plan = planDelegationTrial(task, 'call-cap', '/x');
    const { record, calls } = await run('call-cap', { maxCalls: plan?.maxCalls });
    assert.equal(record.capReached, true);
    assert.equal(calls, plan?.maxCalls);
    assert.equal(record.upstreamAttempts, plan?.maxCalls);
    assert.deepEqual([...record.score.failures].sort(), [...(plan?.expectedFailures ?? [])].sort());
    assert.equal(record.score.passed, false);
    assert.ok(record.relayLog.some((entry) => entry.code === 'cap'));
  },
);

test('an unattributed call stops the run before anything is sent', options, async () => {
  const roles = delegationRoles('/work/project').map((role) =>
    role.name === IMPLEMENTER_ROLE
      ? { ...role, systemPrompt: role.systemPrompt.replace(role.marker, 'no marker here') }
      : role,
  );
  const { record, calls } = await run('pass', { delegation: { roles } });
  // The parent's first request and its delegation went through; the implementer's did not.
  assert.match(record.stopReason ?? '', /unattributed call/);
  assert.ok(record.relayLog.some((entry) => entry.code === 'unattributed'));
  assert.equal(calls, 1);
  assert.ok(record.score.failures.includes('run-stopped'));
  assert.equal(record.score.passed, false);
});

test(
  'the single-agent path is capped too: a runaway script ends failed at the shared cap',
  options,
  async () => {
    const base = mkdtempSync(join(realpathSync(tmpdir()), 'delegation-trial-test-'));
    try {
      const first = Object.keys(task.files)[0] as string;
      let scripted: ReturnType<typeof createScriptedUpstream> | undefined;
      const record = await runTrial({
        task,
        model,
        endpoint,
        upstream: (call) => (scripted as NonNullable<typeof scripted>)(call),
        launch: (input) => {
          scripted = createScriptedUpstream(
            Array.from({ length: 12 }, () => ({
              toolCalls: [{ name: 'Read', args: { filePath: `${input.tree}/${first}` } }],
            })),
          );
          return launchProcess(input);
        },
        verify: observeSolved,
        baseDir: base,
        deadlineMs: 90_000,
        maxCalls: 4,
        trialName: 'single-cap',
      });
      assert.equal(record.capReached, true);
      assert.equal(record.upstreamAttempts, 4);
      assert.equal((scripted as NonNullable<typeof scripted>).calls(), 4);
      assert.ok(record.score.failures.includes('call-cap'));
      assert.equal(record.measures.byRole.agent?.calls, 4);
      assert.equal(record.measures.childJobsStarted, null);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test(
  'a single-agent solve under the cap is unaffected and the default cap is the shared one',
  options,
  async () => {
    assert.equal(DEFAULT_TRIAL_CALL_CAP, 20);
    const base = mkdtempSync(join(realpathSync(tmpdir()), 'delegation-trial-test-'));
    try {
      let scripted: ReturnType<typeof createScriptedUpstream> | undefined;
      const record = await runTrial({
        task,
        model,
        endpoint,
        upstream: (call) => (scripted as NonNullable<typeof scripted>)(call),
        launch: (input) => {
          scripted = createScriptedUpstream(
            planScriptedTrial(task, 'solve', input.tree)?.steps ?? [],
          );
          return launchProcess(input);
        },
        verify: observeSolved,
        baseDir: base,
        deadlineMs: 90_000,
        trialName: 'single-under-cap',
      });
      assert.deepEqual(record.score.failures, [], JSON.stringify(record.diagnostics));
      assert.equal(record.capReached, false);
      assert.equal(record.measures.byRole.agent?.calls, record.upstreamAttempts);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test('the controls score as the pure function says: nothing but the tree and the counters decide', () => {
  const root = mkdtempSync(join(tmpdir(), 'delegation-score-test-'));
  materializeWorkerTree(task, root);
  const observation = observeTree(task, root, { exitCode: 0 });
  rmSync(root, { recursive: true, force: true });
  const base = { completed: true, interrupted: false, toolCalls: 3 } as const;
  assert.equal(scoreTrial({ ...base, childCalls: 2 }, observation).passed, true);
  assert.deepEqual(scoreTrial({ ...base, childCalls: 0 }, observation).failures, [
    ...scoreTrial({ ...base, childCalls: 2 }, observation).failures,
    'not-delegated',
  ]);
  assert.ok(scoreTrial({ ...base, capReached: true }, observation).failures.includes('call-cap'));
  assert.ok(scoreTrial({ ...base, stopped: true }, observation).failures.includes('run-stopped'));
});
