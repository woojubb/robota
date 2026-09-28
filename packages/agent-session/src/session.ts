import {
  TRUST_TO_MODE,
  ObservableEventService,
  PROVIDER_CALL_EVENTS,
  PROVIDER_FALLBACK_EVENTS,
  ExecutionRecoveryError,
  ExecutionSuspendedError,
} from '@robota-sdk/agent-core';

import { SessionBase } from './session-base.js';
import {
  buildPermissionEnforcer,
  buildRobota,
  buildSessionTrackers,
} from './session-components.js';
import { buildCompactContext, compact, persistSession } from './session-history-ops.js';
import { createSessionId } from './session-id.js';
import {
  configureProvider,
  fireSessionEndHook,
  fireSessionStartHook,
} from './session-lifecycle.js';
import { executeResume, type TSessionResumeOptions } from './session-resume.js';
import { sessionExecutionJournal, sessionRecoveryJournal } from './session-execution-journal.js';
import { executeRun } from './session-run.js';
import {
  abandonedRoundResults,
  noteEffectAdmissions,
  pendingExecution,
  recoverableSessionExecution,
  unfinishedExecution,
} from './session-recoverable.js';
import type {
  ISessionPendingExecution,
  ISessionRecoverableRunOptions,
  TSessionRecoverableResumeOptions,
  TSessionExecutionResult,
} from './session-recoverable.js';
import { SessionRuntimeTools, linkCancellation } from './session-runtime-tools.js';

import type { CompactionOrchestrator } from './compaction-orchestrator.js';
import type { ContextWindowTracker } from './context-window-tracker.js';
import type { PermissionEnforcer } from './permission-enforcer.js';
import type {
  TPermissionHandler,
  TPermissionResult,
  IPermissionAskContext,
  TPermissionRequester,
  ITerminalOutput,
  ISpinner,
} from './permission-types.js';
import type { ISessionLogger, TSessionLogData } from './session-logger.js';
import type { IRunContext } from './session-run-context.js';
import type {
  ICompactEvent,
  ISessionOptions,
  ISessionShutdownOptions,
  ISessionRunOptions,
  TCompactTrigger,
} from './session-types.js';
import type {
  IAIProvider,
  IExecutionJournal,
  IContextWindowState,
  IEventService,
  IToolSchema,
  IToolExecutionResult,
  IToolWithEventService,
  TToolParameters,
  TPermissionMode,
  IHookTypeExecutor,
  ISubprocessTraceEnv,
} from '@robota-sdk/agent-core';
import type { Robota } from '@robota-sdk/agent-core';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

export type {
  ICompactEvent,
  TPermissionHandler,
  TPermissionResult,
  IPermissionAskContext,
  TPermissionRequester,
  ITerminalOutput,
  ISpinner,
  ISessionOptions,
  ISessionShutdownOptions,
  TCompactTrigger,
};
export type { TAutoCompactThreshold } from './context-window-tracker.js';

