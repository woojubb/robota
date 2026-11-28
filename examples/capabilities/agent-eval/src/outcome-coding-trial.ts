import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import {
  encodeHostLine,
  parseWorkerLine,
  type IWorkerInit,
  type IWorkerResult,
  type TJsonObject,
} from './outcome-coding-protocol.js';
import {
  createCodingRelay,
  type IRelayLogEntry,
  type IRelayPolicy,
  type TUpstream,
} from './outcome-coding-relay.js';
import { scoreTrial, type ITrialReport, type ITrialScore } from './outcome-coding-score.js';
import {
  BASELINE_SETTINGS,
  codingSystemPrompt,
  forcedRequestFields,
} from './outcome-coding-settings.js';
import {
  materializeTask,
  writeObservationOnce,
  type ICodingObservation,
} from './outcome-coding-verify.js';
import type { ICodingTask } from './outcome-coding-tasks.js';

/** Where the worker sees the task tree, its throwaway git repository and its disposable state. */
export interface IWorkerPaths {
  readonly projectDir: string;
  readonly gitRoot: string;
  readonly homeDir: string;
  readonly stateDir: string;
}

/** Paths inside the worker container: only the tree is a host mount. */
export const CONTAINER_PATHS: IWorkerPaths = Object.freeze({
  projectDir: '/work/project',
  gitRoot: '/work',
  homeDir: '/tmp/home',
  stateDir: '/tmp/state',
});

export interface IWorkerLimits {
  readonly memory: string;
  readonly cpus: string;
  readonly pids: number;
}

export const DEFAULT_WORKER_LIMITS: IWorkerLimits = { memory: '1g', cpus: '2', pids: 128 };

export interface IWorkerContainerInput {
  readonly name: string;
  readonly image: string;
  /** Absolute host directory holding the task tree. */
  readonly root: string;
  readonly limits?: IWorkerLimits;
  /** Replaces the image's default command (used by the isolation canaries). */
  readonly command?: readonly string[];
}

/**
 * Arguments after `docker` for the worker container: no network, read-only root filesystem,
 * no capabilities, non-root, bounded resources, and memory-backed scratch space. The task tree is
 * the only host path mounted. No environment variable is passed: the container gets no credential
 * and takes its home and state locations from the init message. Pure data.
 */
export function buildWorkerContainerArgs(input: IWorkerContainerInput): string[] {
  const limits = input.limits ?? DEFAULT_WORKER_LIMITS;
  return [
    'run',
    '--rm',
    '-i',
    '--name',
    input.name,
    '--label',
    'robota.eval=coding-worker',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    '1000:1000',
    '--pids-limit',
    String(limits.pids),
    '--memory',
    limits.memory,
    '--memory-swap',
    limits.memory,
    '--cpus',
    limits.cpus,
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,noexec,size=134217728',
    '--tmpfs',
    `${CONTAINER_PATHS.gitRoot}:rw,nosuid,nodev,noexec,size=33554432,uid=1000,gid=1000,mode=0755`,
    '-v',
    `${resolve(input.root)}:${CONTAINER_PATHS.projectDir}:rw`,
    input.image,
    ...(input.command ?? []),
  ];
}

/** The tree the worker starts from: writable by the container user, protected files untouched. */
export function materializeWorkerTree(task: ICodingTask, root: string): void {
  materializeTask(task, root, 'broken');
  const directories = new Set<string>([root]);
  for (const path of Object.keys(task.files)) {
    let directory = join(root, path, '..');
    while (directory.length >= root.length && !directories.has(directory)) {
      directories.add(directory);
      directory = join(directory, '..');
    }
  }
  for (const directory of directories) chmodSync(directory, 0o777);
  // The container user may be a different user than the host's: allowed files must be writable.
  for (const path of task.allowed) {
    if (path in task.files) chmodSync(join(root, path), 0o666);
  }
}

export interface IWorkerProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** Resolves when the process has exited. */
  readonly exited: Promise<number | null>;
  /** Stops the worker and anything it started. */
  kill(): void;
}

export interface IWorkerLaunch {
  readonly worker: IWorkerProcess;
  readonly paths: IWorkerPaths;
}

export interface ILaunchInput {
  readonly name: string;
  /** Directory that holds this trial; the tree is `tree` inside it. */
  readonly trialDir: string;
  readonly tree: string;
}

