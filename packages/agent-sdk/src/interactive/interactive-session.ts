/**
 * InteractiveSession — thin coordinator for all SDK consumers.
 * Extends InteractiveSessionBase for delegating public methods.
 * Manages initialization, core execution, lifecycle, and session state.
 */

import type { Session } from '@robota-sdk/agent-sessions';
import type { ISession } from '@robota-sdk/agent-core';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type { TUniversalMessage, TSessionEndReason } from '@robota-sdk/agent-core';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import type { TAutoCompactThresholdSource, TAutoCompactThreshold } from '../commands/index.js';
import { runSkillInFork } from './interactive-session-fork.js';
import type { TInteractiveEventName, IInteractiveSessionEvents } from './types.js';
import type { IBackgroundTaskManager } from '../background-tasks/index.js';
import { retrieveSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';
import { persistSession } from './interactive-session-persistence.js';
import { loadSessionRecord } from './interactive-session-restore.js';
import { initializeInteractiveSessionAsync } from './interactive-session-init.js';
import type { ICreatedInteractiveSession } from './interactive-session-init.js';
import type {
  IInteractiveSessionOptions,
  IInteractiveSessionStandardOptions,
} from './interactive-session-options.js';
import type { IInteractiveSessionStore } from './session-persistence.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import type { ISandboxClient } from '@robota-sdk/agent-tools';
import { SessionBackgroundTaskTracker } from './interactive-session-background-tracker.js';
import { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import { SessionSkillRouter } from './interactive-session-skill-router.js';
import { SessionExecutionController } from './interactive-session-execution-controller.js';
import { InteractiveSessionBase } from './interactive-session-base.js';
export type { IInteractiveSessionOptions } from './interactive-session-options.js';

export interface IInteractiveSessionShutdownOptions {
  reason?: TSessionEndReason;
  message?: string;
}

export class InteractiveSession extends InteractiveSessionBase implements ISession {
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
  protected readonly bgTracker: SessionBackgroundTaskTracker;
  protected readonly histTracker: SessionHistoryTracker;
  protected readonly skillRouter: SessionSkillRouter;
  protected readonly execCtrl: SessionExecutionController;

  constructor(options: IInteractiveSessionOptions) {
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
    );

    this.histTracker = new SessionHistoryTracker(
      cwd,
      () => this.getSessionOrThrow().getSessionId(),
      () => this.execCtrl.executing,
      () => this.persistCurrentSession(),
      (event) => this.emit('skill_activation', event),
      initCheckpointStore,
    );

    const commandModules = [...('commandModules' in options ? (options.commandModules ?? []) : [])];
    const commandHostAdapters =
      'commandHostAdapters' in options ? options.commandHostAdapters : undefined;

    this.skillRouter = new SessionSkillRouter(
      commandModules,
      cwd,
      commandHostAdapters,
      () => this as unknown as import('../command-api/index.js').ICommandHostContext,
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

    const hasInjectedSession = this.configureInjectedSession(options);
    this.restoreSessionRecordIfNeeded(options);
    this.startAsyncInitializationIfNeeded(options, hasInjectedSession);

    if (this.initialized) this.bgTracker.subscribe(this.session!);
    if (this.initialized) this.persistCurrentSession();
  }

  private configureInjectedSession(options: IInteractiveSessionOptions): boolean {
    if (!('session' in options && options.session)) return false;
    this.session = options.session;
    this.autoCompactThresholdSource = 'session';
    this.initialized = true;
    return true;
  }

  private restoreSessionRecordIfNeeded(options: IInteractiveSessionOptions): void {
    if (!options.resumeSessionId || !this.sessionStore) return;
    const restored = loadSessionRecord(
      this.sessionStore,
      options.resumeSessionId,
      this.forkSession,
      this.session,
    );
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
  }

  private startAsyncInitializationIfNeeded(
    options: IInteractiveSessionOptions,
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
    this.pendingRestoreMessages = null;
    this.initialized = true;
    this.bgTracker.subscribe(this.session);
    this.persistCurrentSession();
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
    return this.cwd ?? process.cwd();
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

  async submit(input: string, displayInput?: string, rawInput?: string): Promise<void> {
    await this.ensureInitialized();
    if (this.execCtrl.shuttingDown) throw new Error('Interactive session is shutting down.');
    if (this.execCtrl.executing) {
      this.execCtrl.pendingPrompt = input;
      this.execCtrl.pendingDisplayInput = displayInput;
      this.execCtrl.pendingRawInput = rawInput;
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
      },
      (p, d, r) => this.submit(p, d, r),
    );
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

  attachTransport(transport: ITransportAdapter): void {
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
    );
  }
}
