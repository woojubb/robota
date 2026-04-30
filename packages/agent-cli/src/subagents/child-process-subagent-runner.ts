import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BackgroundTaskError,
  getBuiltInAgent,
  type IAgentDefinition,
  type IInProcessSubagentRunnerDeps,
  type ISerializableProviderProfile,
  type ISubagentJobHandle,
  type ISubagentJobResult,
  type ISubagentJobStart,
  type ISubagentRunner,
  type TSubagentRunnerFactory,
} from '@robota-sdk/agent-sdk';
import type { IProviderConfig } from '../utils/provider-factory.js';
import {
  isSubagentWorkerChildMessage,
  type ISubagentWorkerStartPayload,
  type TSubagentWorkerWireValue,
} from './child-process-subagent-ipc.js';
import {
  cancelChildProcess,
  handleWorkerMessage,
  sendWorkerMessage,
  type IChildProcessRuntime,
} from './child-process-subagent-transport.js';

const DEFAULT_KILL_GRACE_MS = 2_000;

export interface IChildProcessSubagentRunnerOptions {
  providerConfig?: IProviderConfig;
  workerPath?: string;
  execArgv?: string[];
  killGraceMs?: number;
  env?: NodeJS.ProcessEnv;
}

interface ICancellationResult {
  promise: Promise<ISubagentJobResult>;
  reject(reason?: string): void;
}

export function createChildProcessSubagentRunnerFactory(
  options: IChildProcessSubagentRunnerOptions = {},
): TSubagentRunnerFactory {
  return (deps) => new ChildProcessSubagentRunner(deps, options);
}

export class ChildProcessSubagentRunner implements ISubagentRunner {
  private readonly workerPath: string;
  private readonly execArgv?: string[];
  private readonly killGraceMs: number;
  private readonly providerConfig?: IProviderConfig;
  private readonly env?: NodeJS.ProcessEnv;

  constructor(
    private readonly deps: IInProcessSubagentRunnerDeps,
    options: IChildProcessSubagentRunnerOptions = {},
  ) {
    this.workerPath = options.workerPath ?? resolveDefaultWorkerPath();
    this.execArgv = options.execArgv;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.providerConfig = options.providerConfig;
    this.env = options.env;
  }

  start(job: ISubagentJobStart): ISubagentJobHandle {
    const child = fork(this.workerPath, [], {
      cwd: job.request.cwd,
      env: { ...process.env, ...(this.env ?? {}) },
      execArgv: this.execArgv ?? resolveDefaultExecArgv(this.workerPath),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const runtime: IChildProcessRuntime = {
      job,
      child,
      killGraceMs: this.killGraceMs,
    };
    const payload = this.createStartPayload(job);
    const workerResult = this.createResult(runtime, payload);
    const cancellation = createCancellationResult(job.jobId);
    void workerResult.catch(() => undefined);
    const result = Promise.race([workerResult, cancellation.promise]);

    return {
      jobId: job.jobId,
      ...(child.pid !== undefined && { pid: child.pid }),
      result,
      cancel: async (reason?: string) => {
        cancellation.reject(reason);
        await cancelChildProcess(runtime, reason);
      },
      send: async (prompt: string) => {
        await sendWorkerMessage(child, { type: 'send', prompt });
      },
    };
  }

  private createStartPayload(job: ISubagentJobStart): ISubagentWorkerStartPayload {
    const definition = resolveAgentDefinition(job.request.type, this.deps.customAgentRegistry);
    return {
      jobId: job.jobId,
      request: job.request,
      agentDefinition: applyRequestOverrides(definition, job),
      parentConfig: this.deps.config,
      parentContext: this.deps.context,
      providerProfile: createProviderProfile(this.providerConfig, this.deps, job),
      permissionMode: this.deps.permissionMode,
    };
  }

  private createResult(
    runtime: IChildProcessRuntime,
    payload: ISubagentWorkerStartPayload,
  ): Promise<ISubagentJobResult> {
    let settled = false;
    let started = false;

    return new Promise<ISubagentJobResult>((resolve, reject) => {
      const timeoutTimer = runtime.job.request.timeoutMs
        ? setTimeout(() => {
            void cancelChildProcess(runtime, 'Subagent worker timed out');
            rejectOnce(new BackgroundTaskError('timeout', 'Subagent worker timed out'));
          }, runtime.job.request.timeoutMs)
        : undefined;

      const clearTimers = (): void => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (runtime.killTimer) clearTimeout(runtime.killTimer);
      };

      const resolveOnce = (output: string): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        cleanup();
        resolve({ jobId: runtime.job.jobId, output });
      };

      const rejectOnce = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimers();
        cleanup();
        reject(error);
      };

      const startWorker = (): void => {
        if (started) return;
        started = true;
        void sendWorkerMessage(runtime.child, { type: 'start', payload }).catch((error) => {
          rejectOnce(error instanceof Error ? error : new Error(String(error)));
        });
      };

      const onMessage = (message: TSubagentWorkerWireValue): void => {
        if (!isSubagentWorkerChildMessage(message)) {
          rejectOnce(
            new BackgroundTaskError('runner', 'Received malformed subagent worker message'),
          );
          return;
        }
        handleWorkerMessage(message, startWorker, resolveOnce, rejectOnce, runtime.job.emit);
      };

      const onError = (error: Error): void => {
        rejectOnce(new BackgroundTaskError('crash', error.message));
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return;
        const detail =
          signal !== null ? `signal ${signal}` : `exit code ${code === null ? 'unknown' : code}`;
        rejectOnce(
          new BackgroundTaskError('crash', `Subagent worker exited before result: ${detail}`),
        );
      };

      const cleanup = (): void => {
        runtime.child.off('message', onMessage);
        runtime.child.off('error', onError);
        runtime.child.off('exit', onExit);
      };

      runtime.child.on('message', onMessage);
      runtime.child.on('error', onError);
      runtime.child.on('exit', onExit);
      runtime.child.once('spawn', () => {
        setImmediate(startWorker);
      });
    });
  }
}