/** Wraps a Robota agent with project context, permission state, and optional persistence. */
export class Session extends SessionBase {
  protected readonly agent: Robota;
  /**
   * SELFHOST-004: session-owned observable event bus. Injected into the agent so tools (incl. the
   * `FunctionTool` span-completion emit) publish here; the interactive turn subscribes to it to
   * project per-operation spans onto session history. Exposed read-only via {@link getEventService}.
   */
  protected readonly eventService: IEventService = new ObservableEventService();
  protected readonly permissionEnforcer: PermissionEnforcer;
  protected readonly contextTracker: ContextWindowTracker;
  protected permissionMode: TPermissionMode;
  protected activePresetId: string;
  protected parallelSubagentsEnabled: boolean;
  protected readonly sessionId: string;
  protected aiProvider: IAIProvider;
  protected readonly toolSchemas: IToolSchema[];
  protected model: string;
  protected systemMessage: string;
  protected messageCount = 0;
  private readonly terminal: ITerminalOutput;
  private readonly sessionStore?: IInteractiveSessionStore;
  private readonly hooks?: Record<string, unknown>;
  private readonly hookTypeExecutors?: IHookTypeExecutor[];
  private readonly onTextDeltaCallback?: (delta: string) => void;
  private readonly onContextUpdateCallback?: (state: IContextWindowState) => void;
  private readonly onToolExecutionCallback?: ISessionOptions['onToolExecution'];
  private readonly onCompactCallback?: (summary: string) => void;
  private readonly onCompactEventCallback?: ISessionOptions['onCompactEvent'];
  private readonly sessionLogger?: ISessionLogger;
  private readonly maxTurns?: number;
  private readonly compactionOrchestrator: CompactionOrchestrator;
  private readonly runtimeTools: SessionRuntimeTools;
  private readonly wrapAddedTools: ISessionOptions['wrapAddedTools'];
  /** Tools added while a turn ran, applied when the next one starts. */
  private readonly pendingTools: IToolWithEventService[] = [];
  /** The last tool change; the next one waits for it. */
  private toolChange: Promise<void> = Promise.resolve();
  private shuttingDown = false;
  /** Set while a journaled execution's round is open in history; cleared once it settles or is abandoned. */
  private pendingExecution?: ISessionPendingExecution;
  private shutdownPromise: Promise<void> | null = null;
  /** Stdout collected from SessionStart hooks, injected on first run(). */
  private sessionStartStdout = '';
  /** Absolute path to the session transcript file, if file-backed storage is active. */
  private readonly transcriptPath: string | undefined;

  constructor(options: ISessionOptions) {
    super(options.cwd);
    const { tools, provider, systemMessage } = options;

    this.terminal = options.terminal;
    this.sessionStore = options.sessionStore;
    this.systemMessage = systemMessage;
    this.toolSchemas = tools.map((tool) => tool.schema);
    this.wrapAddedTools = options.wrapAddedTools;
    this.sessionLogger = options.sessionLogger;
    this.hooks = options.hooks;
    this.hookTypeExecutors = options.hookTypeExecutors;
    this.onTextDeltaCallback = options.onTextDelta;
    this.onContextUpdateCallback = options.onContextUpdate;
    this.onToolExecutionCallback = options.onToolExecution;
    this.onCompactCallback = options.onCompact;
    this.onCompactEventCallback = options.onCompactEvent;
    this.maxTurns = options.maxTurns;
    this.model = options.model ?? 'claude-sonnet-4-5';
    this.sessionId = options.sessionId ?? createSessionId();
    this.permissionMode =
      options.permissionMode ??
      (options.defaultTrustLevel ? TRUST_TO_MODE[options.defaultTrustLevel] : undefined) ??
      'default';
    this.activePresetId = options.activePresetId ?? 'default';
    // PRESET-016: default true preserves the current behavior — subagent dispatch is allowed
    // unless a preset explicitly disables it.
    this.parallelSubagentsEnabled = options.enableParallelSubagents ?? true;
    this.transcriptPath = options.transcriptPath;
    this.log('session_init', {
      cwd: this.cwd,
      systemPromptLength: systemMessage.length,
      systemPrompt: systemMessage,
      toolSchemas: this.toolSchemas,
      model: this.model,
      provider: provider.name,
    });
    this.aiProvider = provider;
    configureProvider(provider, options, (event, data) => this.log(event, data));
    this.permissionEnforcer = buildPermissionEnforcer(
      options,
      this.sessionId,
      this.cwd,
      () => this.permissionMode,
      this.transcriptPath,
    );
    this.requireClassifierFor(this.permissionMode);
    this.addPermissionModeGuard((next) => this.requireClassifierFor(next));
    const { contextTracker, compactionOrchestrator } = buildSessionTrackers(
      options,
      this.model,
      this.sessionId,
      this.cwd,
    );
    this.contextTracker = contextTracker;
    this.compactionOrchestrator = compactionOrchestrator;
    this.agent = buildRobota(
      options,
      this.permissionEnforcer,
      tools,
      provider,
      this.model,
      systemMessage,
      this.eventService,
    );
    this.runtimeTools = new SessionRuntimeTools(this.agent, this.turnClaim, this.sessionId);
    fireSessionStartHook(
      this.sessionId,
      this.cwd,
      this.hooks,
      this.hookTypeExecutors,
      (stdout) => void (this.sessionStartStdout = stdout),
      this.permissionMode,
      this.transcriptPath,
    );
  }

