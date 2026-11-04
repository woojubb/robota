import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import {
  BackgroundTaskError,
  createWorktreeSubagentRunner,
  subagentExecutionRoot,
  type ISubagentJobHandle,
  type ISubagentJobStart,
  type ISubagentRunner,
  type ISubagentWorktreeAdapter,
} from '@robota-sdk/agent-executor';
import {
  readSubagentTranscriptPage,
  resolveSubagentLogSessionId,
  resolveSubagentTranscriptPath,
} from '@robota-sdk/agent-framework';
import { DEFAULT_KILL_GRACE_MS } from '@robota-sdk/agent-process';

import {
  preflightStartPayloadSealing,
  projectProviderConnection,
  projectStartPayload,
  projectStartPayloadSealing,
  type IProjectedConnection,
  type IProjectedSealing,
  type IProjectedStartSealing,
} from './child-process-subagent-projection.js';
import { followForkRecordSaves } from './child-process-subagent-record-saves.js';
import {
  cancelUnstartedChild,
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
  TArtifactSealing,
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
   * The owner lets commands see the provider credential variable, so the worker keeps it in its own
   * environment. Absent ⇒ the worker removes it once its provider is built.
   */
  keepProviderCredential?: boolean;
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
  /**
   * How the children keep their logs, from the composition root's one sealing decision; required, so
   * a host cannot leave children writing plain transcripts beside sealed stores. With a sealer, every
   * start payload carries the write grant the sealer issues when the payload is sent (a job is
   * refused before anything is made for it when the sealer cannot issue one), a fork job carries the
   * record the parent's store holds, handles say their transcript is sealed, and `readLog` opens with
   * this sealing. With `'plain'`, children write plain transcripts and a sealed one is not opened.
   */
  logSealing: TArtifactSealing;
  /**
   * Be told that the key the parent seals to was verified or changed; returns the way to stop. The
   * runner then re-reads its write grant and sends it to every running child whose grant differs
   * (see {@link ChildProcessSubagentRunner.refreshWriteGrant}). Watched only while children run.
   */
  watchSealingKey?: (listener: () => void) => () => void;
}

