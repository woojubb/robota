/**
 * InteractiveSession — the single entry point for all SDK consumers.
 *
 * Wraps Session (composition). Manages streaming text accumulation,
 * tool execution state tracking, prompt queuing, abort orchestration,
 * message history, and system command execution.
 *
 * Config/context loading is internal. Consumer provides cwd + provider.
 */

import { randomUUID } from 'node:crypto';
import type { Session } from '@robota-sdk/agent-sessions';
import type { ISession } from '@robota-sdk/agent-core';
import type { ICompactEvent } from '@robota-sdk/agent-sessions';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type {
  TUniversalMessage,
  IContextWindowState,
  IHistoryEntry,
  TSessionEndReason,
  TToolArgs,
} from '@robota-sdk/agent-core';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';
import type { IInteractiveSession } from './i-interactive-session.js';
import type {
  IAgentJobHostContext,
  ICommand,
  ICommandHostAdapters,
  ICommandModule,
  ICommandResult,
  ICommandSkillListEntry,
  ISystemCommand,
  ISkillExecutionResult,
  IForkExecutionOptions,
  TAutoCompactThreshold,
  TAutoCompactThresholdSource,
  ICommandSkillActivationRequest,
  TCommandInvocationSource,
} from '../commands/index.js';
import { executeSkill, SkillCommandSource, SystemCommandExecutor } from '../commands/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import {
  createSkillActivationEvent,
  formatSkillActivationMessage,
} from '../commands/skill-activation-events.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';
import { getBuiltInAgent } from '../agents/built-in-agents.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';
import type { IToolState, TInteractiveEventName, IInteractiveSessionEvents } from './types.js';
import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskManager,
  IBackgroundTaskState,
  IExecutionDetailCursor,
  IExecutionDetailPage,
  IExecutionOrigin,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceFilter,
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
  IExecutionWorkspaceTaskSpawner,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
  TBackgroundTaskIsolation,
  TExecutionWorkspaceUpdateCause,
} from '../background-tasks/index.js';
import {
  BackgroundJobOrchestrator,
  createBackgroundGroupExecutionEntryId,
  createBackgroundTaskExecutionEntryId,
  createExecutionOriginMetadata,
  createExecutionWorkspaceSnapshot,
  createExecutionWorkspaceTaskSpawner,
  createLineDetailPage,
  createMainThreadDetailPage,
  parseExecutionWorkspaceEntryId,
  summarizeBackgroundJobGroup,
} from '../background-tasks/index.js';
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
  createUsageSummaryEntry,
  preparePromptInput,
} from './interactive-session-execution.js';
import { persistSession } from './interactive-session-persistence.js';
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
  ICreatedInteractiveSession,
} from './interactive-session-init.js';
import type { IInteractiveSessionStore } from './session-persistence.js';
import type { IMemoryEvent, IMemoryReference } from '../memory/automatic-memory-types.js';
import type {
  IContextReferenceAddResult,
  IContextReferenceClearResult,
  IContextReferenceItem,
  IContextReferenceRemoveResult,
} from '../context/context-reference-inventory.js';
import {
  clearContextReferences,
  removeContextReference,
} from '../context/context-reference-inventory.js';
import {
  addInteractiveContextReference,
  recordInteractiveContextReferences,
} from './interactive-session-context-references.js';
import type { IPromptFileReferenceRecord } from '../context/prompt-file-references.js';
import { refreshContextEntries } from '../context/context-file-tracker.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../checkpoints/edit-checkpoint-types.js';
import type { ISandboxClient } from '@robota-sdk/agent-tools';
export type { IInteractiveSessionOptions } from './interactive-session-init.js';

export interface IInteractiveSessionShutdownOptions {
  reason?: TSessionEndReason;
  message?: string;
}

function normalizeSkillName(name: string): string {
  return name.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '';
}

function normalizeCommandName(name: string): string {
  return name.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '';
}

function formatSkillCommandArgs(skillName: string, args: string): string {
  const trimmedArgs = args.trim();
  return trimmedArgs.length > 0 ? `${skillName} ${trimmedArgs}` : skillName;
}

function getQualifiedSkillName(rawInput?: string): string | undefined {
  if (!rawInput?.startsWith('/')) return undefined;
  const firstToken = rawInput.slice(1).trim().split(/\s+/)[0];
  return firstToken && firstToken.length > 0 ? firstToken : undefined;
}