  /**
   * @param options.ephemeralSystemContext SELFHOST-008 P3 — a transient system-role block included in this
   *   turn's model call only, never persisted to history (thin pass-through to agent-core `IRunOptions`).
   * REJECTS with `SessionBusyError` if a turn is in flight — RUNTIME-003; see `turn-claim.ts`.
   */
  async run(message: string, rawInput?: string, options?: ISessionRunOptions): Promise<string> {
    return this.runTurn(message, rawInput, options, false);
  }

  /** Run with durable approval requests instead of a live approval Promise. */
  runRecoverable(
    message: string,
    options: ISessionRecoverableRunOptions,
    rawInput?: string,
  ): Promise<TSessionExecutionResult> {
    return recoverableSessionExecution(
      () => this.runTurn(message, rawInput, options, true),
      options.executionJournal,
    );
  }

  private async runTurn(
    message: string,
    rawInput: string | undefined,
    value: ISessionRunOptions | undefined,
    checkpointedApprovals: boolean,
  ): Promise<string> {
    const options = value ? { ...value } : undefined;
    if (this.shuttingDown) throw new Error('[LIFECYCLE] Session is shutting down');
    if (this.pendingExecution)
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_REQUIRED',
        'Resume or abandon the pending Session execution before submitting new input',
      );
    const controller = this.turnClaim.claim(); // Synchronously, before any await.
    const unlink = linkCancellation(controller, options?.signal);
    const { signal } = controller;
    // Whether the reply to a peer exists is decided per turn.
    this.permissionEnforcer.beginTurn(options?.peerTurn === true, checkpointedApprovals);
    try {
      signal.throwIfAborted();
      // Tools added while the last turn ran join at this boundary, before any request of this turn;
      // a change already in flight finishes first, so the turn never sees a list mid-update.
      await this.serializeToolChange(() => this.applyPendingTools());
      const runOptions = options?.executionJournal
        ? {
            ...options,
            executionJournal: sessionExecutionJournal(options.executionJournal, {
              sessionId: this.sessionId,
              cwd: this.cwd,
              peerTurn: options.peerTurn === true,
            }),
          }
        : options;
      const response = await executeRun(
        message,
        rawInput,
        this.buildRunContext(),
        signal,
        runOptions,
      );
      this.messageCount += 1;
      return response;
    } catch (error) {
      if (error instanceof ExecutionSuspendedError) {
        this.pendingExecution = pendingExecution(error);
        signal.throwIfAborted();
      } else if (options?.executionJournal) {
        this.pendingExecution = unfinishedExecution(this.agent.getHistory(), undefined, new Set());
      }
      throw error;
    } finally {
      this.permissionEnforcer.endTurn();
      unlink();
      this.turnClaim.release(controller);
    }
  }

  /** Resume the original Session execution under current permissions without submitting input. */
  async resume(options: TSessionResumeOptions): Promise<string> {
    return this.resumeTurn(options, false);
  }

  /** Recheck current permissions and continue exact journaled responses without another input. */
  resumeRecoverable(options: TSessionRecoverableResumeOptions): Promise<TSessionExecutionResult> {
    return recoverableSessionExecution(() => this.resumeTurn(options, true), options.journal);
  }

  private async resumeTurn(
    value: TSessionRecoverableResumeOptions,
    checkpointedApprovals: boolean,
  ): Promise<string> {
    const options = { ...value, toolResponses: structuredClone(value.toolResponses) };
    if (this.shuttingDown) throw new Error('[LIFECYCLE] Session is shutting down');
    if (this.pendingExecution && this.pendingExecution.executionId !== options.executionId)
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_CONFLICT',
        'A different Session execution is pending',
      );
    const controller = this.turnClaim.claim();
    const unlink = linkCancellation(controller, options.signal);
    const admitted = new Set<string>();
    try {
      controller.signal.throwIfAborted();
      await this.serializeToolChange(() => this.applyPendingTools());
      const journal = sessionRecoveryJournal(
        noteEffectAdmissions(options.journal, admitted),
        this.sessionId,
        this.cwd,
        (peerTurn) => this.permissionEnforcer.beginTurn(peerTurn, checkpointedApprovals),
      );
      const response = await executeResume(this.buildRunContext(), {
        ...options,
        journal,
        signal: controller.signal,
      });
      this.pendingExecution = undefined;
      return response;
    } catch (error) {
      if (error instanceof ExecutionSuspendedError) {
        this.pendingExecution = pendingExecution(error);
        controller.signal.throwIfAborted();
      } else {
        // Settled rounds end the execution like an ordinary turn; a round left open keeps it pending.
        this.pendingExecution = unfinishedExecution(
          this.agent.getHistory(),
          this.pendingExecution,
          admitted,
        );
      }
      throw error;
    } finally {
      this.permissionEnforcer.endTurn();
      unlink();
      this.turnClaim.release(controller);
    }
  }

  /** The execution blocking new input, if any: parked on saved waits, or left open by a failure. */
  getPendingExecution(): ISessionPendingExecution | undefined {
    return structuredClone(this.pendingExecution);
  }

  /**
   * Give up a pending execution so the Session accepts new input. Nothing runs and nothing is
   * journaled: calls its parked round left open are closed in history as failed, and the journal's
   * records stay with the host. Resuming the execution afterwards is refused as a history conflict.
   */
  abandonPendingExecution(executionId: string): void {
    if (this.shuttingDown) throw new Error('[LIFECYCLE] Session is shutting down');
    const pending = this.pendingExecution;
    if (!pending) return;
    if (pending.executionId !== executionId)
      throw new ExecutionRecoveryError(
        'EXECUTION_RECOVERY_CONFLICT',
        'A different Session execution is pending',
      );
    const controller = this.turnClaim.claim();
    try {
      for (const message of abandonedRoundResults(this.agent.getHistory(), pending))
        this.agent.injectRawMessage(message);
      this.pendingExecution = undefined;
      this.persistSessionInternal();
    } finally {
      this.turnClaim.release(controller);
    }
  }

  /**
   * Make tools available from the next turn on — for a capability that became usable mid-session,
   * such as an MCP server connected after its sign-in. Each goes through the same wrappers and
   * permission gate as a tool present from the start. A tool whose name the session already has, or
   * has queued, is left out rather than replacing the one the conversation has been using.
   *
   * The tool list is part of what a provider caches a prompt by, and a turn's rounds must all see
   * the same list: while a turn runs, the tools wait and are applied when the next turn starts;
   * otherwise they are applied now. Calls are serialized, so two concurrent ones both land.
   * Resolves to the names that will be offered.
   */
  addTools(tools: readonly IToolWithEventService[]): Promise<readonly string[]> {
    if (this.shuttingDown) {
      return Promise.reject(new Error('[LIFECYCLE] Session is shutting down'));
    }
    return this.serializeToolChange(async () => {
      const known = new Set([
        ...this.toolSchemas.map((schema) => schema.name),
        ...this.pendingTools.map((tool) => tool.schema.name),
      ]);
      const fresh: IToolWithEventService[] = [];
      for (const tool of tools) {
        if (known.has(tool.schema.name)) continue;
        known.add(tool.schema.name);
        fresh.push(tool);
      }
      if (fresh.length === 0) return [];
      this.pendingTools.push(...fresh);
      if (!this.turnClaim.isRunning()) await this.applyPendingTools();
      return fresh.map((tool) => tool.schema.name);
    });
  }

  /** Runs `change` after every tool change before it, so each reads the list the last one wrote. */
  private serializeToolChange<T>(change: () => Promise<T>): Promise<T> {
    const result = this.toolChange.then(change);
    this.toolChange = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Registers the queued tools with the agent. Only ever called inside `serializeToolChange`. */
  private async applyPendingTools(): Promise<void> {
    if (this.pendingTools.length === 0) return;
    const fresh = this.pendingTools.splice(0);
    await this.agent.ensureReady();
    const wrapped = this.permissionEnforcer.wrapTools(this.wrapAddedTools?.(fresh) ?? fresh);
    await this.agent.updateTools([...(this.agent.getConfig().tools ?? []), ...wrapped]);
    this.toolSchemas.push(...wrapped.map((tool) => tool.schema));
  }

  async listRuntimeTools(): Promise<IToolSchema[]> {
    if (this.shuttingDown) throw new Error('[LIFECYCLE] Session is shutting down');
    return this.agent.listRuntimeTools();
  }

  async invokeRuntimeTool(
    name: string,
    parameters: TToolParameters,
    options?: { signal?: AbortSignal },
  ): Promise<IToolExecutionResult> {
    if (this.shuttingDown) throw new Error('[LIFECYCLE] Session is shutting down');
    return this.runtimeTools.invoke(name, parameters, options?.signal);
  }

  /**
   * SELFHOST-004: the session-owned observable event bus the agent's tools publish to. The interactive
   * turn subscribes to it to collect span-completion events and project them onto session history.
   */
  getEventService(): IEventService {
    return this.eventService;
  }

  private log(event: string, data: TSessionLogData): void {
    this.sessionLogger?.log(this.sessionId, event, data);
  }

  private persistSessionInternal(): void {
    if (!this.sessionStore) return;
    persistSession({
      sessionId: this.sessionId,
      cwd: this.cwd,
      systemPrompt: this.systemMessage,
      toolSchemas: this.toolSchemas,
      sessionStore: this.sessionStore,
      agent: this.agent,
      getFullHistory: () => this.getFullHistory(),
    });
  }

  /**
   * Gracefully end the session and fire SessionEnd hooks once — **best-effort** (CORE-013
   * disposal convention): never rejects, so `void session.shutdown()` cannot become an
   * unhandled rejection. Step failures are recorded to the session log and remaining steps
   * still run.
   */
  shutdown(options: ISessionShutdownOptions = {}): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    const reason = options.reason ?? 'other';
    const step = async (label: string, run: () => Promise<void> | void): Promise<void> => {
      try {
        await run();
      } catch (error) {
        // allow-fallback: best-effort disposal IS the contract — the failure is logged and remaining shutdown steps still run (CORE-013 convention)
        this.log('session_shutdown_step_error', {
          step: label,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    this.shutdownPromise = (async () => {
      await step('abort', () => this.abort());
      await step('drain-direct-tool', () => this.runtimeTools.drain());
      await step('drain-turn', () => this.turnClaim.drained);
      this.log('session_shutdown', { reason });
      await step('persist', () => this.persistSessionInternal());
      await step('session-end-hook', () =>
        fireSessionEndHook(
          this.sessionId,
          this.cwd,
          reason,
          this.hooks,
          this.hookTypeExecutors,
          this.permissionMode,
          this.transcriptPath,
        ),
      );
      // CORE-022 (SPEC § Disposal Chain Contract): shutdown drives agent destruction —
      // plugins are disposed so no timers/listeners survive and the process can exit.
      await step('destroy-agent', async () => {
        await this.agent.destroy();
      });
    })();
    return this.shutdownPromise;
  }

  swapProvider(newProvider: IAIProvider, model: string): void {
    this.agent.swapDefaultProvider(newProvider, model);
    newProvider.configureNativeWebTools?.({ webSearch: true });
    if ('onServerToolUse' in newProvider) {
      (
        newProvider as { onServerToolUse?: (name: string, input: Record<string, string>) => void }
      ).onServerToolUse = (name: string, input: Record<string, string>) =>
        this.log('server_tool', { tool: name, ...input });
    }
    this.aiProvider = newProvider;
    // #3282 §2: without this, getModelId() (session_status's `model` field) kept reporting the
    // PREVIOUS provider's model after a hot-swap — `this.model` is this class's own cache and
    // `swapDefaultProvider` has no reason to know about it.
    this.model = model;
  }

  async compact(
    instructions?: string,
    trigger: TCompactTrigger = 'manual',
    signal?: AbortSignal,
    executionJournal?: IExecutionJournal,
  ): Promise<void> {
    await this.compactWith(instructions, trigger, signal, undefined, executionJournal);
  }

  /** `hookTraceEnv` reaches PreCompact only for a compaction inside a prompt (see `executeRun`). */
  private async compactWith(
    instructions: string | undefined,
    trigger: TCompactTrigger,
    signal?: AbortSignal,
    hookTraceEnv?: ISubprocessTraceEnv,
    executionJournal?: IExecutionJournal,
  ): Promise<void> {
    const extras = {
      systemMessage: this.systemMessage,
      compactionOrchestrator: this.compactionOrchestrator,
      onCompactCallback: this.onCompactCallback,
      onCompactEventCallback: this.onCompactEventCallback,
      trigger,
      ...(hookTraceEnv ? { hookTraceEnv } : {}),
      ...(executionJournal ? { executionJournal } : {}),
    };
    await compact(instructions, buildCompactContext(this.buildRunContext(), extras), signal);
  }

  private buildRunContext(): IRunContext {
    return {
      sessionId: this.sessionId,
      cwd: this.cwd,
      model: this.model,
      effort: this.getModelEffort(),
      agent: this.agent,
      aiProvider: this.aiProvider,
      contextTracker: this.contextTracker,
      hooks: this.hooks,
      hookTypeExecutors: this.hookTypeExecutors,
      sessionStartStdout: this.sessionStartStdout,
      log: (event: string, data: TSessionLogData) => this.log(event, data),
      compact: (signal, hookTraceEnv, executionJournal) =>
        this.compactWith(undefined, 'auto', signal, hookTraceEnv, executionJournal),
      persistSession: () => this.persistSessionInternal(),
      getSessionStore: () => !!this.sessionStore,
      clearSessionStartStdout: () => void (this.sessionStartStdout = ''),
      permissionMode: this.permissionMode,
      transcriptPath: this.transcriptPath,
      maxTurns: this.maxTurns,
      onTextDelta: this.onTextDeltaCallback,
      onContextUpdate: this.onContextUpdateCallback,
      onToolExecution: this.onToolExecutionCallback,
      emitProviderCallCompleted: (observation) =>
        this.eventService.emit(
          PROVIDER_CALL_EVENTS.COMPLETED,
          { timestamp: new Date(), ...observation },
          {
            ownerType: 'session',
            ownerId: this.sessionId,
            ownerPath: [{ type: 'session', id: this.sessionId }],
          },
        ),
      emitProviderFallback: (notice) =>
        this.eventService.emit(
          PROVIDER_FALLBACK_EVENTS.SWITCHED,
          {
            timestamp: new Date(),
            fromProvider: notice.from.provider,
            fromModel: notice.from.model,
            toProvider: notice.to.provider,
            toModel: notice.to.model,
            reason: notice.reason,
          },
          {
            ownerType: 'session',
            ownerId: this.sessionId,
            ownerPath: [{ type: 'session', id: this.sessionId }],
          },
        ),
      knownToolNames: this.toolSchemas.map((tool) => tool.name),
    };
  }
}
