/**
 * InteractiveSession — the single entry point for all SDK consumers.
 *
 * Wraps Session (composition). Manages streaming text accumulation,
 * tool execution state tracking, prompt queuing, abort orchestration,
 * message history, and system command execution.
 *
 * Config/context loading is internal. Consumer provides cwd + provider.
 */

import type { Session } from '@robota-sdk/agent-sessions';
import type { SessionStore } from '@robota-sdk/agent-sessions';
import type {
  TUniversalMessage,
  IContextWindowState,
  IHistoryEntry,
  TSessionEndReason,
} from '@robota-sdk/agent-core';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';
import type {
  ICommand,
  ICommandModule,
  ISkillExecutionResult,
  IForkExecutionOptions,
} from '../commands/index.js';
import { executeSkill } from '../commands/index.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';
import { getBuiltInAgent } from '../agents/built-in-agents.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';
import { SystemCommandExecutor, createSystemCommands } from '../commands/system-command.js';
import type {
  IToolState,
  TInteractiveEventName,
  IInteractiveSessionEvents,
  ITransportAdapter,
} from './types.js';
import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskManager,
  IBackgroundTaskState,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
  TBackgroundTaskIsolation,
} from '../background-tasks/index.js';
import { BackgroundJobOrchestrator } from '../background-tasks/index.js';
import type {
  ISubagentJobResult,
  ISubagentJobState,
  ISubagentManager,
} from '../subagents/index.js';
import { retrieveSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';
import {
  isAbortError,
  buildResult,
  buildInterruptedResult,
  persistSession,
} from './interactive-session-execution.js';
import {
  STREAMING_FLUSH_INTERVAL_MS,
  pushToolSummaryToHistory,
  applyToolStart,
  applyToolEnd,
} from './interactive-session-streaming.js';
import { loadConfig } from '../config/config-loader.js';
import {
  createInteractiveSession,
  injectSavedMessage,
  loadSessionRecord,
} from './interactive-session-init.js';
import type {
  IInteractiveSessionOptions,
  IInteractiveSessionStandardOptions,
} from './interactive-session-init.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import type {
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../checkpoints/edit-checkpoint-types.js';
export type { IInteractiveSessionOptions } from './interactive-session-init.js';

export interface IInteractiveSessionShutdownOptions {
  reason?: TSessionEndReason;
  message?: string;
}

export class InteractiveSession {
  private session: Session | null = null;
  private readonly commandExecutor: SystemCommandExecutor;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private streamingText = '';
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private activeTools: IToolState[] = [];
  private executing = false;
  private pendingPrompt: string | null = null;
  private pendingDisplayInput: string | undefined;
  private pendingRawInput: string | undefined;
  private history: IHistoryEntry[] = [];
  private sessionStore?: SessionStore;
  private sessionName?: string;
  private cwd?: string;
  private pendingRestoreMessages: unknown[] | null = null;
  private backgroundTasks: IBackgroundTaskState[] = [];
  private backgroundTaskEvents: TBackgroundTaskEvent[] = [];
  private backgroundJobGroups: IBackgroundJobGroupState[] = [];
  private backgroundJobGroupEvents: TBackgroundJobGroupEvent[] = [];
  private memoryEvents: IMemoryEvent[] = [];
  private usedMemoryReferences: IMemoryReference[] = [];
  private editCheckpointStore: EditCheckpointStore | null = null;
  private resumeSessionId?: string;
  private forkSession: boolean;
  private backgroundTaskUnsubscribe: (() => void) | null = null;
  private backgroundJobUnsubscribe: (() => void) | null = null;
  private backgroundJobOrchestrator: BackgroundJobOrchestrator | null = null;
  private readonly commandModules: readonly ICommandModule[];
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(options: IInteractiveSessionOptions) {
    this.commandModules = 'commandModules' in options ? (options.commandModules ?? []) : [];
    this.commandExecutor = new SystemCommandExecutor([
      ...createSystemCommands(),
      ...this.commandModules.flatMap((module) => module.systemCommands ?? []),
    ]);
    this.sessionStore = options.sessionStore;
    this.sessionName = options.sessionName;
    this.cwd = ('cwd' in options ? options.cwd : undefined) ?? '';
    if ('session' in options && options.session && this.cwd) {
      this.editCheckpointStore = new EditCheckpointStore({ cwd: this.cwd });
    }
    this.resumeSessionId = options.resumeSessionId;
    this.forkSession = options.forkSession ?? false;

    if ('session' in options && options.session) {
      this.session = options.session;
      this.initialized = true;
    } else {
      const stdOpts = options as IInteractiveSessionStandardOptions;
      this.initPromise = this.initializeAsync(stdOpts);
    }

    if (options.resumeSessionId && this.sessionStore) {
      const restored = loadSessionRecord(
        this.sessionStore,
        options.resumeSessionId,
        this.forkSession,
        this.session,
      );
      if (restored.history.length > 0) this.history = restored.history;
      if (restored.sessionName) this.sessionName = restored.sessionName;
      this.backgroundTasks = restored.backgroundTasks;
      this.backgroundTaskEvents = restored.backgroundTaskEvents;
      this.backgroundJobGroups = restored.backgroundJobGroups;
      this.backgroundJobGroupEvents = restored.backgroundJobGroupEvents;
      this.memoryEvents = restored.memoryEvents;
      this.usedMemoryReferences = restored.usedMemoryReferences;
      this.pendingRestoreMessages = restored.pendingRestoreMessages;
    }

    if (this.initialized) this.subscribeBackgroundTaskEvents();
    if (this.initialized) this.persistCurrentSession();
  }

  private async initializeAsync(options: IInteractiveSessionStandardOptions): Promise<void> {
    const config = await loadConfig(options.cwd);
    this.editCheckpointStore = new EditCheckpointStore({ cwd: options.cwd });
    this.session = await createInteractiveSession({
      cwd: options.cwd,
      provider: options.provider,
      config,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      permissionHandler: options.permissionHandler,
      resumeSessionId: this.resumeSessionId,
      forkSession: this.forkSession,
      onTextDelta: (delta: string) => this.handleTextDelta(delta),
      onToolExecution: (event) => this.handleToolExecution(event),
      bare: options.bare,
      allowedTools: options.allowedTools,
      appendSystemPrompt: options.appendSystemPrompt,
      backgroundTaskRunners: options.backgroundTaskRunners,
      subagentRunnerFactory: options.subagentRunnerFactory,
      ...(options.commandModules ? { commandModules: options.commandModules } : {}),
      editCheckpointRecorder: this.editCheckpointStore,
      commandDescriptors: this.commandExecutor.listModelInvocableCommands(),
      ...(this.commandExecutor.listModelInvocableCommands().length > 0
        ? {
            modelCommandExecutor: (command, args) => this.executeModelCommand(command, args),
            isModelCommandInvocable: (command) => this.commandExecutor.isModelInvocable(command),
          }
        : {}),
    });

    if (this.pendingRestoreMessages) {
      for (const msg of this.pendingRestoreMessages) injectSavedMessage(this.session, msg);
      this.pendingRestoreMessages = null;
    }
    this.initialized = true;
    this.subscribeBackgroundTaskEvents();
    this.persistCurrentSession();
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.initPromise) await this.initPromise;
  }

  private getSessionOrThrow(): Session {
    if (!this.session)
      throw new Error('InteractiveSession not initialized. Call submit() or await initialization.');
    return this.session;
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
    if (this.shuttingDown) throw new Error('Interactive session is shutting down.');
    if (this.executing) {
      this.pendingPrompt = input;
      this.pendingDisplayInput = displayInput;
      this.pendingRawInput = rawInput;
      return;
    }
    await this.executePrompt(input, displayInput, rawInput);
  }

  async executeCommand(
    name: string,
    args: string,
  ): Promise<{ message: string; success: boolean; data?: Record<string, unknown> } | null> {
    await this.ensureInitialized();
    return this.commandExecutor.execute(name, this, args);
  }

  async executeModelCommand(
    name: string,
    args: string,
  ): Promise<{ message: string; success: boolean; data?: Record<string, unknown> } | null> {
    await this.ensureInitialized();
    return this.commandExecutor.executeModelInvocable(name, this, args);
  }

  async executeSkillCommand(
    skill: ICommand,
    args: string,
    displayInput?: string,
    rawInput?: string,
  ): Promise<ISkillExecutionResult> {
    await this.ensureInitialized();

    if (skill.context === 'fork') {
      return this.executeForkSkillCommand(skill, args, displayInput);
    }

    const result = await executeSkill(
      skill,
      args,
      {
        runInFork: (content, options) => this.runSkillInFork(content, options),
      },
      { sessionId: this.getSessionOrThrow().getSessionId() },
    );

    if (result.mode === 'inject') {
      if (result.prompt) {
        await this.submit(result.prompt, displayInput, rawInput);
      }
      return result;
    }

    await this.applyForkSkillResult(result.result ?? '(empty response)');
    return result;
  }

  listCommands(): Array<{ name: string; description: string }> {
    return this.commandExecutor.listCommands().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }

  listModelInvocableCommands(): Array<{ name: string; description: string }> {
    return this.commandExecutor.listModelInvocableCommands().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }

  abort(): void {
    this.clearPendingQueue();
    this.session?.abort();
  }

  shutdown(options: IInteractiveSessionShutdownOptions = {}): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shuttingDown = true;
    this.shutdownPromise = (async () => {
      await this.ensureInitialized();
      this.clearPendingQueue();
      const session = this.session;
      session?.abort();
      await this.getBackgroundTaskManager()?.shutdown(options.message ?? 'Session shutdown');
      this.backgroundTaskUnsubscribe?.();
      this.backgroundTaskUnsubscribe = null;
      this.backgroundJobUnsubscribe?.();
      this.backgroundJobUnsubscribe = null;
      this.backgroundJobOrchestrator?.dispose();
      this.backgroundJobOrchestrator = null;
      this.persistCurrentSession();
      await session?.shutdown({ reason: options.reason ?? 'other' });
    })();
    return this.shutdownPromise;
  }

  cancelQueue(): void {
    this.clearPendingQueue();
  }

  private clearPendingQueue(): void {
    this.pendingPrompt = null;
    this.pendingDisplayInput = undefined;
    this.pendingRawInput = undefined;
  }

  isExecuting(): boolean {
    return this.executing;
  }
  getPendingPrompt(): string | null {
    return this.pendingPrompt;
  }
  getFullHistory(): IHistoryEntry[] {
    return this.history;
  }
  getMessages(): TUniversalMessage[] {
    return this.history
      .filter((e) => e.category === 'chat')
      .map((e) => e.data as TUniversalMessage);
  }
  getStreamingText(): string {
    return this.streamingText;
  }
  getActiveTools(): IToolState[] {
    return this.activeTools;
  }
  getContextState(): IContextWindowState {
    return this.getSessionOrThrow().getContextState();
  }
  getName(): string | undefined {
    return this.sessionName;
  }
  getCwd(): string {
    return this.cwd ?? process.cwd();
  }
  getSession(): Session {
    return this.getSessionOrThrow();
  }

  listEditCheckpoints(): IEditCheckpointSummary[] {
    const sessionId = this.getSessionOrThrow().getSessionId();
    return this.getEditCheckpointStore().list(sessionId);
  }

  async restoreEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult> {
    await this.ensureInitialized();
    if (this.executing) {
      throw new Error('Cannot restore edit checkpoint while a prompt is running.');
    }
    const result = await this.getEditCheckpointStore().restoreToCheckpoint(
      this.getSessionOrThrow().getSessionId(),
      checkpointId,
    );
    this.history.push(
      messageToHistoryEntry(createSystemMessage(`Restored edit checkpoint: ${checkpointId}`)),
    );
    this.persistCurrentSession();
    return result;
  }

  getUsedMemoryReferences(): IMemoryReference[] {
    return [...this.usedMemoryReferences];
  }

  recordMemoryEvent(event: IMemoryEvent): void {
    this.memoryEvents.push(event);
    this.persistCurrentSession();
  }

  listBackgroundTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[] {
    return this.getBackgroundTaskManagerOrThrow().list(filter);
  }

  getBackgroundTask(taskId: string): IBackgroundTaskState | undefined {
    return this.getBackgroundTaskManagerOrThrow().get(taskId);
  }

  async cancelBackgroundTask(taskId: string, reason?: string): Promise<void> {
    await this.ensureInitialized();
    await this.getBackgroundTaskManagerOrThrow().cancel(taskId, reason);
  }

  async closeBackgroundTask(taskId: string): Promise<void> {
    await this.ensureInitialized();
    await this.getBackgroundTaskManagerOrThrow().close(taskId);
  }

  async sendBackgroundTask(taskId: string, input: IBackgroundTaskInput): Promise<void> {
    await this.ensureInitialized();
    await this.getBackgroundTaskManagerOrThrow().send(taskId, input);
  }

  async readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage> {
    await this.ensureInitialized();
    return this.getBackgroundTaskManagerOrThrow().readLog(taskId, cursor);
  }

  createBackgroundJobGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
  ): IBackgroundJobGroupState {
    const orchestrator = this.getBackgroundJobOrchestratorOrThrow();
    return orchestrator.createGroup({
      ...input,
      parentSessionId: this.getSessionOrThrow().getSessionId(),
    });
  }

  listBackgroundJobGroups(): IBackgroundJobGroupState[] {
    return this.getBackgroundJobOrchestratorOrThrow().listGroups();
  }

  getBackgroundJobGroup(groupId: string): IBackgroundJobGroupState | undefined {
    return this.getBackgroundJobOrchestratorOrThrow().getGroup(groupId);
  }

  async waitBackgroundJobGroup(groupId: string): Promise<IBackgroundJobGroupState> {
    await this.ensureInitialized();
    return this.getBackgroundJobOrchestratorOrThrow().waitGroup(groupId);
  }

  listAgentDefinitions(): Array<{ name: string; description: string }> {
    const deps = retrieveAgentToolDeps(this.getSessionOrThrow());
    return (deps?.agentDefinitions ?? []).map((agent) => ({
      name: agent.name,
      description: agent.description,
    }));
  }

  listAgentJobs(): ISubagentJobState[] {
    return this.getSubagentManagerOrThrow().list();
  }

  async spawnAgentJob(input: {
    agentType: string;
    label: string;
    mode: 'foreground' | 'background';
    prompt: string;
    model?: string;
    isolation?: TBackgroundTaskIsolation;
  }): Promise<ISubagentJobState> {
    await this.ensureInitialized();
    const deps = this.getAgentToolDepsOrThrow();
    const definition = this.resolveAgentDefinition(input.agentType, deps);
    return this.getSubagentManagerOrThrow().spawn({
      type: input.agentType,
      label: input.label,
      parentSessionId: this.getSessionOrThrow().getSessionId(),
      mode: input.mode,
      depth: (deps.subagentDepth ?? 0) + 1,
      cwd: deps.cwd ?? this.cwd ?? process.cwd(),
      prompt: input.prompt,
      model: input.model ?? definition.model,
      isolation: input.isolation,
      allowedTools: definition.tools,
      disallowedTools: definition.disallowedTools,
    });
  }

  async waitAgentJob(jobId: string): Promise<ISubagentJobResult> {
    await this.ensureInitialized();
    return this.getSubagentManagerOrThrow().wait(jobId);
  }

  async sendAgentJob(jobId: string, prompt: string): Promise<void> {
    await this.ensureInitialized();
    await this.getSubagentManagerOrThrow().send(jobId, prompt);
  }

  async cancelAgentJob(jobId: string, reason?: string): Promise<void> {
    await this.ensureInitialized();
    await this.getSubagentManagerOrThrow().cancel(jobId, reason);
  }

  async closeAgentJob(jobId: string): Promise<void> {
    await this.ensureInitialized();
    await this.getSubagentManagerOrThrow().close(jobId);
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

  attachTransport(transport: ITransportAdapter): void {
    transport.attach(this);
  }

  private async executeForkSkillCommand(
    skill: ICommand,
    args: string,
    displayInput?: string,
  ): Promise<ISkillExecutionResult> {
    if (this.executing) {
      throw new Error('Cannot execute fork skill while another prompt is running.');
    }

    this.startForkSkillExecution(displayInput ?? `/${skill.name}`);

    try {
      const result = await executeSkill(
        skill,
        args,
        { runInFork: (content, options) => this.runSkillInFork(content, options) },
        { sessionId: this.getSessionOrThrow().getSessionId() },
      );
      await this.applyForkSkillResult(result.result ?? '(empty response)');
      return result;
    } catch (err) {
      this.recordForkSkillError(err instanceof Error ? err : new Error(String(err)));
      return { mode: 'fork', result: '' };
    } finally {
      this.finishForkSkillExecution();
    }
  }

  private getBackgroundTaskManagerOrThrow(): IBackgroundTaskManager {
    const manager = this.getBackgroundTaskManager();
    if (!manager) {
      throw new Error('Background task manager is not available for this session.');
    }
    return manager;
  }

  private getBackgroundTaskManager(): IBackgroundTaskManager | undefined {
    if (!this.session) return undefined;
    return (
      retrieveSessionBackgroundTaskManager(this.session) ??
      retrieveAgentToolDeps(this.session)?.backgroundTaskManager
    );
  }

  private getBackgroundJobOrchestratorOrThrow(): BackgroundJobOrchestrator {
    if (this.backgroundJobOrchestrator) return this.backgroundJobOrchestrator;
    const manager = this.getBackgroundTaskManagerOrThrow();
    this.backgroundJobOrchestrator = new BackgroundJobOrchestrator({
      manager,
      initialGroups: this.backgroundJobGroups,
    });
    this.subscribeBackgroundJobGroupEvents();
    return this.backgroundJobOrchestrator;
  }

  private getAgentToolDepsOrThrow(): NonNullable<ReturnType<typeof retrieveAgentToolDeps>> {
    const deps = retrieveAgentToolDeps(this.getSessionOrThrow());
    if (!deps) {
      throw new Error('Agent runtime dependencies are not available for this session.');
    }
    if (!deps.backgroundTaskManager) {
      throw new Error('Background task manager is not available for this session.');
    }
    return deps;
  }

  private getSubagentManagerOrThrow(): ISubagentManager {
    const deps = this.getAgentToolDepsOrThrow();
    if (!deps.subagentManager) {
      throw new Error('Subagent manager is not available for this session.');
    }
    return deps.subagentManager;
  }

  private resolveAgentDefinition(
    agentType: string,
    deps: NonNullable<ReturnType<typeof retrieveAgentToolDeps>>,
  ): IAgentDefinition {
    const definition = deps.customAgentRegistry?.(agentType);
    if (!definition) {
      throw new Error(`Unknown agent type: ${agentType}`);
    }
    return definition;
  }

  private subscribeBackgroundTaskEvents(): void {
    if (this.backgroundTaskUnsubscribe || !this.session) return;
    const manager =
      retrieveSessionBackgroundTaskManager(this.session) ??
      retrieveAgentToolDeps(this.session)?.backgroundTaskManager;
    if (!manager) return;
    this.backgroundTaskUnsubscribe = manager.subscribe((event) => {
      this.recordBackgroundTaskEvent(event);
      this.emit('background_task_event', event);
    });
  }

  private subscribeBackgroundJobGroupEvents(): void {
    if (this.backgroundJobUnsubscribe || !this.backgroundJobOrchestrator) return;
    this.backgroundJobUnsubscribe = this.backgroundJobOrchestrator.subscribe((event) => {
      this.recordBackgroundJobGroupEvent(event);
      this.emit('background_job_group_event', event);
    });
  }

  private recordBackgroundTaskEvent(event: TBackgroundTaskEvent): void {
    this.backgroundTasks = this.getBackgroundTaskSnapshots();
    this.backgroundTaskEvents.push(event);
    this.persistCurrentSession();
  }

  private recordBackgroundJobGroupEvent(event: TBackgroundJobGroupEvent): void {
    this.backgroundJobGroups = this.getBackgroundJobGroupSnapshots();
    this.backgroundJobGroupEvents.push(event);
    this.persistCurrentSession();
  }

  private getBackgroundTaskSnapshots(): IBackgroundTaskState[] {
    try {
      return this.getBackgroundTaskManagerOrThrow().list();
    } catch {
      return this.backgroundTasks;
    }
  }

  private getBackgroundJobGroupSnapshots(): IBackgroundJobGroupState[] {
    try {
      return this.backgroundJobOrchestrator?.listGroups() ?? this.backgroundJobGroups;
    } catch {
      return this.backgroundJobGroups;
    }
  }

  private persistCurrentSession(): void {
    if (!this.sessionStore || !this.session) return;
    this.backgroundTasks = this.getBackgroundTaskSnapshots();
    this.backgroundJobGroups = this.getBackgroundJobGroupSnapshots();
    persistSession(
      this.sessionStore,
      this.session,
      this.sessionName,
      this.cwd ?? '',
      this.history,
      {
        tasks: this.backgroundTasks,
        events: this.backgroundTaskEvents,
        groups: this.backgroundJobGroups,
        groupEvents: this.backgroundJobGroupEvents,
      },
      {
        events: this.memoryEvents,
        usedReferences: this.usedMemoryReferences,
      },
    );
  }

  private startForkSkillExecution(displayInput: string): void {
    this.executing = true;
    this.clearStreaming();
    this.emit('thinking', true);
    this.history.push(messageToHistoryEntry(createUserMessage(displayInput)));
  }

  private finishForkSkillExecution(): void {
    this.executing = false;
    this.emit('thinking', false);
    this.persistCurrentSession();
    if (!this.shuttingDown && this.pendingPrompt) {
      const queued = this.pendingPrompt;
      const queuedDisplay = this.pendingDisplayInput;
      const queuedRaw = this.pendingRawInput;
      this.clearPendingQueue();
      setTimeout(() => this.executePrompt(queued, queuedDisplay, queuedRaw), 0);
    }
  }

  private recordForkSkillError(err: Error): void {
    this.history.push(messageToHistoryEntry(createSystemMessage(`Error: ${err.message}`)));
    this.emit('error', err);
  }

  private resolveForkAgentDefinition(
    agentType: string,
    options: IForkExecutionOptions,
  ): IAgentDefinition {
    const deps = retrieveAgentToolDeps(this.getSessionOrThrow());
    const definition = deps?.customAgentRegistry?.(agentType) ?? getBuiltInAgent(agentType);
    if (!definition) {
      throw new Error(`Unknown agent type: ${agentType}`);
    }
    if (options.allowedTools) {
      return { ...definition, tools: options.allowedTools };
    }
    return definition;
  }

  private async runSkillInFork(content: string, options: IForkExecutionOptions): Promise<string> {
    const parentSession = this.getSessionOrThrow();
    const deps = retrieveAgentToolDeps(parentSession);
    if (!deps) {
      throw new Error('Fork execution is not available. Agent tool deps may not be initialized.');
    }
    const agentType = options.agent ?? 'general-purpose';
    const agentDefinition = this.resolveForkAgentDefinition(agentType, options);
    const forkSession = createSubagentSession({
      agentDefinition,
      parentConfig: deps.config,
      parentContext: deps.context,
      parentTools: deps.tools,
      provider: deps.provider,
      terminal: deps.terminal,
      isForkWorker: true,
      permissionMode: deps.permissionMode,
      permissionHandler: deps.permissionHandler,
      hooks: deps.hooks,
      hookTypeExecutors: deps.hookTypeExecutors,
      onTextDelta: deps.onTextDelta,
      onToolExecution: deps.onToolExecution,
    });
    return forkSession.run(content);
  }

  private async applyForkSkillResult(result: string): Promise<void> {
    this.flushStreaming();
    pushToolSummaryToHistory({ activeTools: this.activeTools, history: this.history });
    this.clearStreaming();
    const executionResult = {
      response: result,
      history: this.history,
      toolSummaries: [],
      contextState: this.getContextState(),
    };
    this.history.push(messageToHistoryEntry(createAssistantMessage(result)));
    this.emit('complete', executionResult);
    this.emit('context_update', this.getContextState());
  }

  private async executePrompt(
    input: string,
    displayInput?: string,
    rawInput?: string,
  ): Promise<void> {
    this.executing = true;
    this.clearStreaming();
    this.emit('thinking', true);
    this.history.push(messageToHistoryEntry(createUserMessage(displayInput ?? input)));

    const historyBefore = this.getSessionOrThrow().getHistory().length;
    this.usedMemoryReferences = [];

    try {
      await this.beginEditCheckpointTurn(displayInput ?? input);
      const response = await this.getSessionOrThrow().run(input, rawInput);
      this.flushStreaming();
      pushToolSummaryToHistory({ activeTools: this.activeTools, history: this.history });
      this.clearStreaming();
      const result = buildResult(
        response || '(empty response)',
        this.getSessionOrThrow().getHistory(),
        this.history,
        historyBefore,
        this.getContextState(),
      );
      this.history.push(messageToHistoryEntry(createAssistantMessage(result.response)));
      this.emit('complete', result);
      this.emit('context_update', this.getContextState());
    } catch (err) {
      this.flushStreaming();
      if (isAbortError(err)) {
        const result = buildInterruptedResult(
          this.getSessionOrThrow().getHistory(),
          this.history,
          historyBefore,
          this.getContextState(),
        );
        pushToolSummaryToHistory({ activeTools: this.activeTools, history: this.history });
        this.clearStreaming();
        if (result.response)
          this.history.push(messageToHistoryEntry(createAssistantMessage(result.response)));
        this.history.push(messageToHistoryEntry(createSystemMessage('Interrupted by user.')));
        this.emit('interrupted', result);
      } else {
        pushToolSummaryToHistory({ activeTools: this.activeTools, history: this.history });
        this.clearStreaming();
        const errMsg = err instanceof Error ? err.message : String(err);
        this.history.push(messageToHistoryEntry(createSystemMessage(`Error: ${errMsg}`)));
        this.emit('error', err instanceof Error ? err : new Error(errMsg));
      }
    } finally {
      await this.finalizeEditCheckpointTurn();
      this.executing = false;
      this.emit('thinking', false);
      this.persistCurrentSession();
      if (!this.shuttingDown && this.pendingPrompt) {
        const queued = this.pendingPrompt;
        const queuedDisplay = this.pendingDisplayInput;
        const queuedRaw = this.pendingRawInput;
        this.clearPendingQueue();
        setTimeout(() => this.executePrompt(queued, queuedDisplay, queuedRaw), 0);
      }
    }
  }

  private getEditCheckpointStore(): EditCheckpointStore {
    if (!this.editCheckpointStore) {
      this.editCheckpointStore = new EditCheckpointStore({ cwd: this.getCwd() });
    }
    return this.editCheckpointStore;
  }

  private async beginEditCheckpointTurn(prompt: string): Promise<void> {
    if (!this.editCheckpointStore) return;
    await this.editCheckpointStore.beginTurn({
      sessionId: this.getSessionOrThrow().getSessionId(),
      prompt,
    });
  }

  private async finalizeEditCheckpointTurn(): Promise<void> {
    if (!this.editCheckpointStore) return;
    try {
      await this.editCheckpointStore.finalizeTurn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.history.push(
        messageToHistoryEntry(createSystemMessage(`Checkpoint error: ${err.message}`)),
      );
      this.emit('error', err);
    }
  }

  private handleTextDelta(delta: string): void {
    this.streamingText += delta;
    this.emit('text_delta', delta);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
      }, STREAMING_FLUSH_INTERVAL_MS);
    }
  }

  private handleToolExecution(event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: Record<string, unknown>;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
  }): void {
    const streamingState = { activeTools: this.activeTools, history: this.history };
    if (event.type === 'start') {
      const toolState = applyToolStart(streamingState, event);
      this.activeTools = streamingState.activeTools;
      this.emit('tool_start', toolState);
    } else {
      const finished = applyToolEnd(streamingState, event);
      this.activeTools = streamingState.activeTools;
      if (finished) this.emit('tool_end', finished);
    }
  }

  private clearStreaming(): void {
    this.streamingText = '';
    this.activeTools = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private flushStreaming(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