function getBackgroundTaskEventEntryId(event: TBackgroundTaskEvent): string | undefined {
  if ('task' in event) return createBackgroundTaskExecutionEntryId(event.task.id);
  if ('taskId' in event) return createBackgroundTaskExecutionEntryId(event.taskId);
  return undefined;
}

export class InteractiveSession implements ISession, IAgentJobHostContext, IInteractiveSession {
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
  private sessionStore?: IInteractiveSessionStore;
  private sessionName?: string;
  private cwd?: string;
  private pendingRestoreMessages: TUniversalMessage[] | null = null;
  private backgroundTasks: IBackgroundTaskState[] = [];
  private backgroundTaskEvents: TBackgroundTaskEvent[] = [];
  private backgroundJobGroups: IBackgroundJobGroupState[] = [];
  private backgroundJobGroupEvents: TBackgroundJobGroupEvent[] = [];
  private memoryEvents: IMemoryEvent[] = [];
  private usedMemoryReferences: IMemoryReference[] = [];
  private contextReferences: IContextReferenceItem[] = [];
  private editCheckpointStore: EditCheckpointStore | null = null;
  private resumeSessionId?: string;
  private forkSession: boolean;
  private backgroundTaskUnsubscribe: (() => void) | null = null;
  private backgroundJobUnsubscribe: (() => void) | null = null;
  private backgroundJobOrchestrator: BackgroundJobOrchestrator | null = null;
  private readonly commandModules: readonly ICommandModule[];
  private readonly commandHostAdapters?: ICommandHostAdapters;
  private readonly skillCommandSource: SkillCommandSource;
  private skillActivationEvents: ISkillActivationEvent[] = [];
  private autoCompactThresholdSource: TAutoCompactThresholdSource = 'default';
  private shuttingDown = false;
  private shutdownPromise: Promise<void> | null = null;
  private readonly sandboxClient?: ISandboxClient;
  private sandboxSnapshotId?: string;
  private commandInvocationSource: TCommandInvocationSource = 'user';
  private agentsFileEntries: IContextFileEntry[] = [];
  private claudeFileEntries: IContextFileEntry[] = [];
  private rebuildSystemMessage: ICreatedInteractiveSession['rebuildSystemMessage'] | null = null;

