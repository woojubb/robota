import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { encodeWorkerLine } from './outcome-coding-protocol.js';
import { createScriptedUpstream } from './outcome-coding-relay.js';
import { planScriptedTrial } from './outcome-coding-scripts.js';
import { BASELINE_SETTINGS } from './outcome-coding-settings.js';
import { CODING_TASKS } from './outcome-coding-tasks.js';
import {
  buildWorkerContainerArgs,
  materializeWorkerTree,
  readBoundedLines,
  runTrial,
  type ILaunchInput,
  type IWorkerLaunch,
} from './outcome-coding-trial.js';
import { observeTree, type ICodingObservation } from './outcome-coding-verify.js';
import type { ICodingTask } from './outcome-coding-tasks.js';

const exampleDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const endpoint = 'https://relay.invalid/v1/chat/completions';
const model = 'offline-scripted-model';

/** Starts a node child process with the host's pipes; the worker's own process, not a container. */
function launchProcess(args: string[], paths: (input: ILaunchInput) => IWorkerLaunch['paths']) {
  return (input: ILaunchInput): IWorkerLaunch => {
    const child = spawn(process.execPath, args, {
      cwd: exampleDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '' },
    });
    const exited = new Promise<number | null>((done) => {
      child.on('close', (code) => done(code));
      child.on('error', () => done(null));
    });
    return {
      paths: paths(input),
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
  };
}

const localPaths = (input: ILaunchInput): IWorkerLaunch['paths'] => ({
  projectDir: input.tree,
  gitRoot: input.trialDir,
  homeDir: join(input.trialDir, '.home'),
  stateDir: join(input.trialDir, '.state'),
});

/** Without a container there is no verifier program to run: the tree's observation stands in. */
async function observeOnly(task: ICodingTask, tree: string): Promise<ICodingObservation> {
  return observeTree(task, tree, { exitCode: 0 });
}

test('the worker container arguments isolate the worker and carry no credential', () => {
  const args = buildWorkerContainerArgs({ name: 'n', image: 'img', root: '/host/tree' });
  const text = args.join(' ');
  assert.ok(text.includes('--network none'));
  assert.ok(args.includes('--read-only'));
  assert.ok(text.includes('--cap-drop ALL'));
  assert.ok(text.includes('--user 1000:1000'));
  assert.ok(text.includes('no-new-privileges'));
  assert.ok(text.includes('/host/tree:/work/project:rw'));
  for (const flag of ['-e', '--env', '--env-file', '--privileged', '--network=host']) {
    assert.ok(!args.includes(flag), `unexpected ${flag}`);
  }
  // Only the task tree is a host mount.
  assert.equal(args.filter((argument) => argument === '-v').length, 1);
  assert.equal(args.at(-1), 'img');
});