/** A child that seals and was sent `start`, and the grant the last message it was sent carried. */
interface ISealingChild {
  readonly child: ChildProcess;
  grant: string;
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
  private readonly keepProviderCredential: boolean;
  private readonly parentSandboxSettings?: () => TParentSandboxSettings | undefined;
  private readonly watchParentSandboxSettings?: IChildProcessSubagentRunnerOptions['watchParentSandboxSettings'];
  private readonly logSealing: TArtifactSealing;
  private readonly watchSealingKey?: IChildProcessSubagentRunnerOptions['watchSealingKey'];
  private readonly sealingChildren = new Set<ISealingChild>();
  private unwatchSealingKey: (() => void) | undefined;

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
      throw new Error(
        'An explicit expected environment is required when child inheritance is disabled.',
      );
    }
    this.logsDir = options.logsDir;
    this.keepProviderCredential = options.keepProviderCredential === true;
    this.parentSandboxSettings = options.parentSandboxSettings;
    this.watchParentSandboxSettings = options.watchParentSandboxSettings;
    const logSealing: unknown = options.logSealing;
    if (
      logSealing !== 'plain' &&
      (typeof logSealing !== 'object' ||
        logSealing === null ||
        typeof (logSealing as { readonly sealer?: unknown }).sealer !== 'object' ||
        (logSealing as { readonly sealer?: unknown }).sealer === null)
    ) {
      // A caller that ignores the types is refused, as one that passes a bad value is.
      throw new TypeError(
        "The runner states how its children keep their logs: { sealer }, or 'plain'.",
      );
    }
    this.logSealing = options.logSealing;
    this.watchSealingKey = options.watchSealingKey;
  }

  /**
   * Refuses, before anything is made for it, a job whose payload could not carry what the parent's
   * sealing needs (see {@link preflightStartPayloadSealing}): the worktree runner calls this before it
   * prepares a worktree. It takes nothing — a fork record stays with the store until {@link start}
   * hands it over — so a job that fails in between can be run again.
   */
  preflight(job: ISubagentJobStart): void {
    preflightStartPayloadSealing(job, this.deps, this.logSealing);
  }

  start(job: ISubagentJobStart): ISubagentJobHandle {
    // DIST-006: `spawn` rather than `fork` — `fork` is `spawn(process.execPath, [module, …])` with
    // an ipc stdio, and the module is exactly the thing that cannot be named for every artifact.
    // Stating execPath and args outright is the same mechanism without the assumption.
    const entry = this.workerEntry;
    const env = this.inheritEnvironment
      ? { ...process.env, ...(this.env ?? {}) }
      : { ...(this.env ?? {}) };
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
    // Also before spawning: a job that cannot carry what its parent's sealing needs — a grant, a
    // fork record the keys cannot hand over, a record past the wire bound — never starts a child.
    // This only looks: the fork record is handed over once the child exists (below).
    preflightStartPayloadSealing(job, this.deps, this.logSealing);
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
    const runtime: IChildProcessRuntime = {
      job,
      child,
      killGraceMs: this.killGraceMs,
    };
    // The fork record is handed over only now that the child exists, and its follower is attached in
    // the same turn: the export ends only when the follower sees the child gone, so no start that
    // fails before this point can leave the record exported for the rest of the process.
    let sealing: IProjectedStartSealing;
    try {
      sealing = projectStartPayloadSealing(job, this.deps, this.logSealing);
    } catch (error) {
      // The child would wait for a `start` that is never coming; it must not outlive the refusal.
      void cancelUnstartedChild(runtime);
      throw error;
    }
    // A sealing parent's fork job: from the first message on, the parent keeps the child's reports
    // of its record saves, past the job's result, to vouch for the last of them once the child is gone.
    const store = this.deps.resumeSessionStore;
    if (sealing.fork !== undefined && store !== undefined) {
      followForkRecordSaves(child, {
        sessionId: sealing.fork.sessionId,
        startedOwner: sealing.fork.startedOwner,
        store,
      });
    }
    // Watch BEFORE the payload reads the settings: a change made while the child starts is then either
    // in the payload or sent after it, never lost between the two.
    this.forwardSandboxSettingChanges(child);
    let payload: Promise<ISubagentWorkerStartPayload>;
    try {
      payload = this.createStartPayload(job, connection, sealing.payload);
    } catch (error) {
      // The child would wait for a `start` that is never coming; it must not outlive the refusal.
      void cancelUnstartedChild(runtime);
      throw error;
    }
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
      beforeStart: (startPayload) => this.sealStartPayload(child, startPayload),
      ...(sealing.fork !== undefined ? { followsRecordSaves: true as const } : {}),
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
    const logSealing = this.logSealing;

    return {
      taskId: job.taskId,
      ...(child.pid !== undefined && { pid: child.pid }),
      ...(transcriptPath !== undefined && { transcriptPath, logPath: transcriptPath }),
      // The child seals its log with this runner's grant; the task state carries the fact on.
      ...(transcriptPath !== undefined &&
        logSealing !== 'plain' && { transcriptSealed: true as const }),
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
          readTranscriptLog(job.taskId, transcriptPath, cursor, logSealing),
      }),
    };
  }

  /**
   * Re-reads the write grant this runner's sealer issues and sends it (`sealing_key`) to every
   * running child that was sent `start` with another — what a composition root calls when the key it
   * seals to is verified or changes, so a child started before the parent's first unlock seals to the
   * verified key from then on. A child not sent `start` yet gets the grant in its payload instead.
   * Resolves once each message was handed to its channel.
   */
  async refreshWriteGrant(): Promise<void> {
    if (this.logSealing === 'plain' || this.sealingChildren.size === 0) return;
    const grant = this.logSealing.sealer.writeGrant?.();
    if (grant === undefined) return;
    const sends: Promise<void>[] = [];
    for (const sealing of this.sealingChildren) {
      if (sealing.grant === grant || !sealing.child.connected) continue;
      // allow-fallback: a child whose channel is gone has exited and seals nothing more.
      sends.push(
        sendWorkerMessage(sealing.child, { type: 'sealing_key', grant }).catch(() => undefined),
      );
      sealing.grant = grant;
    }
    await Promise.all(sends);
  }

  /**
   * The payload as `start` sends it, in the same turn as the send: with the grant this runner's
   * sealer issues now, so a key verified between spawning and sending reaches the child in the
   * payload itself, and with the child among those {@link refreshWriteGrant} reaches from now on —
   * never earlier, so no newer grant travels ahead of the payload it would have to replace.
   */
  private sealStartPayload(
    child: ChildProcess,
    payload: ISubagentWorkerStartPayload,
  ): ISubagentWorkerStartPayload {
    if (this.logSealing === 'plain') return payload;
    const writeGrant = this.logSealing.sealer.writeGrant?.();
    if (writeGrant === undefined) {
      throw new BackgroundTaskError(
        'validation',
        'This session seals its logs, but its sealer no longer hands its sealing to a subagent; ' +
          'the subagent was not started.',
      );
    }
    this.followSealingKey(child, writeGrant);
    return { ...payload, writeGrant };
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
    sealing: IProjectedSealing,
  ): Promise<ISubagentWorkerStartPayload> {
    const parentSandboxSettings = this.parentSandboxSettings?.();
    return projectStartPayload(job, this.deps, {
      connection,
      providerDefinitions: this.providerDefinitions,
      ...(this.logsDir !== undefined ? { logsDir: this.logsDir } : {}),
      ...(this.keepProviderCredential ? { keepProviderCredential: true } : {}),
      ...(parentSandboxSettings !== undefined ? { parentSandboxSettings } : {}),
      ...sealing,
    });
  }

  /**
   * Keeps a sealing child among those {@link refreshWriteGrant} reaches until it exits, and watches
   * the parent's sealing key only while any is running. A child started plain stays plain, and one
   * whose channel is already gone is never added, since it would never say it exited.
   */
  private followSealingKey(child: ChildProcess, grant: string): void {
    if (!child.connected) return;
    const sealing: ISealingChild = { child, grant };
    this.sealingChildren.add(sealing);
    if (this.sealingChildren.size === 1 && this.watchSealingKey !== undefined) {
      // allow-fallback: a grant that cannot be read now leaves each child on the one it has.
      this.unwatchSealingKey = this.watchSealingKey(() => {
        void this.refreshWriteGrant().catch(() => undefined);
      });
    }
    // A child that never started emits `error` and no `exit`; either ends it, and twice is harmless.
    const done = (): void => {
      this.sealingChildren.delete(sealing);
      if (this.sealingChildren.size > 0) return;
      this.unwatchSealingKey?.();
      this.unwatchSealingKey = undefined;
    };
    child.once('exit', done);
    child.once('error', done);
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

  /** Where the child writes its log, by the rule the child names it with (a fork's: the fork id). */
  private resolveTranscriptPath(job: ISubagentJobStart): string | undefined {
    if (!this.logsDir) return undefined;
    return resolveSubagentTranscriptPath(
      this.logsDir,
      job.request.parentSessionId,
      resolveSubagentLogSessionId(job.request, job.taskId),
    );
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

/**
 * A page of the child's transcript (R1). The cursor counts stored records, so an offset names the
 * same record whether the keys are locked or not; only the records on the page are opened, and
 * `unreadable` says how many of them could not be shown.
 */
function readTranscriptLog(
  taskId: string,
  transcriptPath: string,
  cursor: IBackgroundTaskLogCursor | undefined,
  sealing: TArtifactSealing,
): IBackgroundTaskLogPage {
  const page = readSubagentTranscriptPage(transcriptPath, {
    sealing,
    ...(cursor !== undefined ? { offset: cursor.offset } : {}),
  });
  if (page === undefined) {
    return {
      taskId,
      cursor,
      lines: [],
    };
  }
  return {
    taskId,
    cursor,
    nextCursor: page.nextOffset === undefined ? undefined : { offset: page.nextOffset },
    lines: [...page.lines],
    ...(page.unreadable === undefined ? {} : { unreadable: { ...page.unreadable } }),
  };
}