  constructor(options: IInteractiveSessionOptions) {
    this.commandModules = [...('commandModules' in options ? (options.commandModules ?? []) : [])];
    this.commandExecutor = new SystemCommandExecutor(
      this.commandModules.flatMap((module) => module.systemCommands ?? []),
    );
    this.sessionStore = options.sessionStore;
    this.sessionName = options.sessionName;
    this.cwd = ('cwd' in options ? options.cwd : undefined) ?? '';
    if ('session' in options && options.session && this.cwd) {
      this.editCheckpointStore = new EditCheckpointStore({ cwd: this.cwd });
    }
    this.resumeSessionId = options.resumeSessionId;
    this.forkSession = options.forkSession ?? false;
    this.commandHostAdapters =
      'commandHostAdapters' in options ? options.commandHostAdapters : undefined;
    this.sandboxClient = 'sandboxClient' in options ? options.sandboxClient : undefined;
    this.sandboxSnapshotId = 'sandboxSnapshotId' in options ? options.sandboxSnapshotId : undefined;
    this.skillCommandSource = new SkillCommandSource(this.cwd || process.cwd());

    const hasInjectedSession = this.configureInjectedSession(options);
    this.restoreSessionRecordIfNeeded(options);
    this.startAsyncInitializationIfNeeded(options, hasInjectedSession);

    if (this.initialized) this.subscribeBackgroundTaskEvents();
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
    if (restored.history.length > 0) this.history = restored.history;
    if (restored.sessionName) this.sessionName = restored.sessionName;
    this.backgroundTasks = restored.backgroundTasks;
    this.backgroundTaskEvents = restored.backgroundTaskEvents;
    this.backgroundJobGroups = restored.backgroundJobGroups;
    this.backgroundJobGroupEvents = restored.backgroundJobGroupEvents;
    this.skillActivationEvents = restored.skillActivationEvents;
    this.memoryEvents = restored.memoryEvents;
    this.usedMemoryReferences = restored.usedMemoryReferences;
    this.contextReferences = restored.contextReferences;
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
    const config = options.config ?? (await loadConfig(options.cwd));
    this.autoCompactThresholdSource =
      config.autoCompactThreshold === undefined ? 'default' : 'settings';
    this.editCheckpointStore = new EditCheckpointStore({ cwd: options.cwd });
    const created = await createInteractiveSession({
      cwd: options.cwd,
      provider: options.provider,
      config,
      permissionMode: options.permissionMode,
      maxTurns: options.maxTurns,
      permissionHandler: options.permissionHandler,
      resumeSessionId: this.resumeSessionId,
      forkSession: this.forkSession,
      onTextDelta: (delta: string) => this.handleTextDelta(delta),
      onContextUpdate: (state) => this.emit('context_update', state),
      onCompactEvent: (event) => this.handleCompactEvent(event),
      onToolExecution: (event) => this.handleToolExecution(event),
      bare: options.bare,
      allowedTools: options.allowedTools,
      appendSystemPrompt: options.appendSystemPrompt,
      language: options.language,
      backgroundTaskRunners: options.backgroundTaskRunners,
      subagentRunnerFactory: options.subagentRunnerFactory,
      ...(options.commandModules ? { commandModules: options.commandModules } : {}),
      editCheckpointRecorder: this.editCheckpointStore,
      ...(options.reversibleExecution ? { reversibleExecution: options.reversibleExecution } : {}),
      ...(options.sandboxClient ? { sandboxClient: options.sandboxClient } : {}),
      ...(options.workspaceManifest ? { workspaceManifest: options.workspaceManifest } : {}),
      ...(options.sandboxWorkspaceRoot
        ? { sandboxWorkspaceRoot: options.sandboxWorkspaceRoot }
        : {}),
      ...(this.sandboxSnapshotId ? { sandboxSnapshotId: this.sandboxSnapshotId } : {}),
      commandDescriptors: this.commandExecutor.listModelInvocableCommands(),
      ...(this.commandExecutor.listModelInvocableCommands().length > 0
        ? {
            modelCommandExecutor: (command, args) => this.executeModelCommand(command, args),
            isModelCommandInvocable: (command) => this.commandExecutor.isModelInvocable(command),
          }
        : {}),
    });
    this.session = created.session;
    this.agentsFileEntries = created.agentsFileEntries;
    this.claudeFileEntries = created.claudeFileEntries;
    this.rebuildSystemMessage = created.rebuildSystemMessage;

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
    if (this.shuttingDown) throw new Error('Interactive session is shutting down.');
    if (this.executing) {
      this.pendingPrompt = input;
      this.pendingDisplayInput = displayInput;
      this.pendingRawInput = rawInput;
      return;
    }
    await this.executePrompt(input, displayInput, rawInput);
  }

  async executeCommand(name: string, args: string): Promise<ICommandResult | null> {
    await this.ensureInitialized();
    const normalizedName = normalizeCommandName(name);
    const command = this.commandExecutor.getCommand(normalizedName);
    const commandArgs = args.trim();
    if (!command) {
      const skill = this.findSkillCommand(normalizedName);
      const skillsCommand = this.commandExecutor.getCommand('skills');
      if (!skill || !skillsCommand) return null;
      return this.executeCommandWithInvocationSource(
        'user',
        skillsCommand,
        formatSkillCommandArgs(skill.name, commandArgs),
      );
    }
    return this.executeCommandWithInvocationSource('user', command, commandArgs);
  }

  private async executeCommandWithInvocationSource(
    source: TCommandInvocationSource,
    command: ISystemCommand,
    args: string,
  ): Promise<ICommandResult> {
    if (this.executing) {
      return {
        success: false,
        message: 'Another prompt or command is already running. Wait for it to finish.',
      };
    }
    const previousSource = this.commandInvocationSource;
    this.commandInvocationSource = source;
    try {
      if (command.lifecycle === 'blocking') {
        return this.executeForegroundCommand(command, args);
      }
      return await this.commandExecutor.executeCommand(command, this, args);
    } finally {
      this.commandInvocationSource = previousSource;
    }
  }

