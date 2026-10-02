import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createBackgroundTaskLogPage,
  createWorktreeSubagentRunner,
  subagentExecutionRoot,
  type ISubagentJobHandle,
  type ISubagentJobStart,
  type ISubagentRunner,
  type ISubagentWorktreeAdapter,
} from '@robota-sdk/agent-executor';
import { DEFAULT_KILL_GRACE_MS } from '@robota-sdk/agent-process';

import {
  projectProviderConnection,
  projectStartPayload,
  type IProjectedConnection,
} from './child-process-subagent-projection.js';
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
import { SUBAGENT_WORKER_MODE_FLAG, type ISubagentWorkerEntry } from './worker-entry.js';

import type {
  ISubagentWorkerStartPayload,
  TSubagentWorkerPermissionResult,
} from './child-process-subagent-ipc.js';
import type { TParentSandboxSettings } from './worker-composition.js';
import type {
  IProviderDefinition,
  IProviderDefinitionConfig,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type {
  IInProcessSubagentRunnerDeps,
  TSubagentRunnerFactory,
} from '@robota-sdk/agent-framework';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
} from '@robota-sdk/agent-interface-execution';

/** POSIX children are forked detached so a process-group kill reaps grandchildren (CORE-023). */
const SPAWN_DETACHED = process.platform !== 'win32';

/** Issue #3288 §1: how a job's child asks the parent's own approver for a tool call. */
type TPermissionApprover = (
  toolName: string,
  toolArgs: TToolArgs,
  signal: AbortSignal,
) => Promise<TSubagentWorkerPermissionResult>;

export interface IChildProcessSubagentRunnerOptions {
  /**
   * DIST-006: how to start a copy of the running artifact in subagent-worker mode, stated by the
   * composition root. It replaced `workerPath`, which asked this package to locate a file whose
   * location is a property of the packaging step — a question no library can answer, and one that
   * was answered wrongly twice.
   */
  workerEntry: ISubagentWorkerEntry;
  providerConfig?: IProviderDefinitionConfig;
  /**
   * The parent's provider registry. Its defaults complete the connection the child is given, and
   * each definition names the environment its client reads. Required: a job whose provider has no
   * definition here is refused, because its connection cannot be checked.
   */
  providerDefinitions: readonly IProviderDefinition[];
  killGraceMs?: number;
  /**
   * How long a spawned worker may take to signal `ready` before the runner gives up. Injectable so
   * the branch is reachable in a test; without that it is a fix that ships untested.
   */
  handshakeBudgetMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Explicit host snapshot used to resolve this provider; defaults to the live process environment. */
  expectedEnvironment?: NodeJS.ProcessEnv;
  /** A host can supply a curated child environment without inheriting unrelated process secrets. */
  inheritEnvironment?: boolean;
  worktreeIsolation?: boolean;
  worktreeAdapter: ISubagentWorktreeAdapter;
  logsDir?: string;
  /**
   * The parent's sandbox settings as they stand now, read at EACH spawn: a setting the user changed
   * this session (`/sandbox`) lives on the parent's live client, not in the files a child would read.
   * The child's `createSandbox` receives the value. Absent ⇒ the child reads its root's settings.
   */
  parentSandboxSettings?: () => TParentSandboxSettings | undefined;
  /**
   * Be told the parent's sandbox settings after each change (`/sandbox`); returns the way to stop.
   * The runner forwards each change to every running child, so a child started before the change
   * follows it too.
   */
  watchParentSandboxSettings?: (listener: (settings: TParentSandboxSettings) => void) => () => void;
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
  private readonly providerDefinitions: readonly IProviderDefinition[];
  private readonly env?: NodeJS.ProcessEnv;
  private readonly expectedEnvironment?: NodeJS.ProcessEnv;
  private readonly inheritEnvironment: boolean;
  private readonly logsDir?: string;
  private readonly parentSandboxSettings?: () => TParentSandboxSettings | undefined;
  private readonly watchParentSandboxSettings?: IChildProcessSubagentRunnerOptions['watchParentSandboxSettings'];

  constructor(
    private readonly deps: IInProcessSubagentRunnerDeps,
    options: IChildProcessSubagentRunnerOptions,
  ) {
    this.workerEntry = options.workerEntry;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
    this.handshakeBudgetMs = options.handshakeBudgetMs;
    this.providerConfig = options.providerConfig;
    this.providerDefinitions = options.providerDefinitions;
    this.env = options.env;
    this.expectedEnvironment = options.expectedEnvironment;
    this.inheritEnvironment = options.inheritEnvironment !== false;
    if (!this.inheritEnvironment && this.expectedEnvironment === undefined) {
      throw new Error('An explicit expected environment is required when child inheritance is disabled.');
    }
    this.logsDir = options.logsDir;
    this.parentSandboxSettings = options.parentSandboxSettings;
    this.watchParentSandboxSettings = options.watchParentSandboxSettings;
  }