/** Starts the worker in the locked-down container; the host never runs a model's work itself. */
export function createDockerLauncher(image: string, limits?: IWorkerLimits) {
  return (input: ILaunchInput): IWorkerLaunch => {
    const child = spawn(
      'docker',
      buildWorkerContainerArgs({
        name: input.name,
        image,
        root: input.tree,
        ...(limits === undefined ? {} : { limits }),
      }),
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const exited = new Promise<number | null>((done) => {
      child.on('close', (code) => done(code));
      child.on('error', () => done(null));
    });
    return {
      paths: CONTAINER_PATHS,
      worker: {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        exited,
        kill: () => {
          spawnSync('docker', ['rm', '-f', input.name], { stdio: 'ignore', timeout: 15_000 });
          child.kill('SIGKILL');
        },
      },
    };
  };
}

export interface ITrialSpec {
  readonly task: ICodingTask;
  readonly model: string;
  readonly endpoint: string;
  /** Provider routing fields, merged into every forwarded request. */
  readonly routeOptions?: TJsonObject;
  readonly upstream: TUpstream;
  readonly launch: (input: ILaunchInput) => IWorkerLaunch;
  readonly verify: (task: ICodingTask, tree: string) => Promise<ICodingObservation>;
  /** Host directory (mountable by the container daemon) that holds the trial's directory. */
  readonly baseDir: string;
  /** The trial's deadline: no request is forwarded after it, and the worker is stopped shortly after. */
  readonly deadlineMs?: number;
  readonly policy?: Partial<Pick<IRelayPolicy, 'allowedTools' | 'maxBodyBytes' | 'model'>>;
  /** When set, the verifier's observation is written here exactly once, named after the trial. */
  readonly evidenceFile?: string;
  readonly trialName: string;
}

export interface ITrialRecord {
  readonly taskId: string;
  readonly report: ITrialReport;
  readonly score: ITrialScore;
  readonly observation: ICodingObservation;
  readonly result: IWorkerResult | undefined;
  readonly relayLog: readonly IRelayLogEntry[];
  readonly upstreamAttempts: number;
  readonly elapsedMs: number;
  /** Worker output that was not protocol messages, bounded. */
  readonly diagnostics: readonly string[];
  readonly cleanupError?: string;
}

const MAX_BODY_BYTES = 160_000;
const KILL_GRACE_MS = 15_000;
const MAX_DIAGNOSTICS = 8;
const MAX_DIAGNOSTIC_CHARS = 1_500;

function collectLines(stream: Readable, onLine: (line: string) => void): void {
  const lines = createInterface({ input: stream });
  lines.on('line', onLine);
  stream.on('error', () => undefined);
}

/**
 * Runs one trial: builds the task tree, starts the worker, relays its model requests through the
 * validating relay, then observes the finished tree with the independent verifier and scores it.
 * The agent's own claim is data only; the verdict comes from the observation.
 */
export async function runTrial(spec: ITrialSpec): Promise<ITrialRecord> {
  const deadlineMs = spec.deadlineMs ?? BASELINE_SETTINGS.abortAfterMs;
  const trialDir = mkdtempSync(join(spec.baseDir, '.coding-trial-'));
  chmodSync(trialDir, 0o755);
  const tree = join(trialDir, 'project');
  mkdirSync(tree, { mode: 0o777 });
  const diagnostics: string[] = [];
  const started = Date.now();
  let cleanupError: string | undefined;
  let record: ITrialRecord | undefined;
  try {
    materializeWorkerTree(spec.task, tree);
    const launched = spec.launch({ name: spec.trialName, trialDir, tree });
    const worker = launched.worker;
    const relay = createCodingRelay(
      {
        endpoint: spec.endpoint,
        model: spec.model,
        allowedTools: BASELINE_SETTINGS.allowedTools,
        forced: forcedRequestFields(spec.routeOptions),
        maxBodyBytes: MAX_BODY_BYTES,
        ...spec.policy,
        deadlineAt: started + deadlineMs,
        upstreamTimeoutMs: Math.min(60_000, deadlineMs),
      },
      spec.upstream,
    );
    const init: IWorkerInit = {
      kind: 'init',
      prompt: spec.task.prompt,
      model: spec.model,
      endpoint: spec.endpoint,
      ...launched.paths,
      systemPrompt: codingSystemPrompt(launched.paths.projectDir),
      allowedTools: BASELINE_SETTINGS.allowedTools,
      deniedTools: BASELINE_SETTINGS.deniedTools,
      maxTurns: BASELINE_SETTINGS.maxTurns,
      maxTokens: BASELINE_SETTINGS.maxTokens,
      temperature: BASELINE_SETTINGS.temperature,
      abortAfterMs: deadlineMs,
    };
    worker.stdin.on('error', () => undefined);
    const noteDiagnostic = (line: string): void => {
      if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(line.slice(-MAX_DIAGNOSTIC_CHARS));
    };
    const result = await new Promise<IWorkerResult | undefined>((done) => {
      let finished = false;
      const finish = (value: IWorkerResult | undefined): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        done(value);
      };
      const timer = setTimeout(() => {
        noteDiagnostic('hard deadline reached; worker stopped');
        worker.kill();
        finish(undefined);
      }, deadlineMs + KILL_GRACE_MS);
      let chain: Promise<void> = Promise.resolve();
      collectLines(worker.stdout, (line) => {
        const message = parseWorkerLine(line);
        if (message === undefined) {
          noteDiagnostic(line);
        } else if (message.kind === 'result') {
          finish(message);
        } else {
          // Requests are answered one at a time, in order.
          chain = chain
            .then(async () => {
              const answer = await relay.handle(message);
              if (!finished) worker.stdin.write(encodeHostLine(answer));
            })
            .catch((error: unknown) => noteDiagnostic(`relay failure: ${String(error)}`));
        }
      });
      collectLines(worker.stderr, noteDiagnostic);
      // Output already written may still be queued when the exit is reported.
      void worker.exited.then(() => setTimeout(() => finish(undefined), 100));
      worker.stdin.write(encodeHostLine(init));
    });
    // The result is in; whatever the worker still runs is stopped before the tree is observed.
    worker.kill();
    await Promise.race([
      worker.exited,
      new Promise((wait) => setTimeout(wait, KILL_GRACE_MS).unref()),
    ]);

    const observation = await spec.verify(spec.task, tree);
    if (spec.evidenceFile !== undefined) writeObservationOnce(spec.evidenceFile, observation);
    const report: ITrialReport = {
      completed: result?.completed === true,
      interrupted: result?.interrupted === true,
      toolCalls: result?.toolCalls ?? 0,
    };
    record = {
      taskId: spec.task.id,
      report,
      score: scoreTrial(report, observation),
      observation,
      result,
      relayLog: [...relay.log],
      upstreamAttempts: relay.upstreamAttempts(),
      elapsedMs: Date.now() - started,
      diagnostics,
    };
  } finally {
    try {
      rmSync(trialDir, { recursive: true, force: true });
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
    }
  }
  return cleanupError === undefined ? record : { ...record, cleanupError };
}
