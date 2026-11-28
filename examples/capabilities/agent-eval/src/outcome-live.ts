/**
 * The paid-run command. It builds the worker image from a clean export of the pinned revision,
 * runs the preflight, then the trials in the plan's order, and leaves everything the report needs
 * in an evidence folder outside the repository. A dry run does the same against a loopback gateway
 * with scripted replies and a fake credential: no network model, no real credential, no cost.
 *
 *   pnpm --filter robota-capability-agent-eval coding:live \
 *     --arms delegation,control --trial-cap <calls> --call-cap <calls> --ceiling-usd <dollars> \
 *     --evidence <folder outside the repository> \
 *     --credential-file <file> --credential-name <NAME> --decision-rule <comment url> \
 *     --model <id> --endpoint <chat completions url> --provider <route name> \
 *     [--route-options <json>] [--basis-prompt-usd-per-million <x> --basis-completion-usd-per-million <y>] \
 *     [--resume [--reconcile]] [--dry-run] [--source <checkout>] [--revision <rev>] \
 *     [--node-image <image>] [--verifier-image <image>] [--base <host directory the daemon can mount>]
 *
 * The exit code is 0 only when every planned trial finished with no stop, the cleanup checks all
 * hold and the leak scan found nothing.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  assembleImageContext,
  buildImage,
  forbiddenTexts,
  leakNeedles,
  removeImage,
  searchImage,
  searchTree,
} from './outcome-coding-image.js';
import { planScriptedTrial } from './outcome-coding-scripts.js';
import { ALL_CODING_TASKS } from './outcome-coding-tasks-repository.js';
import type { ICodingTask } from './outcome-coding-tasks.js';
import { createDockerLauncher } from './outcome-coding-trial.js';
import { runContainerVerifier } from './outcome-coding-verify.js';
import { planDelegationTrial } from './outcome-delegation-scripts.js';
import {
  DriverConfigError,
  runDriver,
  type IDockerOps,
  type IDockerSnapshot,
  type IDriverDeps,
  type IRuntime,
} from './outcome-live-driver.js';
import { startFakeGateway } from './outcome-live-gateway-fake.js';
import { parseDriverFlags, type IBuildFlags } from './outcome-live-flags.js';
import { PathGuardError } from './outcome-live-paths.js';

const here = dirname(fileURLToPath(import.meta.url));
const exampleDir = resolve(here, '..');

function docker(args: string[]): string[] {
  const result = spawnSync('docker', args, { encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .sort();
}

const dockerOps: IDockerOps = {
  available: () => spawnSync('docker', ['version', '--format', '{{.Server.Version}}']).status === 0,
  snapshot: (): IDockerSnapshot => ({
    containers: docker(['ps', '-aq', '--filter', 'label=robota.eval']),
    images: docker(['images', '-aq', '--no-trunc']),
    networks: docker(['network', 'ls', '-q']),
    volumes: docker(['volume', 'ls', '-q']),
  }),
};

/** Builds the worker image from the pinned revision and refuses one that holds a solution or a verifier. */
function imageRuntime(build: IBuildFlags): IDriverDeps['prepareRuntime'] {
  return async ({ workDir }): Promise<IRuntime> => {
    const dirty = spawnSync(
      'git',
      ['-C', build.source, 'status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf8' },
    );
    if (dirty.stdout.trim() !== '') {
      throw new Error(
        'The source checkout has uncommitted changes; commit them so the tested source is the pinned source',
      );
    }
    const texts = forbiddenTexts(ALL_CODING_TASKS);
    const context = await assembleImageContext({
      source: build.source,
      revision: build.revision,
      directory: join(workDir, 'context'),
      nodeImage: build.nodeImage,
      excludeFilesContaining: leakNeedles(ALL_CODING_TASKS),
    });
    const contextSearch = searchTree(context.tree, texts);
    if (contextSearch.hits.length > 0) {
      throw new Error('The image build context holds a solution, a verifier or a credential file');
    }
    const tag = `robota-eval-coding-worker:live-${process.pid}`;
    buildImage(context, tag);
    try {
      const needles = join(workDir, 'needles');
      mkdirSync(needles);
      const imageSearch = searchImage(tag, needles, texts);
      if (imageSearch.hits.length > 0 || imageSearch.scanned <= 1000) {
        throw new Error('The built image holds a solution, a verifier or a credential file');
      }
    } catch (error) {
      removeImage(tag);
      throw error;
    }
    return {
      commit: context.commit,
      launch: createDockerLauncher(tag),
      verify: (task: ICodingTask, tree: string) =>
        runContainerVerifier(task, tree, { image: build.verifierImage }),
      dispose: () => removeImage(tag),
    };
  };
}

async function main(): Promise<void> {
  const { config, build } = parseDriverFlags(process.argv.slice(2), resolve(here, '../../../..'));
  const log = (line: string): void => console.log(line);
  const gateway = config.dryRun
    ? await startFakeGateway({ model: config.model, provider: config.provider })
    : undefined;
  try {
    const result = await runDriver(config, {
      exampleDir,
      allowTemporaryPaths: config.dryRun,
      docker: dockerOps,
      prepareRuntime: imageRuntime(build),
      log,
      ...(gateway === undefined
        ? {}
        : {
            dryRun: {
              gateway,
              replyFor: (task, arm, projectDir) => {
                const plan =
                  arm === 'delegation'
                    ? planDelegationTrial(task, 'pass', projectDir)
                    : planScriptedTrial(task, 'solve', projectDir);
                if (plan === undefined) throw new Error(`No scripted reply for ${task.id}`);
                return plan.steps;
              },
            },
          }),
    });
    const { summary } = result;
    console.log(
      `\noutcome: ${summary.outcome}; slots closed ${summary.slotsClosed} of ${summary.slotsTotal}` +
        `; halt: ${summary.halt?.kind ?? 'none'}; leak scan count: ${summary.leakScan?.leaks ?? 'not run'}` +
        `; cleanup: ${summary.cleanup.every((entry) => entry.ok) ? 'clean' : 'NOT CLEAN'}`,
    );
    console.log(`summary: ${result.summaryPath}`);
    if (result.exitCode !== 0) process.exitCode = 1;
  } finally {
    await gateway?.close();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof DriverConfigError || error instanceof PathGuardError) {
    console.error(`refused: ${error.message}`);
  } else {
    console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 2;
}
