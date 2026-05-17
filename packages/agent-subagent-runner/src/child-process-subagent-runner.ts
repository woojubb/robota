import { fork } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
} from '@robota-sdk/agent-executor';
import { getBuiltInAgent } from '@robota-sdk/agent-framework';

import {
  createCancellationResult,
  createChildProcessSubagentResult,
} from './child-process-subagent-runner-result.js';
import {
  cancelChildProcess,
  sendWorkerMessage,
  type IChildProcessRuntime,
} from './child-process-subagent-transport.js';
import { getDefaultSubagentWorkerPath } from './worker-path-resolver.js';

import type { ISubagentWorkerStartPayload } from './child-process-subagent-ipc.js';
import type { IProviderConfig } from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  IInProcessSubagentRunnerDeps,
  TSubagentRunnerFactory,
} from '@robota-sdk/agent-framework';

const DEFAULT_KILL_GRACE_MS = 2_000;

export interface IChildProcessSubagentRunnerOptions {
  workerPath?: string;
  providerConfig?: IProviderConfig;
  execArgv?: string[];
  killGraceMs?: number;
  env?: NodeJS.ProcessEnv;
  worktreeIsolation?: boolean;
  worktreeAdapter?: ISubagentWorktreeAdapter;
  logsDir?: string;
}

export function createChildProcessSubagentRunnerFactory(
  options: IChildProcessSubagentRunnerOptions,
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
    options: IChildProcessSubagentRunnerOptions,
  ) {
    this.workerPath = options.workerPath ?? getDefaultSubagentWorkerPath();
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
      execArgv: this.execArgv ?? resolveExecArgv(this.workerPath),
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

function resolveExecArgv(workerPath: string): string[] {
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
