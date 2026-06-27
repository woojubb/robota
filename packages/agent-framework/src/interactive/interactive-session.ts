import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';

import { SessionBackgroundTaskTracker } from './interactive-session-background-tracker.js';
import { InteractiveSessionBase } from './interactive-session-base.js';
import { SessionExecutionController } from './interactive-session-execution-controller.js';
import { runSkillInFork } from './interactive-session-fork.js';
import { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import { initializeInteractiveSessionAsync } from './interactive-session-init.js';
import { persistSession } from './interactive-session-persistence.js';
import { loadSessionRecord } from './interactive-session-restore.js';
import { SessionSkillRouter } from './interactive-session-skill-router.js';
import { retrieveSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import { formatOrgPolicyViolationMessage } from '../command-api/org-policy/org-policy-loader.js';
import {
  createProviderFromSettings,
  readProviderSettings,
} from '../command-api/provider/provider-factory.js';
import { GoalController, buildGoalContinuationPrompt } from '../goal/index.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';

import type { IInteractiveSession } from './i-interactive-session.js';
import type { ITurnOptions } from './interactive-session-execution-controller.js';
import type { ICreatedInteractiveSession } from './interactive-session-init.js';
import type {
  TInteractiveSessionOptions,
  IInteractiveSessionStandardOptions,
} from './interactive-session-options.js';
import type { IInteractiveSessionStore } from './session-persistence.js';
import type {
  TInteractiveEventName,
  IInteractiveSessionEvents,
  IExecutionResult,
} from './types.js';
import type { IBackgroundTaskManager } from '../background-tasks/index.js';
import type { ICommandHostContext } from '../command-api/index.js';
import type {
  IAgentJobHostContext,
  ICommandResult,
  TAutoCompactThresholdSource,
  TAutoCompactThreshold,
} from '../commands/index.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import type { IGoalStartOptions } from '../goal/index.js';
import type {
  TUniversalMessage,
  TSessionEndReason,
  IProviderDefinition,
} from '@robota-sdk/agent-core';
import type { ISession } from '@robota-sdk/agent-core';
import type {
  ITransportAdapter,
  IGoalState,
  TTurnSource,
} from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';
import type { ISandboxClient } from '@robota-sdk/agent-tools';
export type { TInteractiveSessionOptions } from './interactive-session-options.js';

export interface IInteractiveSessionShutdownOptions {
  reason?: TSessionEndReason;
  message?: string;
}

export class InteractiveSession
  extends InteractiveSessionBase
  implements ISession, IAgentJobHostContext, IInteractiveSession
{
  private session: Session | null = null;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private sessionStore?: IInteractiveSessionStore;
  private sessionName?: string;
  private cwd?: string;
  private pendingRestoreMessages: TUniversalMessage[] | null = null;
  private resumeSessionId?: string;
  private forkSession: boolean;
  private autoCompactThresholdSource: TAutoCompactThresholdSource = 'default';
  private shutdownPromise: Promise<void> | null = null;
  private readonly sandboxClient?: ISandboxClient;
  private sandboxSnapshotId?: string;
  private agentsFileEntries: IContextFileEntry[] = [];
  private claudeFileEntries: IContextFileEntry[] = [];
  private rebuildSystemMessage: ICreatedInteractiveSession['rebuildSystemMessage'] | null = null;
  private providerDefinitions: readonly IProviderDefinition[] = [];
  private orgPolicy: import('../command-api/org-policy/org-policy-types.js').IOrgPolicy | null =
    null;
  protected readonly bgTracker: SessionBackgroundTaskTracker;
  protected readonly histTracker: SessionHistoryTracker;
  protected readonly skillRouter: SessionSkillRouter;
  protected readonly execCtrl: SessionExecutionController;
  /** GOAL-001: autonomous objective-pursuit controller (inert until a goal is set). */
  private readonly goalController = new GoalController();
  /** GOAL-001: origin of the most recently started turn — gates goal-loop advancement. */
  private currentTurnSource: TTurnSource = 'user';

  constructor(options: TInteractiveSessionOptions) {
    super();
    this.sessionStore = options.sessionStore;
    this.sessionName = options.sessionName;
    this.cwd = ('cwd' in options ? options.cwd : undefined) ?? '';
    this.resumeSessionId = options.resumeSessionId;
    this.forkSession = options.forkSession ?? false;
    this.sandboxClient = 'sandboxClient' in options ? options.sandboxClient : undefined;
    this.sandboxSnapshotId = 'sandboxSnapshotId' in options ? options.sandboxSnapshotId : undefined;

    const cwd = this.cwd;
    let initCheckpointStore: EditCheckpointStore | null = null;
    if ('session' in options && options.session && cwd) {
      initCheckpointStore = new EditCheckpointStore({ cwd });
    }

    this.bgTracker = new SessionBackgroundTaskTracker(
      () => this.getBackgroundTaskManager(),
      (cause, entryId) => this.execCtrl.emitExecutionWorkspaceUpdated(cause, entryId),
      (event) => this.emit('background_task_event', event),
      (event) => this.emit('background_job_group_event', event),
      () => this.persistCurrentSession(),
      (instruction, taskId) => this.requestWakeup(instruction, taskId),
      (message) => this.histTracker.append(messageToHistoryEntry(createSystemMessage(message))),
    );

    this.histTracker = new SessionHistoryTracker(
      cwd,
      () => this.getSessionOrThrow().getSessionId(),
      () => this.execCtrl.executing,
      () => this.persistCurrentSession(),
      (event) => this.emit('skill_activation', event),
      (event) => this.emit('memory_event', event),
      initCheckpointStore,
    );

    const commandModules = [...('commandModules' in options ? (options.commandModules ?? []) : [])];
    const commandHostAdapters =
      'commandHostAdapters' in options ? options.commandHostAdapters : undefined;
    const shellExec = 'shellExec' in options ? options.shellExec : undefined;

    this.skillRouter = new SessionSkillRouter(
      commandModules,
      cwd,
      commandHostAdapters,
      () => this as unknown as ICommandHostContext,
      () => this.session?.getSessionId() ?? '',
      (prompt, displayInput, rawInput) => this.submit(prompt, displayInput, rawInput),
      (result) => this.execCtrl.applyForkSkillResult(result),
      (event, appendHistory) => this.histTracker.recordSkillActivationEvent(event, appendHistory),
      (content, forkOptions) => runSkillInFork(content, forkOptions, this.getSessionOrThrow()),
      (skill, args, displayInput, qualifiedName, invocation) =>
        this.execCtrl.executeForkSkillCommand(
          skill,
          args,
          displayInput,
          qualifiedName,
          invocation,
          (p, d, r) => this.submit(p, d, r),
        ),
      (execute) =>
        this.execCtrl.executeForegroundCommand(execute, (p, d, r) => this.submit(p, d, r)),
      shellExec,
    );

    this.execCtrl = new SessionExecutionController(this.histTracker, this.skillRouter, {
      getSession: () => this.session!,
      getSessionOrThrow: () => this.getSessionOrThrow(),
      getCwd: () => this.getCwd(),
      getContextState: () => this.getContextState(),
      getExecutionWorkspaceSnapshot: () => this.getExecutionWorkspaceSnapshot(),
      emit: (event, ...args) =>
        this.emit(
          event as TInteractiveEventName,
          ...(args as Parameters<IInteractiveSessionEvents[TInteractiveEventName]>),
        ),
      persistSession: () => this.persistCurrentSession(),
    });

    if ('providerDefinitions' in options) {
      this.providerDefinitions =
        (options as IInteractiveSessionStandardOptions).providerDefinitions ?? [];
    }
    if ('orgPolicy' in options) {
      this.orgPolicy = (options as IInteractiveSessionStandardOptions).orgPolicy ?? null;
    }

    // GOAL-001: observe turn origin and completion to drive the autonomous goal loop.
    this.on('turn_source', (source) => {
      this.currentTurnSource = source;
    });
    this.on('complete', (result) => this.handleGoalTurnComplete(result));

    const hasInjectedSession = this.configureInjectedSession(options);
    this.restoreSessionRecordIfNeeded(options);
    this.startAsyncInitializationIfNeeded(options, hasInjectedSession);

    if (this.initialized) this.bgTracker.subscribe(this.session!);
    if (this.initialized) this.persistCurrentSession();
    this.resumeGoalIfActive();
  }

  private configureInjectedSession(options: TInteractiveSessionOptions): boolean {
    if (!('session' in options && options.session)) return false;
    this.session = options.session;
    this.autoCompactThresholdSource = 'session';
    this.initialized = true;
    return true;
  }

  private restoreSessionRecordIfNeeded(options: TInteractiveSessionOptions): void {
    if (!options.resumeSessionId || !this.sessionStore) return;
    const restored = loadSessionRecord(this.sessionStore, options.resumeSessionId, this.session);
    this.histTracker.restoreState({
      history: restored.history,
      memoryEvents: restored.memoryEvents,
      usedMemoryReferences: restored.usedMemoryReferences,
      contextReferences: restored.contextReferences,
      skillActivationEvents: restored.skillActivationEvents,
    });
    if (restored.sessionName) this.sessionName = restored.sessionName;
    this.bgTracker.restoreState({
      tasks: restored.backgroundTasks,
      taskEvents: restored.backgroundTaskEvents,
      groups: restored.backgroundJobGroups,
      groupEvents: restored.backgroundJobGroupEvents,
    });
    this.pendingRestoreMessages = restored.pendingRestoreMessages;
    this.sandboxSnapshotId = this.forkSession ? undefined : restored.sandboxSnapshotId;
    // GOAL-001: a fork starts fresh; a true resume restores any in-flight goal so pursuit continues.
    if (!this.forkSession && restored.goal) this.goalController.restore(restored.goal);
    if (this.session && restored.pendingRestoreMessages === null) {
      // Injected-session path: messages were injected immediately — sync context estimate.
      this.session.syncContextFromHistory();
      this.emit('context_update', this.getContextState());
    }
  }

  private startAsyncInitializationIfNeeded(
    options: TInteractiveSessionOptions,
    hasInjectedSession: boolean,
  ): void {
    if (hasInjectedSession) return;
    const stdOpts = options as IInteractiveSessionStandardOptions;
    this.initPromise = this.initializeAsync(stdOpts);
  }

  private async initializeAsync(options: IInteractiveSessionStandardOptions): Promise<void> {
    const result = await initializeInteractiveSessionAsync(options, {
      sandboxSnapshotId: this.sandboxSnapshotId,
      resumeSessionId: this.resumeSessionId,
      pendingRestoreMessages: this.pendingRestoreMessages,
      onTextDelta: (delta) => this.execCtrl.handleTextDelta(delta),
      onContextUpdate: (state) => this.emit('context_update', state),
      onCompactEvent: (event) => this.execCtrl.handleCompactEvent(event),
      onToolExecution: (event) => this.execCtrl.handleToolExecution(event),
      executeModelCommand: (command, args) => this.executeModelCommand(command, args),
      isModelCommandInvocable: (command) =>
        this.skillRouter.commandExecutor.isModelInvocable(command),
      commandDescriptors: this.skillRouter.commandExecutor.listModelInvocableCommands(),
      setEditCheckpointStore: (store) => this.histTracker.setEditCheckpointStore(store),
    });
    this.session = result.session;
    this.agentsFileEntries = result.agentsFileEntries;
    this.claudeFileEntries = result.claudeFileEntries;
    this.rebuildSystemMessage = result.rebuildSystemMessage;
    this.autoCompactThresholdSource = result.autoCompactThresholdSource;
    this.histTracker.recordSystemContextFiles([
      ...result.agentsFileEntries,
      ...result.claudeFileEntries,
    ]);
    this.pendingRestoreMessages = null;
    this.initialized = true;
    this.bgTracker.subscribe(this.session);
    this.persistCurrentSession();
    this.emit('context_update', this.getContextState());
  }

  protected async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.initPromise) await this.initPromise;
  }

  protected getSessionOrThrow(): Session {
    if (!this.session)
      throw new Error('InteractiveSession not initialized. Call submit() or await initialization.');
    return this.session;
  }

  getCwd(): string {
    if (!this.cwd) throw new Error('cwd is not set — provide cwd in session options');
    return this.cwd;
  }

  get sessionId(): string {
    return this.session?.getSessionId() ?? '';
  }

  on<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);
  }

  off<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void {
    this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
  }

  private emit<E extends TInteractiveEventName>(
    event: E,
    ...args: Parameters<IInteractiveSessionEvents[E]>
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) for (const handler of handlers) handler(...args);
  }

  async submit(
    input: string,
    displayInput?: string,
    rawInput?: string,
    options: ITurnOptions = {},
  ): Promise<void> {
    await this.ensureInitialized();
    if (this.execCtrl.shuttingDown) throw new Error('Interactive session is shutting down.');
    if (this.execCtrl.executing) {
      this.execCtrl.pendingPrompt = input;
      this.execCtrl.pendingDisplayInput = displayInput;
      this.execCtrl.pendingRawInput = rawInput;
      this.execCtrl.pendingTurnOptions = options;
      return;
    }
    await this.execCtrl.executePrompt(
      input,
      displayInput,
      rawInput,
      this.agentsFileEntries,
      this.claudeFileEntries,
      this.rebuildSystemMessage,
      (agents, claude) => {
        this.agentsFileEntries = agents;
        this.claudeFileEntries = claude;
        this.histTracker.recordSystemContextFiles([...agents, ...claude]);
      },
      (p, d, r, o) => this.submit(p, d, r, o),
      options,
    );
  }

  /**
   * FLOW-002: re-enter the agent loop with a non-user turn triggered by a background wake
   * (a scheduled fire or, later, a monitor match). Coalesces by source task id so repeated
   * wakes for the same task while one is still in flight collapse to a single turn.
   */
  requestWakeup(instruction: string, sourceTaskId: string): boolean {
    if (this.execCtrl.shuttingDown) return false;
    if (this.execCtrl.wakeTaskIds.has(sourceTaskId)) return false;
    this.execCtrl.wakeTaskIds.add(sourceTaskId);
    void this.submit(instruction, undefined, undefined, {
      turnSource: 'agent-wakeup',
      wakeTaskId: sourceTaskId,
    });
    return true;
  }

  abort(): void {
    this.execCtrl.clearPendingQueue();
    this.session?.abort();
  }

  shutdown(options: IInteractiveSessionShutdownOptions = {}): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.execCtrl.shuttingDown = true;
    this.shutdownPromise = (async () => {
      await this.ensureInitialized();
      this.execCtrl.clearPendingQueue();
      const session = this.session;
      session?.abort();
      await this.getBackgroundTaskManager()?.shutdown(options.message ?? 'Session shutdown');
      this.bgTracker.dispose();
      await this.captureSandboxSnapshot();
      this.persistCurrentSession();
      await session?.shutdown({ reason: options.reason ?? 'other' });
      this.listeners.clear();
    })();
    return this.shutdownPromise;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  getAutoCompactThresholdSource(): TAutoCompactThresholdSource {
    return this.autoCompactThresholdSource;
  }

  getAutoCompactThreshold(): number | false {
    return this.getSessionOrThrow().getAutoCompactThreshold();
  }
  getSession(): Session {
    return this.getSessionOrThrow();
  }

  /**
   * PRESET-014: re-apply a preset persona to the live system prompt. Recomposes the system
   * message from the currently tracked AGENTS.md/CLAUDE.md entries (the same content the staleness
   * refresh uses) plus the new persona, then propagates it to the session. No-op before init,
   * when the rebuild closure is not yet available.
   */
  applyPersona(persona: string): void {
    if (this.rebuildSystemMessage === null) return;
    const currentAgents = this.agentsFileEntries.map((e) => e.content).join('\n\n');
    const currentClaude = this.claudeFileEntries.map((e) => e.content).join('\n\n');
    const msg = this.rebuildSystemMessage(currentAgents, currentClaude, { persona });
    this.getSessionOrThrow().updateSystemMessage(msg);
  }

  /**
   * PRESET-017: toggle the verify-before-done self-verification section on the live system prompt.
   * Recomposes the system message from the currently tracked AGENTS.md/CLAUDE.md entries plus the
   * new selfVerification flag, then propagates it to the session. No-op before init, when the
   * rebuild closure is not yet available.
   */
  applySelfVerification(enabled: boolean): void {
    if (this.rebuildSystemMessage === null) return;
    const currentAgents = this.agentsFileEntries.map((e) => e.content).join('\n\n');
    const currentClaude = this.claudeFileEntries.map((e) => e.content).join('\n\n');
    const msg = this.rebuildSystemMessage(currentAgents, currentClaude, {
      selfVerification: enabled,
    });
    this.getSessionOrThrow().updateSystemMessage(msg);
  }

  /**
   * PRESET-015: re-apply a preset's command-module selection to the live session by delegating to
   * the skill router, which re-filters the session-start module set and rebuilds the executor.
   */
  applyCommandModuleSelection(
    enabled: readonly string[] | undefined,
    disabled: readonly string[] | undefined,
  ): void {
    this.skillRouter.reapplyCommandModuleSelection(enabled, disabled);
  }

  getAgentJobCapability(): IAgentJobHostContext {
    return this;
  }

  setAutoCompactThreshold(
    threshold: TAutoCompactThreshold,
    source: TAutoCompactThresholdSource = 'session',
  ): void {
    this.getSessionOrThrow().setAutoCompactThreshold(threshold);
    this.autoCompactThresholdSource = source;
    this.emit('context_update', this.getContextState());
    this.persistCurrentSession();
  }

  clearConversationHistory(): void {
    this.getSessionOrThrow().clearHistory();
    this.histTracker.clearHistory();
    this.persistCurrentSession();
    this.emit('context_update', this.getContextState());
  }

  getName(): string | undefined {
    return this.sessionName;
  }

  attachTransport(transport: ITransportAdapter<IInteractiveSession>): void {
    transport.attach(this);
  }

  setName(name: string): void {
    this.sessionName = name;
    if (this.sessionStore && this.session) {
      try {
        const id = this.getSessionOrThrow().getSessionId();
        const existing = this.sessionStore.load(id);
        if (existing) {
          existing.name = name;
          existing.updatedAt = new Date().toISOString();
          this.sessionStore.save(existing);
        }
      } catch {
        /* Session not initialized yet */
      }
    }
  }

  private getBackgroundTaskManager(): IBackgroundTaskManager | undefined {
    if (!this.session) return undefined;
    return (
      retrieveSessionBackgroundTaskManager(this.session) ??
      retrieveAgentToolDeps(this.session)?.backgroundTaskManager
    );
  }

  private async captureSandboxSnapshot(): Promise<void> {
    if (!this.sandboxClient?.snapshot) return;
    try {
      this.sandboxSnapshotId = await this.sandboxClient.snapshot();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.histTracker.append(
        messageToHistoryEntry(createSystemMessage(`Sandbox snapshot error: ${err.message}`)),
      );
      this.emit('error', err);
    }
  }

  private persistCurrentSession(): void {
    if (!this.sessionStore || !this.session) return;
    const bgState = this.bgTracker.getState();
    const histState = this.histTracker.getState();
    persistSession(
      this.sessionStore,
      this.session,
      this.sessionName,
      this.cwd ?? '',
      histState.history,
      {
        tasks: bgState.tasks,
        events: bgState.taskEvents,
        groups: bgState.groups,
        groupEvents: bgState.groupEvents,
      },
      { events: histState.memoryEvents, usedReferences: histState.usedMemoryReferences },
      { events: histState.skillActivationEvents },
      { references: histState.contextReferences },
      { snapshotId: this.sandboxSnapshotId },
      this.goalController.getState() ?? undefined,
    );
  }

  /**
   * GOAL-001: assign an autonomous goal and begin pursuing it. The agent takes follow-up turns
   * on its own until it signals the goal satisfied or a bound fires (max iterations, no-progress,
   * or {@link cancelGoal}). Returns the seeded goal state. Throws on an empty objective.
   */
  async setGoal(objective: string, options: IGoalStartOptions = {}): Promise<IGoalState> {
    await this.ensureInitialized();
    const { goal, prompt } = this.goalController.start(objective, options);
    this.emit('goal_event', { type: 'goal_started', goal });
    this.persistCurrentSession();
    this.scheduleGoalTurn(prompt, goal);
    return goal;
  }

  /** GOAL-001: the current goal state, or `null` when no goal has been set. */
  getGoalState(): IGoalState | null {
    return this.goalController.getState();
  }

  /** GOAL-001: cancel an in-flight goal. Returns the stopped state, or `null` when none is active. */
  cancelGoal(): IGoalState | null {
    const stopped = this.goalController.cancel();
    if (stopped) {
      this.emit('goal_event', { type: 'goal_stopped', goal: stopped });
      this.persistCurrentSession();
    }
    return stopped;
  }

  /** GOAL-001: schedule the next goal-driven turn via the FLOW-002 wakeup primitive. */
  private scheduleGoalTurn(prompt: string, goal: IGoalState): void {
    if (this.execCtrl.shuttingDown) return;
    const wakeId = `goal:${goal.id}:${goal.iterations}`;
    // Defer past the current turn's finalization so the wakeup is not coalesced away and the
    // just-completed turn's bookkeeping (executing flag, wake ids) has settled.
    setTimeout(() => this.requestWakeup(prompt, wakeId), 0);
  }

  /** GOAL-001: advance the goal loop after an agent-driven turn completes. */
  private handleGoalTurnComplete(result: IExecutionResult): void {
    if (!this.goalController.isActive()) return;
    // Only agent-driven turns advance the goal; a user's own message is not a goal iteration.
    if (this.currentTurnSource !== 'agent-wakeup') return;
    const decision = this.goalController.onTurnComplete(result);
    if (!decision) return;
    this.persistCurrentSession();
    if (decision.action === 'continue') {
      this.emit('goal_event', { type: 'goal_progress', goal: decision.goal });
      this.scheduleGoalTurn(decision.prompt, decision.goal);
    } else {
      this.emit('goal_event', { type: 'goal_stopped', goal: decision.goal });
    }
  }

  /** GOAL-001: after a resume, continue pursuing a restored active goal once initialized. */
  private resumeGoalIfActive(): void {
    const goal = this.goalController.getState();
    if (!goal || goal.status !== 'active') return;
    void this.ensureInitialized().then(() => {
      if (!this.goalController.isActive() || this.execCtrl.shuttingDown) return;
      this.scheduleGoalTurn(buildGoalContinuationPrompt(goal), goal);
    });
  }

  private async switchProvider(profileName: string): Promise<void> {
    const session = this.getSessionOrThrow();
    const cwd = this.getCwd();
    const settings = readProviderSettings(cwd, {
      providerOverride: profileName,
      providerDefinitions: this.providerDefinitions,
    });
    const provider = createProviderFromSettings(cwd, undefined, {
      providerOverride: profileName,
      providerDefinitions: this.providerDefinitions,
    });
    session.swapProvider(provider, settings.model);
  }

  override async executeCommand(
    name: string,
    args: string,
  ): Promise<import('../commands/index.js').ICommandResult | null> {
    if (this.orgPolicy?.blockedCommands?.includes(name)) {
      return {
        message: formatOrgPolicyViolationMessage(
          `Command /${name} is blocked by your organization policy.`,
          this.orgPolicy.adminContact,
        ),
        success: false,
      };
    }
    const result = await super.executeCommand(name, args);
    if (result === null) return null;
    const hotSwapEffect = result.effects?.find(
      (e): e is { type: 'provider-hot-swap-requested'; profileName: string } =>
        e.type === 'provider-hot-swap-requested',
    );
    if (hotSwapEffect) {
      const { orgPolicy } = this;
      if (
        orgPolicy?.allowedProviders &&
        !orgPolicy.allowedProviders.includes(hotSwapEffect.profileName)
      ) {
        return {
          message: formatOrgPolicyViolationMessage(
            `Provider "${hotSwapEffect.profileName}" is not allowed by your organization policy. Allowed: ${orgPolicy.allowedProviders.join(', ')}.`,
            orgPolicy.adminContact,
          ),
          success: false,
        };
      }
      await this.switchProvider(hotSwapEffect.profileName);
      return {
        ...result,
        effects: result.effects?.filter((e) => e.type !== 'provider-hot-swap-requested'),
      };
    }
    return result;
  }
}