test('the worker tree keeps protected files read-only content and makes allowed paths writable', () => {
  const root = mkdtempSync(join(tmpdir(), 'coding-tree-'));
  try {
    const task = CODING_TASKS.find((candidate) => candidate.id === 'test-diagnosis') as ICodingTask;
    materializeWorkerTree(task, root);
    const observation = observeTree(task, root, { exitCode: 1 });
    assert.equal(observation.protectedFilesUnchanged, true);
    assert.equal(observation.noUnexpectedFiles, true);
    assert.equal(observation.noEscapes, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  'the worker runs a scripted solve end to end through the relay on the current runtime',
  { skip: process.platform === 'win32', timeout: 120_000 },
  async () => {
    const task = CODING_TASKS.find((candidate) => candidate.id === 'bug-repair') as ICodingTask;
    const base = mkdtempSync(join(tmpdir(), 'coding-trial-test-'));
    try {
      // The worker sees the tree at its host path here, so the script names that path.
      let scripted: ReturnType<typeof createScriptedUpstream> | undefined;
      const record = await runTrial({
        task,
        model,
        endpoint,
        upstream: (call) => (scripted as NonNullable<typeof scripted>)(call),
        launch: (input) => {
          const plan = planScriptedTrial(task, 'solve', input.tree);
          scripted = createScriptedUpstream(plan?.steps ?? []);
          return launchProcess(
            ['--import', 'tsx', 'src/outcome-coding-worker.ts'],
            localPaths,
          )(input);
        },
        verify: observeOnly,
        baseDir: base,
        deadlineMs: 90_000,
        trialName: 'local',
      });
      assert.deepEqual(
        record.relayLog.map((entry) => entry.outcome),
        ['forwarded', 'forwarded', 'forwarded', 'forwarded'],
      );
      assert.equal(record.result?.completed, true, JSON.stringify(record.diagnostics));
      assert.ok(record.report.toolCalls >= 2);
      assert.equal(record.upstreamAttempts, record.relayLog.length);
      assert.equal(BASELINE_SETTINGS.maxTurns, 8);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test(
  'a worker whose requests the relay refuses never reaches the reply source',
  { skip: process.platform === 'win32', timeout: 120_000 },
  async () => {
    const task = CODING_TASKS.find((candidate) => candidate.id === 'bug-repair') as ICodingTask;
    const base = mkdtempSync(join(tmpdir(), 'coding-trial-test-'));
    const scripted = createScriptedUpstream([{ text: 'unreachable' }]);
    try {
      const record = await runTrial({
        task,
        model,
        endpoint,
        upstream: scripted,
        launch: launchProcess(['--import', 'tsx', 'src/outcome-coding-worker.ts'], localPaths),
        verify: observeOnly,
        baseDir: base,
        deadlineMs: 90_000,
        policy: { allowedTools: BASELINE_SETTINGS.allowedTools.filter((name) => name !== 'Grep') },
        trialName: 'local-refusal',
      });
      assert.equal(scripted.calls(), 0);
      assert.equal(record.upstreamAttempts, 0);
      assert.ok(record.relayLog.length >= 1);
      assert.ok(
        record.relayLog.every((entry) => entry.outcome === 'refused' && entry.code === 'tool'),
      );
      assert.equal(record.score.passed, false);
      assert.ok(record.score.failures.includes('not-completed'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test('a worker line past the bound is dropped and the worker is stopped, never buffered', async () => {
  const task = CODING_TASKS.find((candidate) => candidate.id === 'bug-repair') as ICodingTask;
  const base = mkdtempSync(join(tmpdir(), 'coding-trial-test-'));
  try {
    const record = await runTrial({
      task,
      model,
      endpoint,
      upstream: createScriptedUpstream([]),
      launch: launchProcess(
        ['-e', "process.stdout.write('x'.repeat(5_000_000)); setTimeout(() => {}, 60_000);"],
        localPaths,
      ),
      verify: observeOnly,
      baseDir: base,
      deadlineMs: 30_000,
      policy: { maxBodyBytes: 1_000 },
      trialName: 'local-long-line',
    });
    assert.equal(record.result, undefined);
    assert.ok(record.diagnostics.some((line) => line.includes('exceeded the bound')));
    assert.equal(record.upstreamAttempts, 0);
    assert.ok(record.elapsedMs < 25_000);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the bounded line reader passes whole lines and drops an overlong one with a single report', async () => {
  const stream = new PassThrough();
  const lines: string[] = [];
  let overflows = 0;
  readBoundedLines(
    stream,
    10,
    (line) => lines.push(line),
    () => {
      overflows += 1;
    },
  );
  stream.write('short\nthis line is far too long');
  stream.write(' and keeps going');
  stream.write('\nnext\r\nsplit-');
  stream.write('line\nlast');
  stream.end();
  await new Promise<void>((resolve) => stream.on('end', () => resolve()));
  assert.deepEqual(lines, ['short', 'next', 'split-line', 'last']);
  assert.equal(overflows, 1);
});

test(
  'on a rate-limit or server error answer the runtime makes no second request: one admission, one upstream attempt',
  { skip: process.platform === 'win32', timeout: 120_000 },
  async () => {
    const task = CODING_TASKS.find((candidate) => candidate.id === 'bug-repair') as ICodingTask;
    for (const status of [429, 503]) {
      const base = mkdtempSync(join(tmpdir(), 'coding-trial-test-'));
      let calls = 0;
      try {
        const record = await runTrial({
          task,
          model,
          endpoint,
          upstream: async () => {
            calls += 1;
            return {
              status,
              body: { error: { message: 'rate limit exceeded: timeout', type: 'upstream' } },
            };
          },
          launch: launchProcess(['--import', 'tsx', 'src/outcome-coding-worker.ts'], localPaths),
          verify: observeOnly,
          baseDir: base,
          deadlineMs: 90_000,
          trialName: `local-retry-${status}`,
        });
        // The session's chat path reaches the provider directly: the conversation service that
        // retries on 429 and timeouts is not on it, and the client is built without retries.
        assert.equal(calls, 1, `status ${status}`);
        assert.equal(record.upstreamAttempts, 1);
        assert.equal(record.relayLog.length, 1);
        assert.equal(record.result?.completed, false);
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    }
  },
);

test('a settlement still pending when the worker reports its result is in the trial record', async () => {
  const task = CODING_TASKS.find((candidate) => candidate.id === 'bug-repair') as ICodingTask;
  const base = mkdtempSync(join(tmpdir(), 'coding-trial-test-'));
  try {
    const record = await runTrial({
      task,
      model,
      endpoint,
      upstream: async () => ({ status: 200, body: { ok: true } }),
      gate: {
        admit: () => ({
          ok: true,
          settle: async () => {
            await new Promise((wait) => setTimeout(wait, 300));
            return { stop: 'no record confirmed the call' };
          },
        }),
      },
      // A worker that sends one request and its result at once, before the settlement ends.
      launch: (): IWorkerLaunch => {
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        let reported = false;
        let done: (code: number | null) => void = () => undefined;
        const exited = new Promise<number | null>((resolve) => {
          done = resolve;
        });
        stdin.on('data', () => {
          if (reported) return;
          reported = true;
          stdout.write(
            encodeWorkerLine({
              kind: 'request',
              id: 1,
              url: endpoint,
              body: {
                model,
                messages: [
                  { role: 'system', content: 'system' },
                  { role: 'user', content: 'hello' },
                ],
              },
            }),
          );
          stdout.write(
            encodeWorkerLine({
              kind: 'result',
              completed: true,
              interrupted: false,
              response: '',
              toolCalls: 0,
              toolNames: [],
              usage: null,
              elapsedMs: 1,
            }),
          );
        });
        return {
          paths: localPaths({ name: 'pending', trialDir: base, tree: base }),
          worker: {
            stdin,
            stdout,
            stderr: new PassThrough(),
            exited,
            kill: () => done(null),
          },
        };
      },
      verify: observeOnly,
      baseDir: base,
      deadlineMs: 30_000,
      trialName: 'pending-settle',
    });
    assert.equal(record.stopReason, 'no record confirmed the call');
    assert.equal(record.relayLog.length, 1);
    assert.equal(record.relayLog[0]?.outcome, 'stopped');
    assert.ok((record.relayLog[0]?.accountingMs ?? 0) >= 250);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