  start(job: ISubagentJobStart): ISubagentJobHandle {
    // DIST-006: `spawn` rather than `fork` — `fork` is `spawn(process.execPath, [module, …])` with
    // an ipc stdio, and the module is exactly the thing that cannot be named for every artifact.
    // Stating execPath and args outright is the same mechanism without the assumption.
    const entry = this.workerEntry;
    const env = this.inheritEnvironment ? { ...process.env, ...(this.env ?? {}) } : { ...(this.env ?? {}) };
    // Checked BEFORE spawning: a child whose environment would point the provider elsewhere never
    // starts, so the parent's credential is never handed to it.
    const connection = projectProviderConnection(
      job,
      this.deps,
      {
        ...(this.providerConfig !== undefined ? { providerConfig: this.providerConfig } : {}),
        providerDefinitions: this.providerDefinitions,
      },
      this.expectedEnvironment ?? process.env,
      env,
    );
    const child = spawn(
      entry.execPath,
      [...(entry.execArgv ?? []), ...entry.args, SUBAGENT_WORKER_MODE_FLAG],
      {
        // ARCH-010/ARCH-031: the forked process's OS working directory answers the same question as
        // the session's execution root, so it reads the same rule. Reading `request.cwd` directly was
        // only ever correct while the worktree runner rewrote that field — this is the second carrier
        // that removal would have left disagreeing with the first.
        cwd: subagentExecutionRoot(job),
        env,
        // DIST-006: stderr was `'ignore'`, so a child that died before its first IPC message
        // reported only `exit code 1`. That is why this defect's second occurrence had to be
        // diagnosed by hand — the cause was written to a stream nothing was reading.
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        detached: SPAWN_DETACHED,
      },
    );
    captureChildStderr(child);
    // Watch BEFORE the payload reads the settings: a change made while the child starts is then either
    // in the payload or sent after it, never lost between the two.
    this.forwardSandboxSettingChanges(child);
    const runtime: IChildProcessRuntime = {
      job,
      child,
      killGraceMs: this.killGraceMs,
    };
    const payload = this.createStartPayload(job, connection);
    // Issue #3288 §1: owned here (not inside the result controller) so `cancel()` below can abort it
    // the moment cancellation is REQUESTED — a still-parked permission ask must not outlive that
    // decision by however long the child takes to confirm it. The controller also aborts it on its
    // own settlement, covering a crash or a normal finish with one still in flight.
    const permissionAbort = new AbortController();
    const permissionApprover = this.permissionApprover(job);
    const workerResult = createChildProcessSubagentResult({
      runtime,
      payload,
      ...(this.handshakeBudgetMs !== undefined
        ? { handshakeBudgetMs: this.handshakeBudgetMs }
        : {}),
      resolveTranscriptPath: (request) => this.resolveTranscriptPath(request),
      permissionAbort,
      ...(permissionApprover !== undefined ? { permissionApprover } : {}),
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
        // Issue #3288 §1: dismiss a still-parked permission ask before anything else — the GUI must
        // not keep asking about a task the person just told to stop.
        permissionAbort.abort(reason);
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
   * The payload the child is started with. The builder lives in
   * `child-process-subagent-projection.ts` (CLI-1994 moved it there so the ARCH-044 key-set test
   * pins the code that produces it); review of ARCH-033/ARCH-034 is the reason it is a named
   * producer at all — both fields were declared on the wire type, read by the worker, and set by
   * nothing, because this was the only production site that constructs a payload and no test
   * reached it.
   */
  private createStartPayload(
    job: ISubagentJobStart,
    connection: IProjectedConnection,
  ): Promise<ISubagentWorkerStartPayload> {
    const parentSandboxSettings = this.parentSandboxSettings?.();
    return projectStartPayload(job, this.deps, {
      connection,
      providerDefinitions: this.providerDefinitions,
      ...(this.logsDir !== undefined ? { logsDir: this.logsDir } : {}),
      ...(parentSandboxSettings !== undefined ? { parentSandboxSettings } : {}),
    });
  }

  private forwardSandboxSettingChanges(child: ChildProcess): void {
    const unwatch = this.watchParentSandboxSettings?.((settings) => {
      if (!child.connected) return;
      void sendWorkerMessage(child, { type: 'sandbox_settings', settings }).catch(() => undefined);
    });
    if (unwatch === undefined) return;
    // A child that never started emits `error` and no `exit`; either ends the watch, and ending it twice
    // is harmless.
    child.once('exit', unwatch);
    child.once('error', unwatch);
  }

  private resolveTranscriptPath(job: ISubagentJobStart): string | undefined {
    if (!this.logsDir) return undefined;
    return join(this.logsDir, job.request.parentSessionId, 'subagents', `${job.taskId}.jsonl`);
  }

  /**
   * Issue #3288 §1: how this job's child gets a human's yes/no — the parent session's own approver
   * (`deps.permissionHandler`, the exact function the in-process runner already hands its own child
   * session), bound to a `requester` identity that names this task so a surface can say "Background
   * agent X wants to …" instead of an unattributed prompt. `undefined` when the parent session has no
   * approver at all (print mode / a truly headless run): the result controller then denies every
   * request from the child immediately, the same fail-closed default the enforcer applies with none.
   */
  private permissionApprover(job: ISubagentJobStart): TPermissionApprover | undefined {
    const handler = this.deps.permissionHandler;
    if (handler === undefined) return undefined;
    const requester = {
      kind: 'background-agent' as const,
      label: job.request.agentType,
      taskId: job.taskId,
    };
    return (toolName, toolArgs, signal) => handler(toolName, toolArgs, { requester, signal });
  }
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