function createCancellationResult(jobId: string): ICancellationResult {
  let settled = false;
  let rejectFn: (error: Error) => void = () => {};
  const promise = new Promise<ISubagentJobResult>((_resolve, reject) => {
    rejectFn = reject;
  });
  return {
    promise,
    reject(reason?: string): void {
      if (settled) return;
      settled = true;
      rejectFn(new BackgroundTaskError('runner', reason ?? `Subagent job cancelled: ${jobId}`));
    },
  };
}

function resolveAgentDefinition(
  agentType: string,
  customRegistry?: (name: string) => IAgentDefinition | undefined,
): IAgentDefinition {
  const definition = customRegistry?.(agentType) ?? getBuiltInAgent(agentType);
  if (!definition) {
    throw new BackgroundTaskError('validation', `Unknown agent type: ${agentType}`);
  }
  return definition;
}

function applyRequestOverrides(
  definition: IAgentDefinition,
  job: ISubagentJobStart,
): IAgentDefinition {
  return {
    ...definition,
    ...(job.request.model ? { model: job.request.model } : {}),
    ...(job.request.allowedTools ? { tools: job.request.allowedTools } : {}),
    ...(job.request.disallowedTools ? { disallowedTools: job.request.disallowedTools } : {}),
  };
}

function createProviderProfile(
  providerConfig: IProviderConfig | undefined,
  deps: IInProcessSubagentRunnerDeps,
  job: ISubagentJobStart,
): ISerializableProviderProfile {
  const provider = providerConfig ?? deps.config.provider;
  return {
    profileName: deps.config.currentProvider,
    type: provider.name,
    model: job.request.model ?? provider.model,
    apiKey: provider.apiKey,
    baseURL: provider.baseURL,
    timeout: provider.timeout,
  };
}

function resolveDefaultWorkerPath(): string {
  const entryPoint = process.argv[1] ?? '';
  const entryDir = entryPoint ? dirname(entryPoint) : process.cwd();
  const extension = entryPoint.endsWith('.ts') || entryPoint.endsWith('.tsx') ? '.ts' : '.js';
  const candidates = [
    join(entryDir, 'subagents', `child-process-subagent-worker${extension}`),
    join(entryDir, `child-process-subagent-worker${extension}`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

function resolveDefaultExecArgv(workerPath: string): string[] {
  if (!workerPath.endsWith('.ts')) {
    return process.execArgv;
  }
  if (process.execArgv.some((arg) => arg.includes('tsx'))) {
    return process.execArgv;
  }
  return [...process.execArgv, '--import', 'tsx'];
}