  async executeModelCommand(name: string, args: string): Promise<ICommandResult | null> {
    await this.ensureInitialized();
    const previousSource = this.commandInvocationSource;
    this.commandInvocationSource = 'model';
    try {
      return await this.commandExecutor.executeModelInvocable(name, this, args);
    } finally {
      this.commandInvocationSource = previousSource;
    }
  }

  getCommandInvocationSource(): TCommandInvocationSource {
    return this.commandInvocationSource;
  }

  async executeSkillCommandByName(
    name: string,
    args: string,
    request: ICommandSkillActivationRequest,
  ): Promise<ICommandResult | null> {
    await this.ensureInitialized();
    const skill = this.findSkillCommand(name);
    if (!skill) return null;

    if (request.invocationSource === 'model') {
      if (skill.disableModelInvocation === true) {
        return {
          success: false,
          message: `Skill is not model-invocable: ${skill.name}`,
        };
      }
      const result = await this.executeSkillWithActivation(skill, args, 'model-tool');
      return {
        success: true,
        message: `Skill activated: ${skill.name}`,
        data: {
          skill: skill.name,
          mode: result.mode,
          ...(result.prompt !== undefined ? { prompt: result.prompt } : {}),
          ...(result.result !== undefined ? { result: result.result } : {}),
        },
      };
    }

    await this.executeUserResolvedSkillCommand(
      skill,
      args,
      request.displayInput,
      request.rawInput,
      'user-slash',
    );
    return {
      success: true,
      message: '',
      data: {
        skill: skill.name,
        sessionExecution: true,
      },
      effects: [{ type: 'session-execution-started' }],
    };
  }

