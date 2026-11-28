/**
 * Opt-in offline run, Docker required. In one pass it checks everything that must hold before any
 * paid call: the broken and solved controls of every task in the verifier container, the worker
 * container's isolation canaries, that the worker image contains no solution or verifier, and a set
 * of scripted trials with known verdicts that run through the real worker and the validating relay.
 * No network model, no credential, no cost.
 *
 *   pnpm --filter robota-capability-agent-eval coding:offline [--source <checkout>] [--revision <rev>]
 *     [--node-image <image>] [--verifier-image <image>] [--model <id>] [--endpoint <url>]
 *     [--base <host directory the daemon can mount>] [--image <built tag>] [--keep-image] [--out <file>]
 *
 * The image is built from a clean export of the revision (default HEAD, which must have no tracked
 * changes), so the tested source is the committed source. Run it once; it takes several minutes.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  assembleImageContext,
  buildImage,
  forbiddenTexts,
  removeImage,
  searchImage,
  searchTree,
  type ISearchHit,
} from './outcome-coding-image.js';
import { runIsolationCanaries } from './outcome-coding-isolation.js';
import { createScriptedUpstream } from './outcome-coding-relay.js';
import {
  planScriptedTrial,
  type IScriptedTrialPlan,
  type TScriptedBehavior,
} from './outcome-coding-scripts.js';
import { BASELINE_SETTINGS, forcedRequestFields } from './outcome-coding-settings.js';
import { CODING_TASKS, type ICodingTask } from './outcome-coding-tasks.js';
import { CONTAINER_PATHS, createDockerLauncher, runTrial } from './outcome-coding-trial.js';
import { materializeTask, runContainerVerifier } from './outcome-coding-verify.js';

const here = dirname(fileURLToPath(import.meta.url));

const { values: flags } = parseArgs({
  options: {
    source: { type: 'string', default: resolve(here, '../../../..') },
    revision: { type: 'string', default: 'HEAD' },
    'node-image': { type: 'string', default: 'node:22-bookworm-slim' },
    'verifier-image': { type: 'string' },
    model: { type: 'string', default: 'offline-scripted-model' },
    endpoint: { type: 'string', default: 'https://relay.invalid/v1/chat/completions' },
    base: { type: 'string', default: homedir() },
    image: { type: 'string' },
    'keep-image': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

const source = resolve(flags.source);
const nodeImage = flags['node-image'];
const verifierImage = flags['verifier-image'] ?? nodeImage;
const baseDir = resolve(flags.base);

interface IStepRecord {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: Record<string, unknown>;
}
const steps: IStepRecord[] = [];
const started = Date.now();

function record(name: string, ok: boolean, detail: Record<string, unknown> = {}): void {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${JSON.stringify(detail)}`}`);
}

function docker(args: string[]): string {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`docker ${args.join(' ')}: ${result.stderr.slice(-400)}`);
  return result.stdout.trim();
}

async function controls(): Promise<void> {
  for (const task of CODING_TASKS) {
    const verdicts: Record<string, number | null> = {};
    for (const kind of ['broken', 'solved'] as const) {
      const root = mkdtempSync(join(baseDir, '.coding-control-'));
      try {
        materializeTask(task, root, kind);
        const observation = await runContainerVerifier(task, root, { image: verifierImage });
        verdicts[kind] = observation.timedOut ? null : observation.exitCode;
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    record(
      `control ${task.id}: broken fails, solved passes`,
      verdicts.solved === 0 && verdicts.broken !== 0 && verdicts.broken !== null,
      verdicts,
    );
  }
}

function planFor(task: ICodingTask, behavior: TScriptedBehavior): IScriptedTrialPlan | undefined {
  return planScriptedTrial(task, behavior, CONTAINER_PATHS.projectDir);
}

async function scriptedTrials(image: string): Promise<void> {
  const launch = createDockerLauncher(image);
  const verify = (task: ICodingTask, tree: string) =>
    runContainerVerifier(task, tree, { image: verifierImage });
  const cases: { task: ICodingTask; behavior: TScriptedBehavior }[] = [
    ...CODING_TASKS.flatMap((task) => [
      { task, behavior: 'solve' as const },
      { task, behavior: 'claim-only' as const },
    ]),
    { task: CODING_TASKS[0] as ICodingTask, behavior: 'read-only' },
    { task: CODING_TASKS[0] as ICodingTask, behavior: 'edit-protected' },
    { task: CODING_TASKS[4] as ICodingTask, behavior: 'edit-protected' },
    { task: CODING_TASKS[1] as ICodingTask, behavior: 'stray-file' },
  ];
  for (const { task, behavior } of cases) {
    const plan = planFor(task, behavior);
    if (plan === undefined) {
      record(`scripted ${task.id}/${behavior}`, false, { reason: 'no plan for this task' });
      continue;
    }
    const upstream = createScriptedUpstream(plan.steps);
    const trial = await runTrial({
      task,
      model: flags.model,
      endpoint: flags.endpoint,
      upstream,
      launch,
      verify,
      baseDir,
      deadlineMs: 120_000,
      trialName: `robota-eval-trial-${task.id}-${behavior}-${process.pid}`,
    });
    const expected = [...plan.expectedFailures].sort();
    const got = [...trial.score.failures].sort();
    const relayClean =
      trial.relayLog.every((entry) => entry.outcome === 'forwarded') &&
      trial.upstreamAttempts === plan.steps.length &&
      upstream.calls() === plan.steps.length;
    record(
      `scripted ${task.id}/${behavior}: expected ${expected.length === 0 ? 'pass' : expected.join(',')}`,
      JSON.stringify(expected) === JSON.stringify(got) &&
        relayClean &&
        trial.cleanupError === undefined,
      {
        failures: got,
        requests: trial.relayLog.length,
        upstreamAttempts: trial.upstreamAttempts,
        scriptedSteps: plan.steps.length,
        toolCalls: trial.report.toolCalls,
        elapsedMs: trial.elapsedMs,
        diagnostics: trial.diagnostics,
        ...(trial.cleanupError === undefined ? {} : { cleanupError: trial.cleanupError }),
      },
    );
  }

  // A worker whose requests the relay refuses must never reach the reply source.
  const task = CODING_TASKS[0] as ICodingTask;
  const refusing = createScriptedUpstream([{ text: 'unreachable' }]);
  const refused = await runTrial({
    task,
    model: flags.model,
    endpoint: flags.endpoint,
    upstream: refusing,
    launch,
    verify,
    baseDir,
    deadlineMs: 120_000,
    policy: { allowedTools: BASELINE_SETTINGS.allowedTools.filter((name) => name !== 'Grep') },
    trialName: `robota-eval-trial-refusal-${process.pid}`,
  });
  record(
    'scripted relay refusal: a tool outside the allow-list never reaches the reply source',
    refused.upstreamAttempts === 0 &&
      refusing.calls() === 0 &&
      refused.relayLog.length >= 1 &&
      refused.relayLog.every((entry) => entry.outcome === 'refused' && entry.code === 'tool') &&
      !refused.score.passed,
    { relayLog: refused.relayLog, failures: refused.score.failures },
  );
}

async function main(): Promise<void> {
  if (spawnSync('docker', ['version', '--format', '{{.Server.Version}}']).status !== 0) {
    throw new Error('A local Docker daemon is required');
  }
  mkdirSync(baseDir, { recursive: true });
  const texts = forbiddenTexts(CODING_TASKS);
  const work = mkdtempSync(join(baseDir, '.coding-offline-'));
  const tag = flags.image ?? `robota-eval-coding-worker:offline-${process.pid}`;
  let built = false;
  let commit = 'unknown';
  try {
    await controls();

    if (flags.image === undefined) {
      const dirty = spawnSync(
        'git',
        ['-C', source, 'status', '--porcelain', '--untracked-files=no'],
        {
          encoding: 'utf8',
        },
      );
      if (dirty.stdout.trim() !== '') {
        throw new Error(
          'The source checkout has uncommitted changes; commit them so the tested source is the pinned source',
        );
      }
      const context = await assembleImageContext({
        source,
        revision: flags.revision,
        directory: join(work, 'context'),
        nodeImage,
      });
      commit = context.commit;
      const contextSearch = searchTree(context.tree, texts);
      record(
        'image build context holds no solution, verifier or credential file',
        contextSearch.hits.length === 0,
        {
          commit,
          scanned: contextSearch.scanned,
          hits: contextSearch.hits,
        },
      );
      if (contextSearch.hits.length > 0)
        throw new Error('Refusing to build an image from a dirty context');
      buildImage(context, tag);
      built = true;
    }

    const needles = join(work, 'needles');
    mkdirSync(needles);
    const imageSearch = searchImage(tag, needles, texts);
    const hits: ISearchHit[] = imageSearch.hits;
    record(
      'image search finds no solution, verifier or credential file',
      hits.length === 0 && imageSearch.scanned > 1000,
      {
        scanned: imageSearch.scanned,
        hits,
      },
    );

    const canaries = runIsolationCanaries({
      image: tag,
      baseDir,
      task: CODING_TASKS[0] as ICodingTask,
    });
    record('isolation canaries', canaries.failures.length === 0, { checks: canaries.checks });

    await scriptedTrials(tag);

    const leftover = docker(['ps', '-aq', '--filter', 'label=robota.eval']);
    record('no worker or verifier container left behind', leftover === '', { leftover });
  } finally {
    if (built && !flags['keep-image']) removeImage(tag);
    rmSync(work, { recursive: true, force: true });
  }

  const failed = steps.filter((step) => !step.ok);
  const summary = {
    commit,
    image: flags.image ?? tag,
    node: process.version,
    durationMs: Date.now() - started,
    forcedFields: forcedRequestFields(),
    steps,
    passed: steps.length - failed.length,
    failed: failed.length,
  };
  if (flags.out !== undefined) writeFileSync(flags.out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `\n${summary.passed} of ${steps.length} checks passed in ${Math.round(summary.durationMs / 1000)} s (commit ${commit})`,
  );
  if (failed.length > 0) process.exitCode = 1;
}

await main();
