import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BackgroundTaskError,
  createBackgroundTaskLogPage,
  createWorktreeSubagentRunner,
  subagentExecutionRoot,
  type ISubagentJobHandle,
  type ISubagentJobStart,
  type ISubagentRunner,
  type ISubagentWorktreeAdapter,
} from '@robota-sdk/agent-executor';
import { DEFAULT_KILL_GRACE_MS } from '@robota-sdk/agent-process';

import { projectSandbox, projectSessionTiers } from './child-process-subagent-projection.js';
import {
  createCancellationResult,
  createChildProcessSubagentResult,
} from './child-process-subagent-runner-result.js';
import {
  cancelChildProcess,
  captureChildStderr,
  sendWorkerMessage,
  type IChildProcessRuntime,
} from './child-process-subagent-transport.js';
import { projectParentConfig } from './parent-config-projection.js';
import { projectParentContext } from './parent-context-projection.js';
import { encodeAgentDefinition, encodeParentContext } from './subagent-worker-start-dto.js';
import { SUBAGENT_WORKER_MODE_FLAG, type ISubagentWorkerEntry } from './worker-entry.js';

import type { ISubagentWorkerStartPayload } from './child-process-subagent-ipc.js';
import type { IProviderDefinitionConfig } from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  IInProcessSubagentRunnerDeps,
  TSubagentRunnerFactory,
} from '@robota-sdk/agent-framework';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  ISerializableProviderProfile,
} from '@robota-sdk/agent-interface-execution';

/** POSIX children are forked detached so a process-group kill reaps grandchildren (CORE-023). */
const SPAWN_DETACHED = process.platform !== 'win32';

export interface IChildProcessSubagentRunnerOptions {
  /**
   * DIST-006: how to start a copy of the running artifact in subagent-worker mode, stated by the
   * composition root. It replaced `workerPath`, which asked this package to locate a file whose
   * location is a property of the packaging step — a question no library can answer, and one that
   * was answered wrongly twice.
   */
  workerEntry: ISubagentWorkerEntry;
  providerConfig?: IProviderDefinitionConfig;
  killGraceMs?: number;
  /**
   * How long a spawned worker may take to signal `ready` before the runner gives up. Injectable so
   * the branch is reachable in a test; without that it is a fix that ships untested.
   */
  handshakeBudgetMs?: number;
  env?: NodeJS.ProcessEnv;
  worktreeIsolation?: boolean;
  worktreeAdapter: ISubagentWorktreeAdapter;
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
      worktreeAdapter: options.worktreeAdapter,
      hooks: deps.config.hooks,
      hookTypeExecutors: deps.hookTypeExecutors,
    });
  };
}

export class ChildProcessSubagentRunner implements ISubagentRunner {
  private readonly workerEntry: ISubagentWorkerEntry;
  private readonly killGraceMs: number;
  private readonly handshakeBudgetMs?: number;
  private readonly providerConfig?: IProviderDefinitionConfig;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly logsDir?: string;

  constructor(
    private readonly deps: IInProcessSubagentRunnerDeps,
    options: IChildProcessSubagentRunnerOptions,
  ) {
    this.workerEntry = options.workerEntry;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.handshakeBudgetMs = options.handshakeBudgetMs;
    this.providerConfig = options.providerConfig;
    this.env = options.env;
    this.logsDir = options.logsDir;
  }

