import { fork } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IProviderConfig } from '@robota-sdk/agent-core';
import {
  BackgroundTaskError,
  createBackgroundTaskLogPage,
  createGitWorktreeIsolationAdapter,
  createWorktreeSubagentRunner,
  type IBackgroundTaskLogCursor,
  type IBackgroundTaskLogPage,
  type ISerializableProviderProfile,
  type ISubagentJobHandle,
  type ISubagentJobStart,
  type ISubagentRunner,
  type ISubagentWorktreeAdapter,
} from '@robota-sdk/agent-runtime';
import type { TSubagentRunnerFactory } from './in-process-subagent-runner.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import { getBuiltInAgent } from '../agents/built-in-agents.js';
import type { IInProcessSubagentRunnerDeps } from './in-process-subagent-runner.js';
import type { ISubagentWorkerStartPayload } from './child-process-subagent-ipc.js';
import {
  createCancellationResult,
  createChildProcessSubagentResult,
} from './child-process-subagent-runner-result.js';
import {
  cancelChildProcess,
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
  worktreeIsolation?: boolean;
  worktreeAdapter?: ISubagentWorktreeAdapter;
  logsDir?: string;
}

export function createChildProcessSubagentRunnerFactory(
  options: IChildProcessSubagentRunnerOptions = {},
): TSubagentRunnerFactory {
  return (deps) => {
    const runner = new ChildProcessSubagentRunner(deps, options);
    if (options.worktreeIsolation === false) return runner;
    return createWorktreeSubagentRunner({
      runner,
      worktreeAdapter: options.worktreeAdapter ?? createGitWorktreeIsolationAdapter(),
      hooks: deps.config.hooks,
      hookTypeExecutors: deps.hookTypeExecutors,
    });
  };
}

export class ChildProcessSubagentRunner implements ISubagentRunner {
  private readonly workerPath: string;
  private readonly execArgv?: string[];
  private readonly killGraceMs: number;
  private readonly providerConfig?: IProviderConfig;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly logsDir?: string;

  constructor(
    private readonly deps: IInProcessSubagentRunnerDeps,
    options: IChildProcessSubagentRunnerOptions = {},
  ) {
    this.workerPath = options.workerPath ?? resolveDefaultWorkerPath();
    this.execArgv = options.execArgv;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.providerConfig = options.providerConfig;
    this.env = options.env;
    this.logsDir = options.logsDir;
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
    const workerResult = createChildProcessSubagentResult({
      runtime,
      payload,
      resolveTranscriptPath: (request) => this.resolveTranscriptPath(request),
    });
    const cancellation = createCancellationResult(job.jobId);
    void workerResult.catch(() => undefined);
    const result = Promise.race([workerResult, cancellation.promise]);
    const transcriptPath = this.resolveTranscriptPath(job);

    return {
      jobId: job.jobId,
      ...(child.pid !== undefined && { pid: child.pid }),
      ...(transcriptPath !== undefined && { transcriptPath, logPath: transcriptPath }),
      result,
      cancel: async (reason?: string) => {
        cancellation.reject(reason);
        await cancelChildProcess(runtime, reason);
      },
      send: async (prompt: string) => {
        await sendWorkerMessage(child, { type: 'send', prompt });
      },
      ...(transcriptPath !== undefined && {
        readLog: async (cursor?: IBackgroundTaskLogCursor) =>
          readTranscriptLog(job.jobId, transcriptPath, cursor),
      }),
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
      ...(this.logsDir ? { logsDir: this.logsDir } : {}),
    };
  }

  private resolveTranscriptPath(job: ISubagentJobStart): string | undefined {
    if (!this.logsDir) return undefined;
    return join(this.logsDir, job.request.parentSessionId, 'subagents', `${job.jobId}.jsonl`);
  }
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
    options: provider.options,
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

function readTranscriptLog(
  jobId: string,
  transcriptPath: string,
  cursor?: IBackgroundTaskLogCursor,
): IBackgroundTaskLogPage {
  if (!existsSync(transcriptPath)) {
    return {
      taskId: jobId,
      cursor,
      lines: [],
    };
  }
  const lines = readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean);
  return createBackgroundTaskLogPage(jobId, lines, cursor);
}