  private async executeUserResolvedSkillCommand(
    skill: ICommand,
    args: string,
    displayInput: string | undefined,
    rawInput: string | undefined,
    invocation: ISkillActivationEvent['invocation'],
  ): Promise<ISkillExecutionResult> {
    await this.ensureInitialized();
    if (skill.userInvocable === false) {
      throw new Error(`Skill is not user-invocable: ${skill.name}`);
    }

    const qualifiedName = getQualifiedSkillName(rawInput);

    if (skill.context === 'fork') {
      return this.executeForkSkillCommand(skill, args, displayInput, qualifiedName, invocation);
    }

    const result = await this.executeSkillWithActivation(skill, args, invocation, qualifiedName);

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

  listSkills(): ICommandSkillListEntry[] {
    return this.skillCommandSource.getCommands().map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      modelInvocable: skill.disableModelInvocation !== true,
      userInvocable: skill.userInvocable !== false,
      ...(skill.argumentHint !== undefined ? { argumentHint: skill.argumentHint } : {}),
      ...(skill.context !== undefined ? { context: skill.context } : {}),
      ...(skill.agent !== undefined ? { agent: skill.agent } : {}),
    }));
  }

  listModelInvocableCommands(): Array<{ name: string; description: string }> {
    return this.commandExecutor.listModelInvocableCommands().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }

  getSkillActivationEvents(): ISkillActivationEvent[] {
    return [...this.skillActivationEvents];
  }

  private findSkillCommand(name: string): ICommand | undefined {
    const normalizedName = normalizeSkillName(name);
    return this.skillCommandSource
      .getCommands()
      .find((skill) => skill.name.toLowerCase() === normalizedName.toLowerCase());
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
      await this.captureSandboxSnapshot();
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
  get isInitialized(): boolean {
    return this.initialized;
  }
  getContextState(): IContextWindowState {
    return this.getSessionOrThrow().getContextState();
  }
  getAutoCompactThreshold(): number | false {
    return this.getSessionOrThrow().getAutoCompactThreshold();
  }
  getAutoCompactThresholdSource(): TAutoCompactThresholdSource {
    return this.autoCompactThresholdSource;
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
  getCommandHostAdapters(): ICommandHostAdapters {
    return this.commandHostAdapters ?? {};
  }
  clearConversationHistory(): void {
    this.getSessionOrThrow().clearHistory();
    this.history = [];
    this.persistCurrentSession();
    this.emit('context_update', this.getContextState());
  }
  async compactContext(instructions?: string): Promise<void> {
    await this.getSessionOrThrow().compact(instructions);
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

  inspectEditCheckpoint(checkpointId: string): IEditCheckpointInspection {
    const sessionId = this.getSessionOrThrow().getSessionId();
    return this.getEditCheckpointStore().inspect(sessionId, checkpointId);
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

  async rollbackEditCheckpoint(checkpointId: string): Promise<IEditCheckpointRestoreResult> {
    await this.ensureInitialized();
    if (this.executing) {
      throw new Error('Cannot rollback edit checkpoint while a prompt is running.');
    }
    const result = await this.getEditCheckpointStore().rollbackThroughCheckpoint(
      this.getSessionOrThrow().getSessionId(),
      checkpointId,
    );
    this.history.push(
      messageToHistoryEntry(createSystemMessage(`Rolled back edit checkpoint: ${checkpointId}`)),
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

  listContextReferences(): IContextReferenceItem[] {
    return [...this.contextReferences];
  }

  async addContextReference(path: string): Promise<IContextReferenceAddResult> {
    const { references, result } = await addInteractiveContextReference(
      this.contextReferences,
      path,
      this.getCwd(),
    );
    this.contextReferences = references;
    this.persistCurrentSession();
    return result;
  }

  removeContextReference(path: string): IContextReferenceRemoveResult {
    const result = removeContextReference(this.contextReferences, path);
    this.contextReferences = result.references;
    this.persistCurrentSession();
    return result.result;
  }

  clearContextReferences(): IContextReferenceClearResult {
    const result = clearContextReferences(this.contextReferences);
    this.contextReferences = [];
    this.persistCurrentSession();
    return result;
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

  getExecutionWorkspaceSnapshot(
    options: IExecutionWorkspaceSnapshotOptions = {},
  ): IExecutionWorkspaceSnapshot {
    const session = this.getSessionOrThrow();
    const sessionId = session.getSessionId();
    return createExecutionWorkspaceSnapshot({
      sessionId,
      mainThread: {
        sessionId,
        isExecuting: this.executing,
        hasPendingPrompt: this.pendingPrompt !== null,
        historyLength: this.history.length,
        updatedAt: this.getMainThreadUpdatedAt(),
        preview: this.getMainThreadPreview(),
      },
      tasks: this.getBackgroundTaskSnapshots(),
      groups: this.getBackgroundJobGroupSnapshots(),
      selectedEntryId: options.selectedEntryId,
      filter: options.filter,
    });
  }

  listExecutionWorkspaceEntries(filter?: IExecutionWorkspaceFilter): IExecutionWorkspaceEntry[] {
    return [...this.getExecutionWorkspaceSnapshot({ filter }).entries];
  }

  getExecutionWorkspaceEntry(entryId: string): IExecutionWorkspaceEntry | undefined {
    return this.getExecutionWorkspaceSnapshot().entries.find((entry) => entry.id === entryId);
  }

  async readExecutionWorkspaceDetail(
    entryId: string,
    cursor?: IExecutionDetailCursor,
  ): Promise<IExecutionDetailPage> {
    await this.ensureInitialized();
    const entryRef = parseExecutionWorkspaceEntryId(entryId);
    if (!entryRef) throw new Error(`Unknown execution workspace entry: ${entryId}`);
    if (entryRef.kind === 'main_thread') {
      return createMainThreadDetailPage({ entryId, history: this.history, cursor });
    }
    if (entryRef.kind === 'background_group') {
      return this.readBackgroundGroupDetail(entryId, entryRef.sourceId);
    }
    return this.readBackgroundTaskDetail(entryId, entryRef.sourceId, cursor);
  }

  createExecutionWorkspaceTaskSpawner(origin: IExecutionOrigin): IExecutionWorkspaceTaskSpawner {
    const sessionId = this.getSessionOrThrow().getSessionId();
    return createExecutionWorkspaceTaskSpawner({
      manager: this.getBackgroundTaskManagerOrThrow(),
      groupOrchestrator: this.getBackgroundJobOrchestratorOrThrow(),
      sessionId,
      cwd: this.getCwd(),
      origin: { ...origin, sessionId: origin.sessionId || sessionId },
    });
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
    const sessionId = this.getSessionOrThrow().getSessionId();
    return this.getSubagentManagerOrThrow().spawn({
      type: input.agentType,
      label: input.label,
      parentSessionId: sessionId,
      mode: input.mode,
      depth: (deps.subagentDepth ?? 0) + 1,
      cwd: deps.cwd ?? this.cwd ?? process.cwd(),
      prompt: input.prompt,
      model: input.model ?? definition.model,
      isolation: input.isolation,
      allowedTools: definition.tools,
      disallowedTools: definition.disallowedTools,
      metadata: createExecutionOriginMetadata({
        kind: this.commandInvocationSource === 'model' ? 'model_command' : 'slash_command',
        sessionId,
        commandName: 'agent',
        label: input.label,
      }),
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

  private async executeSkillWithActivation(
    skill: ICommand,
    args: string,
    invocation: ISkillActivationEvent['invocation'],
    qualifiedName?: string,
  ): Promise<ISkillExecutionResult> {
    this.recordSkillActivation(skill, invocation, 'started', qualifiedName);
    try {
      const result = await executeSkill(
        skill,
        args,
        {
          runInFork: (content, options) => this.runSkillInFork(content, options),
        },
        { sessionId: this.getSessionOrThrow().getSessionId() },
      );
      this.recordSkillActivation(skill, invocation, 'completed', qualifiedName, {
        appendHistory: false,
      });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.recordSkillActivation(skill, invocation, 'failed', qualifiedName, {
        error: error.message,
      });
      throw error;
    }
  }

  private recordSkillActivation(
    skill: ICommand,
    invocation: ISkillActivationEvent['invocation'],
    status: ISkillActivationEvent['status'],
    qualifiedName?: string,
    options: { appendHistory?: boolean; error?: string } = {},
  ): void {
    const event = createSkillActivationEvent({
      skill,
      invocation,
      status,
      ...(qualifiedName !== undefined ? { qualifiedName } : {}),
      ...(options.error !== undefined ? { error: options.error } : {}),
    });
    this.recordSkillActivationEvent(event, options.appendHistory ?? status !== 'completed');
  }

  private recordSkillActivationEvent(event: ISkillActivationEvent, appendHistory: boolean): void {
    this.skillActivationEvents.push(event);
    if (appendHistory) {
      this.history.push({
        id: randomUUID(),
        timestamp: new Date(event.timestamp),
        category: 'event',
        type: 'skill-activation',
        data: {
          ...event,
          message: formatSkillActivationMessage(event),
        },
      });
    }
    this.emit('skill_activation', event);
    this.persistCurrentSession();
  }

  private async executeForkSkillCommand(
    skill: ICommand,
    args: string,
    displayInput?: string,
    qualifiedName?: string,
    invocation: ISkillActivationEvent['invocation'] = 'user-slash',
  ): Promise<ISkillExecutionResult> {
    if (this.executing) {
      throw new Error('Cannot execute fork skill while another prompt is running.');
    }

    this.startForkSkillExecution(displayInput ?? `/${skill.name}`);

    try {
      const result = await this.executeSkillWithActivation(skill, args, invocation, qualifiedName);
      await this.applyForkSkillResult(result.result ?? '(empty response)');
      return result;
    } catch (err) {
      this.recordForkSkillError(err instanceof Error ? err : new Error(String(err)));
      return { mode: 'fork', result: '' };
    } finally {
      this.finishForkSkillExecution();
    }
  }

  private async readBackgroundTaskDetail(
    entryId: string,
    taskId: string,
    cursor?: IExecutionDetailCursor,
  ): Promise<IExecutionDetailPage> {
    const task = this.getBackgroundTaskManagerOrThrow().get(taskId);
    if (!task) throw new Error(`Unknown background task: ${taskId}`);
    if (task.logPath || task.transcriptPath) {
      const page = await this.getBackgroundTaskManagerOrThrow().readLog(taskId, cursor);
      return createLineDetailPage({
        entryId,
        lines: page.lines,
        cursor: page.cursor,
        nextCursor: page.nextCursor,
        kind: task.kind === 'process' ? 'process_output' : 'progress',
      });
    }
    const detailKind =
      task.status === 'failed' ? 'error' : task.status === 'completed' ? 'result' : 'progress';
    const text =
      task.error?.message ??
      task.result?.output ??
      task.currentAction ??
      task.promptPreview ??
      task.commandPreview ??
      task.status;
    return createLineDetailPage({ entryId, lines: [text], cursor, kind: detailKind });
  }

  private readBackgroundGroupDetail(entryId: string, groupId: string): IExecutionDetailPage {
    const group = this.getBackgroundJobOrchestratorOrThrow().getGroup(groupId);
    if (!group) throw new Error(`Unknown background job group: ${groupId}`);
    const summary = summarizeBackgroundJobGroup(group);
    return createLineDetailPage({
      entryId,
      lines: summary.lines,
      kind: 'group_summary',
    });
  }

  private getMainThreadUpdatedAt(): string {
    return this.history.at(-1)?.timestamp.toISOString() ?? new Date(0).toISOString();
  }

  private getMainThreadPreview(): string | undefined {
    if (this.streamingText.trim().length > 0) return this.streamingText;
    const latest = this.history.at(-1);
    if (!latest) return undefined;
    return latest.type;
  }

  private emitExecutionWorkspaceUpdated(
    cause: TExecutionWorkspaceUpdateCause,
    entryId?: string,
  ): void {
    if (!this.session) return;
    this.emit('execution_workspace_event', {
      type: 'execution_workspace_updated',
      cause,
      ...(entryId ? { entryId } : {}),
      snapshot: this.getExecutionWorkspaceSnapshot(),
    });
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
    this.emitExecutionWorkspaceUpdated('background_task', getBackgroundTaskEventEntryId(event));
  }

  private recordBackgroundJobGroupEvent(event: TBackgroundJobGroupEvent): void {
    this.backgroundJobGroups = this.getBackgroundJobGroupSnapshots();
    this.backgroundJobGroupEvents.push(event);
    this.persistCurrentSession();
    this.emitExecutionWorkspaceUpdated(
      'background_group',
      createBackgroundGroupExecutionEntryId(event.group.id),
    );
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
      {
        events: this.skillActivationEvents,
      },
      {
        references: this.contextReferences,
      },
      {
        snapshotId: this.sandboxSnapshotId,
      },
    );
  }

  private async captureSandboxSnapshot(): Promise<void> {
    if (!this.sandboxClient?.snapshot) return;
    try {
      this.sandboxSnapshotId = await this.sandboxClient.snapshot();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.history.push(
        messageToHistoryEntry(createSystemMessage(`Sandbox snapshot error: ${err.message}`)),
      );
      this.emit('error', err);
    }
  }

  private startForkSkillExecution(displayInput: string): void {
    this.executing = true;
    this.clearStreaming();
    this.emit('thinking', true);
    this.history.push(messageToHistoryEntry(createUserMessage(displayInput)));
    this.emitExecutionWorkspaceUpdated('main_thread');
  }

  private finishForkSkillExecution(): void {
    this.executing = false;
    this.emit('thinking', false);
    this.emitExecutionWorkspaceUpdated('main_thread');
    this.persistCurrentSession();
    if (!this.shuttingDown && this.pendingPrompt) {
      const queued = this.pendingPrompt;
      const queuedDisplay = this.pendingDisplayInput;
      const queuedRaw = this.pendingRawInput;
      this.clearPendingQueue();
      setTimeout(() => void this.submit(queued, queuedDisplay, queuedRaw), 0);
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
      throw new Error(
        'Fork execution is not available. Agent runtime deps may not be initialized.',
      );
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

  private async executeForegroundCommand(
    command: ISystemCommand,
    args: string,
  ): Promise<ICommandResult> {
    this.executing = true;
    this.clearStreaming();
    this.emit('thinking', true);
    this.emitExecutionWorkspaceUpdated('main_thread');

    try {
      const result = await this.commandExecutor.executeCommand(command, this, args);
      this.emit('context_update', this.getContextState());
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Error: ${errMsg}`,
      };
    } finally {
      this.executing = false;
      this.emit('thinking', false);
      this.emitExecutionWorkspaceUpdated('main_thread');
      this.persistCurrentSession();
      if (!this.shuttingDown && this.pendingPrompt) {
        const queued = this.pendingPrompt;
        const queuedDisplay = this.pendingDisplayInput;
        const queuedRaw = this.pendingRawInput;
        this.clearPendingQueue();
        setTimeout(() => void this.submit(queued, queuedDisplay, queuedRaw), 0);
      }
    }
  }

  private async checkAndRefreshContextIfStale(): Promise<void> {
    if (!this.rebuildSystemMessage) return;
    const allEntries = [...this.agentsFileEntries, ...this.claudeFileEntries];
    if (allEntries.length === 0) return;

    const agentsCount = this.agentsFileEntries.length;
    const { updated, refreshed } = await refreshContextEntries(allEntries);
    if (refreshed.length === 0) return;

    this.agentsFileEntries = updated.slice(0, agentsCount);
    this.claudeFileEntries = updated.slice(agentsCount);

    const newAgentsMd = this.agentsFileEntries.map((e) => e.content).join('\n\n');
    const newClaudeMd = this.claudeFileEntries.map((e) => e.content).join('\n\n');
    const newSystemMessage = this.rebuildSystemMessage(newAgentsMd, newClaudeMd);
    this.getSessionOrThrow().updateSystemMessage(newSystemMessage);

    for (const filePath of refreshed) {
      this.emit('context_file_refreshed', { filePath });
    }
  }

  private async executePrompt(
    input: string,
    displayInput?: string,
    rawInput?: string,
  ): Promise<void> {
    await this.checkAndRefreshContextIfStale();
    this.executing = true;
    this.clearStreaming();
    this.emit('user_message', displayInput ?? input);
    this.emit('thinking', true);
    this.history.push(messageToHistoryEntry(createUserMessage(displayInput ?? input)));
    this.emitExecutionWorkspaceUpdated('main_thread');

    const historyBefore = this.getSessionOrThrow().getHistory().length;
    this.usedMemoryReferences = [];

    try {
      const preparedPrompt = await preparePromptInput(
        input,
        this.getCwd(),
        rawInput,
        this.contextReferences,
      );
      if (preparedPrompt.promptFileReferenceEntry) {
        this.history.push(preparedPrompt.promptFileReferenceEntry);
      }
      this.recordContextReferenceUsage(preparedPrompt.activeContextReferenceRecords);
      this.recordPromptContextReferences(preparedPrompt.promptFileReferenceRecords);

      await this.beginEditCheckpointTurn(displayInput ?? input);
      const response = await this.getSessionOrThrow().run(
        preparedPrompt.modelInput,
        preparedPrompt.hookInput,
      );
      this.flushStreaming();
      pushToolSummaryToHistory({ activeTools: this.activeTools, history: this.history });
      this.clearStreaming();
      const result = buildResult(
        response || '(empty response)',
        this.getSessionOrThrow().getHistory(),
        this.history,
        historyBefore,
        this.getContextState(),
        preparedPrompt.promptFileReferenceRecords,
      );
      this.history.push(messageToHistoryEntry(createAssistantMessage(result.response)));
      if (result.usage) this.history.push(createUsageSummaryEntry(result.usage));
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
        if (result.usage) this.history.push(createUsageSummaryEntry(result.usage));
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
      this.emitExecutionWorkspaceUpdated('main_thread');
      this.persistCurrentSession();
      if (!this.shuttingDown && this.pendingPrompt) {
        const queued = this.pendingPrompt;
        const queuedDisplay = this.pendingDisplayInput;
        const queuedRaw = this.pendingRawInput;
        this.clearPendingQueue();
        setTimeout(() => void this.submit(queued, queuedDisplay, queuedRaw), 0);
      }
    }
  }

  private recordContextReferenceUsage(records: readonly IPromptFileReferenceRecord[]): void {
    this.contextReferences = recordInteractiveContextReferences(this.contextReferences, records, {
      loadType: 'manual',
      status: 'active',
    });
    this.persistCurrentSession();
  }

  private recordPromptContextReferences(records: readonly IPromptFileReferenceRecord[]): void {
    this.contextReferences = recordInteractiveContextReferences(this.contextReferences, records, {
      loadType: 'prompt-reference',
      status: 'observed',
    });
    this.persistCurrentSession();
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

  private handleCompactEvent(event: ICompactEvent): void {
    if (event.trigger === 'auto') {
      this.history.push(
        messageToHistoryEntry(
          createSystemMessage(
            `Auto compacted context: ${Math.round(event.before.usedPercentage)}% -> ${Math.round(event.after.usedPercentage)}%`,
          ),
        ),
      );
    }
    this.emit('compact', event);
    this.emit('context_update', event.after);
  }

  private handleToolExecution(event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
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