  start(job: ISubagentJobStart): ISubagentJobHandle {
    // DIST-006: `spawn` rather than `fork` — `fork` is `spawn(process.execPath, [module, …])` with
    // an ipc stdio, and the module is exactly the thing that cannot be named for every artifact.
    // Stating execPath and args outright is the same mechanism without the assumption.
    const entry = this.workerEntry;
    const child = spawn(
      entry.execPath,
      [...(entry.execArgv ?? []), ...entry.args, SUBAGENT_WORKER_MODE_FLAG],
      {
        // ARCH-010/ARCH-031: the forked process's OS working directory answers the same question as
        // the session's execution root, so it reads the same rule. Reading `request.cwd` directly was
        // only ever correct while the worktree runner rewrote that field — this is the second carrier
        // that removal would have left disagreeing with the first.
        cwd: subagentExecutionRoot(job),
        env: { ...process.env, ...(this.env ?? {}) },
        // DIST-006: stderr was `'ignore'`, so a child that died before its first IPC message
        // reported only `exit code 1`. That is why this defect's second occurrence had to be
        // diagnosed by hand — the cause was written to a stream nothing was reading.
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        detached: SPAWN_DETACHED,
      },
    );
    captureChildStderr(child);
    const runtime: IChildProcessRuntime = {
      job,
      child,
      killGraceMs: this.killGraceMs,
    };
    const payload = this.createStartPayload(job);
    const workerResult = createChildProcessSubagentResult({
      runtime,
      payload,
      ...(this.handshakeBudgetMs !== undefined
        ? { handshakeBudgetMs: this.handshakeBudgetMs }
        : {}),
      resolveTranscriptPath: (request) => this.resolveTranscriptPath(request),
    });
    const cancellation = createCancellationResult(job.taskId);
    void workerResult.catch(() => undefined);
    const result = Promise.race([workerResult, cancellation.promise]);
    // CORE-023: cancel() now awaits the SIGTERM→grace→SIGKILL escalation, so it settles later
    // than the synchronous cancellation.reject(). Guard `result` so its rejection is never
    // "unhandled" during that window; real consumers still await it and receive the rejection.
    void result.catch(() => undefined);
    const transcriptPath = this.resolveTranscriptPath(job);

    return {
      taskId: job.taskId,
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
          readTranscriptLog(job.taskId, transcriptPath, cursor),
      }),
    };
  }

  /**
   * The payload the child is started with — ASYNC, because projecting the parent's sandbox means
   * asking it for a snapshot and `snapshot()` returns a promise.
   *
   * Review of ARCH-033/ARCH-034 found this method building neither `sessionTiers` nor
   * `sandboxProjection`: both were declared on the wire type and read by the worker, and nothing
   * ever set them, so every spawned child ran with `sessionTiers: undefined` and no sandbox. The
   * tests missed it because they called `composition.createTools()` directly — the worker's half —
   * and this is the only production site that constructs a payload. A field the worker reads and no
   * producer writes is a capability that cannot be turned on, which is the same defect ARCH-033 was
   * filed for, one layer up.
   */
  private createStartPayload(job: ISubagentJobStart): Promise<ISubagentWorkerStartPayload> {
    // NOT an `async` function, deliberately. `resolveAgentDefinition` throws for an unknown agent
    // type, and `start()` has always surfaced that SYNCHRONOUSLY — an `async` body would turn it
    // into a rejected result promise, which is a contract change no caller asked for and which the
    // ARCH-036 cases caught immediately. Everything that can be known now is computed now; only the
    // sandbox half waits.
    const definition = resolveAgentDefinition(
      job.request.agentType,
      this.deps.customAgentRegistry,
      this.deps.builtInAgents,
      this.deps.agentDefinitions,
    );
    const base: ISubagentWorkerStartPayload = {
      taskId: job.taskId,
      request: job.request,
      ...(job.worktree ? { worktree: job.worktree } : {}),
      agentDefinition: encodeAgentDefinition(applyRequestOverrides(definition, job)),
      parentConfig: projectParentConfig(this.deps.config),
      // Issue #2317 narrows to the two members the child reads; ARCH-044 (issue #2047) encodes them.
      parentContext: encodeParentContext(projectParentContext(this.deps.context)),
      providerProfile: createProviderProfile(this.providerConfig, this.deps, job),
      permissionMode: this.deps.permissionMode,
      ...projectSessionTiers(this.deps),
      ...(this.logsDir ? { logsDir: this.logsDir } : {}),
    };
    return projectSandbox(this.deps).then((sandbox) => ({ ...base, ...sandbox }));
  }

  private resolveTranscriptPath(job: ISubagentJobStart): string | undefined {
    if (!this.logsDir) return undefined;
    return join(this.logsDir, job.request.parentSessionId, 'subagents', `${job.taskId}.jsonl`);
  }
}

/**
 * ARCH-036: `builtInAgents` is threaded through because NEUT-003 made an injected set REPLACE the
 * module built-ins — an empty array removes them entirely — and the in-process sibling already
 * honours it (`agent-framework/src/subagents/in-process-subagent-runner.ts`). Reading only
 * `customAgentRegistry` here meant the composition root's choice reached one runner and not the
 * other, so selecting a runner for isolation silently also selected a capability.
 */
function resolveAgentDefinition(
  agentType: string,
  customRegistry?: (name: string) => IAgentDefinition | undefined,
  builtInAgents?: readonly IAgentDefinition[],
  agentDefinitions?: readonly IAgentDefinition[],
): IAgentDefinition {
  const definition =
    customRegistry?.(agentType) ??
    builtInAgents?.find((agent) => agent.name === agentType) ??
    agentDefinitions?.find((agent) => agent.name === agentType);
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
  providerConfig: IProviderDefinitionConfig | undefined,
  deps: IInProcessSubagentRunnerDeps,
  job: ISubagentJobStart,
): ISerializableProviderProfile {
  const provider = providerConfig ?? deps.config.provider;
  // SEC-009: carry the REFERENCE, not the secret. Config loading resolves a `$ENV:` value into the
  // credential itself, so copying `apiKey` here put plaintext into a structured-clone IPC message —
  // a second copy of the secret, in a second process, reachable by anything observing the channel.
  // The child already inherits this process's environment (`env:` at the spawn below), and
  // `resolveProfileApiKey` already reads `apiKeyEnv`, so the reference resolves on the far side with
  // no new plumbing. When no reference was recorded the config genuinely holds a literal and the
  // literal is all there is to send.
  // allow-fallback: a profile storing a plaintext credential has no reference to carry; the
  // org policy `requireApiKeyFromEnv` is the documented way to forbid that storage form.
  const credential = provider.apiKeyEnv
    ? { apiKeyEnv: provider.apiKeyEnv }
    : { apiKey: provider.apiKey };
  return {
    profileName: deps.config.currentProvider,
    type: provider.name,
    model: job.request.model ?? provider.model,
    ...credential,
    baseURL: provider.baseURL,
    timeout: provider.timeout,
    options: provider.options,
  };
}

function readTranscriptLog(
  taskId: string,
  transcriptPath: string,
  cursor?: IBackgroundTaskLogCursor,
): IBackgroundTaskLogPage {
  if (!existsSync(transcriptPath)) {
    return {
      taskId,
      cursor,
      lines: [],
    };
  }
  const lines = readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean);
  return createBackgroundTaskLogPage(taskId, lines, cursor);
}
