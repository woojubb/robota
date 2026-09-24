import { randomUUID } from 'node:crypto';

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { isTurnNotRunError, OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';

import { SessionBackgroundTaskTracker } from './interactive-session-background-tracker.js';
import { InteractiveSessionBase } from './interactive-session-base.js';
import { SessionExecutionController } from './interactive-session-execution-controller.js';
import { writeForkedSessionRecord } from './interactive-session-fork-record.js';
import { runSkillInFork } from './interactive-session-fork.js';
import { SessionHistoryTracker } from './interactive-session-history-tracker.js';
import {
  applyCommandHostActions,
  emitUiIntentEvents,
  resolveUiIntentRequester,
} from './interactive-session-host-actions.js';
import { initializeInteractiveSessionAsync } from './interactive-session-init.js';
import { persistSession } from './interactive-session-persistence.js';
import { createPromptHistoryRecorder } from './interactive-session-prompt-history.js';
import { createProjectPermissionPersistence } from './project-permission-persistence.js';
import { resolveUserSettingsProviderSwitch } from './interactive-session-provider-switch.js';
import { persistSessionRename } from './interactive-session-rename.js';
import { loadSessionRecord } from './interactive-session-restore.js';
import { InteractiveSessionRuntimeTools } from './interactive-session-runtime-tools.js';
import { SessionSkillRouter } from './interactive-session-skill-router.js';
import { SessionTerminalHandoffGate } from './interactive-session-terminal-handoff.js';
import { SessionTurnMemory } from './interactive-session-turn-memory.js';
import { ExternalEventIngress } from './external-event-ingress.js';
import { DurableSessionLoopStore } from './session-loop-durable-store.js';
import { extractSelfPacedLoopDecision } from './session-loop-decision-tool.js';
import {
  claimSelfPacedLoopWake,
  createSelfPacedLoopState,
  finishSelfPacedLoopTurn,
  markSelfPacedLoopRunning,
  recoverSelfPacedLoopState,
  stopSelfPacedLoopState,
} from './session-loop-transitions.js';
import {
  StoppedWakeSubmissionError,
  publicTurnOptions,
  submitNewTurn,
} from './interactive-session-turn-submission.js';
import {
  sessionLoopBlockReason,
  sessionLoopExpiry,
  sessionLoopFirstWakeEligibility,
  validatedSessionLoopExpiry,
} from './session-loop-lifecycle.js';
import { SessionPromptRegistry } from './session-prompt-registry.js';
import { retrieveSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';
import { formatOrgPolicyViolationMessage } from '../command-api/org-policy/org-policy-loader.js';
import { GoalController, buildGoalContinuationPrompt } from '../goal/index.js';
import { createUserInteractionPort } from '../interaction/user-interaction-port.js';
import { PlanController } from '../plan/index.js';
import { retrieveAgentToolDeps } from '../tools/agent-tool.js';
import { humanizeApiError } from '../utils/error-humanizer.js';
import {
  WorkspaceAuthorityRequiredError,
  createRestrictedWorkspaceProjectAccess,
} from '../workspace-trust/index.js';

import type { IInteractiveSession } from './i-interactive-session.js';
import type {
  IExternalEventSource,
  IExternalEventSourceOptions,
} from './external-event-ingress.js';
import type { IQueuedInput, ITurnOptions } from './interactive-session-execution-controller.js';
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
import type { TLivePromptOverrides } from '../assembly/create-session-runtime.js';
import type { ICommandHostContext } from '../command-api/index.js';
import type { IOrgPolicy } from '../command-api/org-policy/org-policy-types.js';
import type {
  IAgentJobHostContext,
  ICommandResult,
  IUnknownCommandModuleName,
  TAutoCompactThresholdSource,
  TAutoCompactThreshold,
  TCommandInvocationSource,
} from '../commands/index.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import type { INodeHostSettingsSource } from '../config/node-host-settings-source.js';
import type { IOutputStylePrompt } from '../context/output-style-prompt.js';
import type { IGoalStartOptions } from '../goal/index.js';
import type { IAutomaticMemoryConfig } from '../memory/automatic-memory-types.js';
import type { IMemoryStore, IPerTurnRecallConfig } from '../memory/types.js';
import type { IProviderErrorGuidance } from '../utils/error-humanizer.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';
import type {
  TUniversalMessage,
  TSessionEndReason,
  IProviderDefinition,
  IUserInteraction,
  TActionResponse,
  IToolSchema,
  IToolExecutionResult,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type { ISession } from '@robota-sdk/agent-core';
import type { IBackgroundTaskManager } from '@robota-sdk/agent-executor';
import type {
  IBackgroundTaskState,
  IExecutionPendingRequest,
} from '@robota-sdk/agent-interface-execution';
import type {
  IGoalState,
  ITurnHandle,
  IPlanArtifact,
  ISubmitOptions,
  TTurnSource,
  TDriverId,
  TPermissionResultValue,
  ISessionLoopState,
} from '@robota-sdk/agent-interface-session';
import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type { Session } from '@robota-sdk/agent-session';
import type { ISandboxClient } from '@robota-sdk/agent-tools';
export type { TInteractiveSessionOptions } from './interactive-session-options.js';

export interface IInteractiveSessionShutdownOptions {
  reason?: TSessionEndReason;
  message?: string;
}

/** REMOTE-007: fail-closed last resort for a parked prompt whose subscribed surface disappeared. */
const PROMPT_BACKSTOP_MS = 30 * 60 * 1000;

export class InteractiveSession
  extends InteractiveSessionBase
  implements ISession, IAgentJobHostContext, IInteractiveSession, ICommandHostContext
{
  private session: Session | null = null;
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private sessionStore?: IInteractiveSessionStore;
  private readonly sessionLoopsDisabled: boolean;
  private readonly selfPacedLoops: DurableSessionLoopStore;
  private readonly selfPacedTimerIds = new Map<string, string>();
  private readonly selfPacedWakeClaims = new Set<string>();
  /** Do not let best-effort event snapshots publish a loop before its strict creation write. */
  private readonly pendingLoopCreations = new Set<string>();
  /** Persist a loop stop before cancelling its timer so resume cannot re-arm a stale snapshot. */
  private readonly pendingLoopStops = new Set<string>();
  private sessionName?: string;
  private cwd?: string;
  private pendingRestoreMessages: TUniversalMessage[] | null = null;
  /** CLI-1994: the resumed record's assembled prompt, applied when this session is a fork. */
  private restoredSystemPrompt?: string;
  private resumeSessionId?: string;
  /**
   * Whether THIS session was started as a copy of the record it resumed (`--fork-session`), rather
   * than as a continuation of it. Named for the property it holds, not for the flag that sets it:
   * CLI-1994 gives the class a `forkSession()` member — the in-session fork the command host calls —
   * and one identifier cannot be both a boolean about the past and the verb that makes a new copy.
   */
  private startedAsFork: boolean;
  private autoCompactThresholdSource: TAutoCompactThresholdSource = 'default';
  private readonly runtimeTools = new InteractiveSessionRuntimeTools({
    controller: () => this.execCtrl,
    ensureInitialized: () => this.ensureInitialized(),
    session: () => this.getSessionOrThrow(),
  });
  private shutdownPromise: Promise<void> | null = null;
  private externalEventIngress?: ExternalEventIngress;
  private readonly sandboxClient?: ISandboxClient;
  // SELFHOST-008 P1R: the durable-memory port for this session — the surface-injected store or the neutral
  // fs default (lazily created + cached so it is ONE shared instance). Exposed to the `/memory` command
  // host context via getMemoryStore() so command reads/writes hit the SAME store as startup + capture.
  private injectedMemoryStore?: IMemoryStore;
  // SELFHOST-008 P2: optional post-turn auto-capture policy (surface-supplied); absent ⇒ capture OFF.
  private readonly automaticMemory?: IAutomaticMemoryConfig;
  // SELFHOST-008 P3: optional per-turn recall policy (surface-supplied); absent ⇒ recall OFF.
  private readonly recallMemory?: IPerTurnRecallConfig;
  /** SELFHOST-008 P2/P3: the capture + recall hooks over the one shared memory store. */
  private readonly turnMemory: SessionTurnMemory;
  private sandboxSnapshotId?: string;
  private agentsFileEntries: IContextFileEntry[] = [];
  private projectNotesFileEntries: IContextFileEntry[] = [];
  private rebuildSystemMessage: ICreatedInteractiveSession['rebuildSystemMessage'] | null = null;
  private providerDefinitions: readonly IProviderDefinition[] = [];
  private activeOutputStyleId = 'default';
  private orgPolicy: IOrgPolicy | null = null;
  protected readonly bgTracker: SessionBackgroundTaskTracker;
  protected readonly histTracker: SessionHistoryTracker;
  protected readonly skillRouter: SessionSkillRouter;
  protected readonly execCtrl: SessionExecutionController;
  private readonly stoppedWakeTaskIds = new Set<string>();
  private readonly sessionLoopExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** GOAL-001: autonomous objective-pursuit controller (inert until a goal is set). */
  private readonly goalController = new GoalController();
  /** SELFHOST-002: plan-mode phase controller (inert until a plan is started). */
  private readonly planController = new PlanController();
  /** GOAL-001: origin of the most recently started turn — gates goal-loop advancement. */
  private currentTurnSource: TTurnSource = 'user';
  /** TERM-001: exclusivity + fast-fail over the transport-provided handoff capability. */
  private readonly terminalHandoffGate: SessionTerminalHandoffGate;
  /**
   * REMOTE-007: the framework's event-emitting "ask the user" default (never undefined). It emits
   * `ask_request` and parks the answer in {@link promptRegistry}. `getUserInteraction()` gates the
   * COMMAND port on the live `ask_request` listener count (D4a) so the headless `undefined`
   * "no-human ⇒ proceed" contract survives; the TOOL seam gets this default always-present.
   */
  private readonly askHandler: IUserInteraction['ask'];
  /** REMOTE-007: transport-neutral pending permission/ask registry (parking + fail-closed + drain). */
  private readonly promptRegistry: SessionPromptRegistry;
  private readonly projectAccess: TWorkspaceProjectAccess;
  private readonly providerErrorGuidance?: IProviderErrorGuidance;
  private readonly promptFileReferenceTag?: string;
  private readonly resolveDefaultLoopPrompt?: () => string;
  private readonly userSettingsSources: readonly INodeHostSettingsSource[];

  constructor(options: TInteractiveSessionOptions) {
    super();
    this.sessionStore = options.sessionStore;
    this.selfPacedLoops = new DurableSessionLoopStore([], {
      persist: (candidate) => this.persistCurrentSession(true, undefined, candidate),
      readCommitted: () => {
        const id = this.session?.getSessionId();
        if (!id || !this.sessionStore) return undefined;
        const outcome = this.sessionStore.load(id);
        return outcome.status === 'valid'
          ? (outcome.record.sessionLoops ?? [])
          : outcome.status === 'missing'
            ? []
            : undefined;
      },
    });
    this.providerErrorGuidance = options.providerErrorGuidance;
    this.promptFileReferenceTag = options.promptFileReferenceTag;
    this.resolveDefaultLoopPrompt = options.resolveDefaultLoopPrompt;
    this.userSettingsSources = options.userSettingsSources ?? [];
    this.sessionLoopsDisabled = options.disableSessionLoops ?? false;
    this.projectAccess =
      options.projectAccess ?? createRestrictedWorkspaceProjectAccess('identity-unavailable');
    this.sessionName = options.sessionName;
    if ('outputStyle' in options && options.outputStyle !== undefined) {
      this.activeOutputStyleId = options.outputStyle.id;
    }
    this.terminalHandoffGate = new SessionTerminalHandoffGate(options.terminalHandoff);

    // REMOTE-007: the framework owns one event-emitting prompt registry. Attached surfaces subscribe
    // to requests and answer through resolvePermission/resolveAsk; with none subscribed it fails closed.
    // SCREEN-1992: a prompt parking or settling changes the main thread's normalized state, so the
    // workspace snapshot is re-emitted right after each prompt event (`park` precedes the emit).
    this.promptRegistry = new SessionPromptRegistry({
      emitPermissionRequest: (event) => {
        this.emit('permission_request', event);
        this.execCtrl.emitExecutionWorkspaceUpdated('main_thread');
      },
      emitAskRequest: (event) => {
        this.emit('ask_request', event);
        this.execCtrl.emitExecutionWorkspaceUpdated('main_thread');
      },
      emitPromptResolved: (event) => {
        this.emit('prompt_resolved', event);
        this.execCtrl.emitExecutionWorkspaceUpdated('main_thread');
      },
      countListeners: (event) => this.listeners.get(event)?.size ?? 0,
      // REMOTE-014 E5: stamp the active turn's driver as the prompt's requester (display-only attribution).
      getActiveDriverId: () => this.execCtrl.activeDriverId,
      backstopMs: PROMPT_BACKSTOP_MS,
    });
    this.askHandler = (request) => this.promptRegistry.requestAsk(request);

    this.cwd = ('cwd' in options ? options.cwd : undefined) ?? '';
    this.resumeSessionId = options.resumeSessionId;
    this.startedAsFork = options.forkSession ?? false;
    this.sandboxClient = 'sandboxClient' in options ? options.sandboxClient : undefined;
    this.injectedMemoryStore = 'memoryStore' in options ? options.memoryStore : undefined;
    this.automaticMemory = 'automaticMemory' in options ? options.automaticMemory : undefined;
    this.recallMemory = 'recallMemory' in options ? options.recallMemory : undefined;
    const promptHistory = 'promptHistory' in options ? options.promptHistory : undefined;
    this.turnMemory = new SessionTurnMemory({
      automaticMemory: this.automaticMemory,
      recallMemory: this.recallMemory,
      getMemoryStore: () => this.getMemoryStore(),
      getSessionId: () => this.sessionId,
      recordUsedMemoryReferences: (references) =>
        this.histTracker.recordUsedMemoryReferences(references),
    });
    this.sandboxSnapshotId = 'sandboxSnapshotId' in options ? options.sandboxSnapshotId : undefined;
    const cwd = this.cwd;
    const initCheckpointStore = options.editCheckpointStore ?? null;

    this.bgTracker = new SessionBackgroundTaskTracker(
      () => this.getBackgroundTaskManager(),
      (cause, entryId) => this.execCtrl.emitExecutionWorkspaceUpdated(cause, entryId),
      (event) => this.emit('background_task_event', event),
      (event) => this.emit('background_job_group_event', event),
      () => this.persistCurrentSession(),
      (instruction, taskId) => this.requestWakeup(instruction, taskId),
      (message) => this.histTracker.append(messageToHistoryEntry(createSystemMessage(message))),
      (entry) => this.histTracker.append(entry),
      this.sessionLoopsDisabled,
      (task) => this.armSessionLoopExpiry(task),
    );

    this.histTracker = new SessionHistoryTracker(
      cwd,
      this.projectAccess,
      () => this.getSessionOrThrow().getSessionId(),
      () => this.execCtrl.executing,
      () => this.persistCurrentSession(),
      (event) => this.emit('skill_activation', event),
      (event) => this.emit('memory_event', event),
      initCheckpointStore,
      (event) => this.emit('branch_event', event),
    );

    const commandModules = [...('commandModules' in options ? (options.commandModules ?? []) : [])];
    const commandHostAdapters =
      'commandHostAdapters' in options ? options.commandHostAdapters : undefined;
    const shellExec = 'shellExec' in options ? options.shellExec : undefined;
    const remoteCommandPolicy =
      'remoteCommandPolicy' in options ? options.remoteCommandPolicy : undefined;
    const contributionSources =
      'contributionSources' in options ? (options.contributionSources ?? []) : [];
    const skillRoots = 'skillRoots' in options ? (options.skillRoots ?? []) : [];

    this.skillRouter = new SessionSkillRouter(
      commandModules,
      contributionSources,
      skillRoots,
      commandHostAdapters,
      // ARCH-029 S1: no cast — `implements ICommandHostContext` above makes this compiler-checked.
      () => this,
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
          (entry) => this.resumeQueuedTurn(entry),
        ),
      (execute) =>
        this.execCtrl.executeForegroundCommand(execute, (entry) => this.resumeQueuedTurn(entry)),
      shellExec,
      remoteCommandPolicy,
    );

    this.execCtrl = new SessionExecutionController(this.histTracker, this.skillRouter, {
      providerErrorGuidance: this.providerErrorGuidance,
      promptFileReferenceTag: this.promptFileReferenceTag,
      getSession: () => this.session!,
      getSessionOrThrow: () => this.getSessionOrThrow(),
      getCwd: () => this.getCwd(),
      getProjectAccess: () => this.projectAccess,
      getContextState: () => this.getContextState(),
      getExecutionWorkspaceSnapshot: () => this.getExecutionWorkspaceSnapshot(),
      emit: (event, ...args) =>
        this.emit(
          event as TInteractiveEventName,
          ...(args as Parameters<IInteractiveSessionEvents[TInteractiveEventName]>),
        ),
      persistSession: () => this.persistCurrentSession(),
      onWakeTurnFinalizing: (wakeTaskId, result, outcome, toolExecutions) =>
        this.finalizeSelfPacedIteration(wakeTaskId, result, outcome, toolExecutions),
      // SELFHOST-008 P2: adapter-gated — only wire capture when the surface supplied an `automaticMemory`
      // policy (absent ⇒ undefined ⇒ capture OFF, zero behavior change).
      ...(this.automaticMemory
        ? {
            captureMemory: (turn: { userMessage: string; assistantMessage: string }) =>
              this.turnMemory.capture(turn),
          }
        : {}),
      // SELFHOST-008 P3: adapter-gated — only wire per-turn recall when the surface supplied a
      // `recallMemory` policy (absent ⇒ undefined ⇒ recall OFF, startup-only injection unchanged).
      ...(this.recallMemory
        ? { recallMemory: (query: string) => this.turnMemory.recall(query) }
        : {}),
      // SCREEN-1993: adapter-gated — only wire the prompt-history append when the surface supplied
      // a writer (absent ⇒ undefined ⇒ nothing is written).
      ...(promptHistory
        ? {
            recordPrompt: createPromptHistoryRecorder({
              ...promptHistory,
              getSessionId: () => this.sessionId,
              notify: (message) =>
                this.histTracker.append(messageToHistoryEntry(createSystemMessage(message))),
            }),
          }
        : {}),
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

    if (this.initialized) {
      this.bgTracker.subscribe(this.session!);
      this.resumeSelfPacedLoops();
    }
    if (this.initialized) this.persistCurrentSession();
    this.resumeGoalIfActive();
  }

  protected getPendingRequest(): IExecutionPendingRequest | undefined {
    return this.promptRegistry.pending();
  }

  getProjectAccess(): TWorkspaceProjectAccess {
    return this.projectAccess;
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
    // CLI-1994: a fork is a copy, prompt included; the deferred path applies it after assembly.
    this.restoredSystemPrompt = restored.restoredSystemPrompt;
    if (this.session && this.startedAsFork && restored.restoredSystemPrompt !== undefined) {
      this.session.updateSystemMessage(restored.restoredSystemPrompt);
    }
    this.sandboxSnapshotId = this.startedAsFork ? undefined : restored.sandboxSnapshotId;
    // GOAL-001: a fork starts fresh; a true resume restores any in-flight goal so pursuit continues.
    if (!this.startedAsFork && restored.goal) this.goalController.restore(restored.goal);
    // SELFHOST-002: likewise restore an in-flight plan artifact on a true resume (not a fork).
    if (!this.startedAsFork && restored.plan) this.planController.restore(restored.plan);
    if (!this.startedAsFork) this.selfPacedLoops.restore(restored.sessionLoops);
    // SELFHOST-007: restore the active checkpoint branch on a true resume (graceful on manifest drift).
    if (!this.startedAsFork) this.histTracker.restoreActiveBranch(restored.activeBranch);
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
    const canPersistProjectPermission =
      createProjectPermissionPersistence(options.projectAccess, options.projectSettingsPaths) !==
      undefined;
    const result = await initializeInteractiveSessionAsync(options, {
      sandboxSnapshotId: this.sandboxSnapshotId,
      resumeSessionId: this.resumeSessionId,
      pendingRestoreMessages: this.pendingRestoreMessages,
      restoredSystemPrompt: this.restoredSystemPrompt,
      permissionHandler: (toolName, toolArgs) =>
        this.promptRegistry.requestPermission(toolName, toolArgs, canPersistProjectPermission),
      askHandler: this.askHandler,
      onTextDelta: (delta) => this.execCtrl.handleTextDelta(delta),
      onContextUpdate: (state) => this.emit('context_update', state),
      onCompactEvent: (event) => this.execCtrl.handleCompactEvent(event),
      onToolExecution: (event) => this.execCtrl.handleToolExecution(event),
      executeModelCommand: (command, args) => this.executeModelCommand(command, args),
      isModelCommandInvocable: (command) =>
        this.skillRouter.commandExecutor.isModelInvocable(command),
      commandDescriptors: this.skillRouter.commandExecutor.listModelInvocableCommands(),
      commandSemanticRoles: this.skillRouter.commandExecutor.getSemanticRoles(),
      setEditCheckpointStore: (store) => this.histTracker.setEditCheckpointStore(store),
    });
    this.session = result.session;
    this.agentsFileEntries = result.agentsFileEntries;
    this.projectNotesFileEntries = result.projectNotesFileEntries;
    this.rebuildSystemMessage = result.rebuildSystemMessage;
    this.autoCompactThresholdSource = result.autoCompactThresholdSource;
    this.histTracker.recordSystemContextFiles([
      ...result.agentsFileEntries,
      ...result.projectNotesFileEntries,
    ]);
    this.pendingRestoreMessages = null;
    this.initialized = true;
    this.bgTracker.subscribe(this.session);
    this.resumeSelfPacedLoops();
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

  /**
   * SELFHOST-008 P1R — the durable-memory port the `/memory` command host context reads/writes through.
   * Returns the surface-injected store if one was supplied, else a lazily-created + cached neutral fs
   * store over `cwd` (ONE shared instance, so command operations are the SSOT with startup + capture — no
   * split-brain).
   */
  getMemoryStore(): IMemoryStore {
    if (this.injectedMemoryStore) return this.injectedMemoryStore;
    throw new WorkspaceAuthorityRequiredError(
      'Project memory is unavailable without a workspace project authority.',
    );
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
    // REMOTE-007 D2: if a surface just detached and the gating event dropped to zero listeners,
    // reconcile any still-parked prompt of that kind fail-closed (a disconnect mid-prompt cannot hang).
    if (event === 'permission_request' || event === 'ask_request') {
      this.promptRegistry.reconcileOnDetach(event);
    }
  }

  private emit<E extends TInteractiveEventName>(
    event: E,
    ...args: Parameters<IInteractiveSessionEvents[E]>
  ): void {
    const handlers = this.listeners.get(event);
    if (handlers) for (const handler of handlers) handler(...args);
  }

  listRuntimeTools(): Promise<IToolSchema[]> {
    return this.runtimeTools.listRuntimeTools();
  }

  invokeRuntimeTool(
    name: string,
    parameters: TToolParameters,
    options?: { signal?: AbortSignal },
  ): Promise<IToolExecutionResult> {
    return this.runtimeTools.invokeRuntimeTool(name, parameters, options);
  }

  async submit(
    input: string,
    displayInput?: string,
    rawInput?: string,
    options: ISubmitOptions = {},
  ): Promise<ITurnHandle> {
    // This public attribution surface is not source admission. Reserve the namespace so an SDK
    // caller cannot replace an authenticated external sender's pending queue entry by id collision.
    if (options.turnSource === 'external' || options.driverId?.startsWith('external:')) {
      throw new Error('external event turns must use an explicitly opened external source');
    }
    return this.submitNewTurn(input, displayInput, rawInput, publicTurnOptions(options));
  }

  /** Explicit host opt-in for one authenticated external source; MCP configuration alone cannot enable it. */
  async openExternalEventSource(
    options: IExternalEventSourceOptions,
  ): Promise<IExternalEventSource> {
    await this.ensureInitialized();
    if (this.execCtrl.shuttingDown) throw new Error('Interactive session is shutting down.');
    this.externalEventIngress ??= new ExternalEventIngress({
      getPermissionMode: () => this.getSessionOrThrow().getPermissionMode(),
      addPermissionModeGuard: (guard) => this.getSessionOrThrow().addPermissionModeGuard(guard),
      submit: (input, turnOptions) => this.submitNewTurn(input, undefined, undefined, turnOptions),
    });
    return this.externalEventIngress.open(options);
  }
  private async submitNewTurn(
    input: string,
    displayInput?: string,
    rawInput?: string,
    options: ITurnOptions = {},
  ): Promise<ITurnHandle> {
    return submitNewTurn(input, displayInput, rawInput, options, {
      execCtrl: this.execCtrl,
      ensureInitialized: () => this.ensureInitialized(),
      executeAcceptedTurn: (entry) => this.executeAcceptedTurn(entry),
      emitDropped: (driverId, maxDepth) =>
        this.emit(
          'user_message',
          `[remote-control] input from ${driverId} was dropped — the co-drive queue is full ` +
            `(max ${maxDepth}). Try again after the current work settles.`,
        ),
      isWakeStopped: (wakeTaskId) => this.stoppedWakeTaskIds.has(wakeTaskId),
    });
  }
  private async resumeQueuedTurn(entry: IQueuedInput): Promise<void> {
    if (this.execCtrl.shuttingDown) throw new Error('Interactive session is shutting down.');
    await this.executeAcceptedTurn(entry);
  }

  private async executeAcceptedTurn(entry: IQueuedInput): Promise<void> {
    const identity = this.parseSelfPacedWakeId(entry.options.wakeTaskId);
    const selfPaced = identity ? this.selfPacedLoops.get(identity.loopId) : undefined;
    const scheduled = entry.options.wakeTaskId
      ? this.getBackgroundTaskManager()?.get(entry.options.wakeTaskId)
      : undefined;
    // A stale queued wake must not read a default file or stop a newer generation on load failure.
    if (
      identity &&
      (!selfPaced ||
        !markSelfPacedLoopRunning(selfPaced, identity.generation, Date.now()) ||
        this.sessionLoopsDisabled ||
        this.selfPacedLoops.isSuspended())
    ) {
      this.execCtrl.turns.refuse(entry.turnId, 'cancelled');
      this.execCtrl.wakeTaskIds.delete(entry.options.wakeTaskId!);
      return;
    }
    let input = entry.input;
    const liveFixedDefault =
      scheduled?.metadata?.['sessionLoopDefaultPrompt'] === true &&
      scheduled.schedule?.agentInstruction === scheduled.metadata['sessionLoopDefaultPromptSeed'];
    if (selfPaced?.useDefaultPrompt || liveFixedDefault) {
      try {
        if (!this.resolveDefaultLoopPrompt)
          throw new Error('Default loop prompt resolver is unavailable.');
        const resolved = this.resolveDefaultLoopPrompt().trim();
        if (!resolved || Buffer.byteLength(resolved, 'utf8') > 4_096) {
          throw new Error('Default loop prompt must contain 1–4096 UTF-8 bytes.');
        }
        input = resolved;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (identity) {
          try {
            await this.stopSelfPacedLoop(
              identity.loopId,
              'Default loop prompt could not be loaded',
            );
          } catch (stopError) {
            this.reportBackgroundError(
              stopError instanceof Error ? stopError : new Error(String(stopError)),
              'session-loop',
            );
          }
        }
        this.execCtrl.turns.fail(entry.turnId, failure);
        if (entry.options.wakeTaskId) this.execCtrl.wakeTaskIds.delete(entry.options.wakeTaskId);
        this.reportBackgroundError(failure, 'session-loop');
        return;
      }
    }
    const displayInput =
      selfPaced?.useDefaultPrompt || liveFixedDefault ? input : entry.displayInput;
    if (identity) {
      const current = selfPaced;
      const running = current && markSelfPacedLoopRunning(current, identity.generation, Date.now());
      if (!running || this.sessionLoopsDisabled || this.selfPacedLoops.isSuspended()) {
        this.execCtrl.turns.refuse(entry.turnId, 'cancelled');
        this.execCtrl.wakeTaskIds.delete(entry.options.wakeTaskId!);
        return;
      }
      try {
        this.selfPacedLoops.commit(running);
      } catch (error) {
        this.execCtrl.turns.fail(
          entry.turnId,
          error instanceof Error ? error : new Error(String(error)),
        );
        this.execCtrl.wakeTaskIds.delete(entry.options.wakeTaskId!);
        throw error;
      }
    }
    await this.execCtrl.executePrompt(
      input,
      displayInput,
      entry.rawInput,
      this.agentsFileEntries,
      this.projectNotesFileEntries,
      this.rebuildSystemMessage,
      (agents, claude) => {
        this.agentsFileEntries = agents;
        this.projectNotesFileEntries = claude;
        this.histTracker.recordSystemContextFiles([...agents, ...claude]);
      },
      (queuedEntry) => this.resumeQueuedTurn(queuedEntry),
      entry.turnId,
      entry.options,
    );
  }

  // REMOTE-014 E5: active-turn attribution; null when idle.
  getActiveDriverId(): TDriverId | null {
    return this.execCtrl.activeDriverId;
  }

  // REMOTE-014 E5: queued co-drive input count.
  getPendingCount(): number {
    return this.execCtrl.pendingCount();
  }

  /**
   * FLOW-002: inject a background wake; coalesce repeated in-flight wakes by source task id.
   *
   * Issue #2354: the woken turn is an ordinary `submitNewTurn` and runs under THIS session's
   * permission configuration (mode, rules, hooks, consent) — a schedule carries no policy of its own,
   * by the decision recorded on `IScheduledBackgroundTaskRequest`. `turnSource: 'agent-wakeup'` is
   * how a consumer tells it apart from a typed prompt; it does not change what the turn may do.
   */
  requestWakeup(instruction: string, sourceTaskId: string): boolean {
    if (this.execCtrl.shuttingDown) return false;
    const task = this.getBackgroundTaskManager()?.get(sourceTaskId);
    if (task?.metadata?.['sessionLoopSelfPaced'] === true) {
      return this.admitSelfPacedWake(sourceTaskId, task.metadata);
    }
    const blocked = sessionLoopBlockReason(task, Date.now(), this.sessionLoopsDisabled);
    if (blocked) {
      this.stoppedWakeTaskIds.add(sourceTaskId);
      void this.cancelBackgroundTask(sourceTaskId, `Session loop ${blocked}`).catch((error) =>
        this.reportBackgroundError(
          error instanceof Error ? error : new Error(String(error)),
          'session-loop',
        ),
      );
      return false;
    }
    const firstWakeEligibility = sessionLoopFirstWakeEligibility(task, Date.now());
    if (firstWakeEligibility === 'invalid') {
      this.stoppedWakeTaskIds.add(sourceTaskId);
      void this.cancelBackgroundTask(
        sourceTaskId,
        'Invalid session loop first-fire boundary',
      ).catch((error) =>
        this.reportBackgroundError(
          error instanceof Error ? error : new Error(String(error)),
          'session-loop',
        ),
      );
      return false;
    }
    if (firstWakeEligibility === 'early') return false;
    if (this.stoppedWakeTaskIds.has(sourceTaskId)) return false;
    if (this.execCtrl.wakeTaskIds.has(sourceTaskId)) return false;
    this.execCtrl.wakeTaskIds.add(sourceTaskId);
    // RUNTIME-26: the wake turn runs detached — route its rejection to reportBackgroundError instead of
    // letting it vanish (e.g. a turn error, or the "shutting down" throw when a wake races teardown).
    void this.submitNewTurn(instruction, undefined, undefined, {
      turnSource: 'agent-wakeup',
      wakeTaskId: sourceTaskId,
    }).catch((error) => {
      this.execCtrl.wakeTaskIds.delete(sourceTaskId);
      if (error instanceof StoppedWakeSubmissionError) return;
      this.reportBackgroundError(
        error instanceof Error ? error : new Error(String(error)),
        'agent-wakeup',
      );
    });
    return true;
  }

  private armSessionLoopExpiry(task: IBackgroundTaskState, retryDelayMs?: number): void {
    const expiry = sessionLoopExpiry(task);
    if (expiry === undefined) return;
    const previous = this.sessionLoopExpiryTimers.get(task.id);
    if (previous) clearTimeout(previous);
    const delay = retryDelayMs ?? Math.max(0, Number.isFinite(expiry) ? expiry - Date.now() : 0);
    const timer = setTimeout(() => {
      this.sessionLoopExpiryTimers.delete(task.id);
      const live = this.getBackgroundTaskManager()?.get(task.id);
      if (
        !live ||
        live.status === 'cancelled' ||
        live.status === 'completed' ||
        live.status === 'failed'
      ) {
        return;
      }
      void this.cancelBackgroundTask(task.id, 'Session loop expired').catch((error) => {
        this.reportBackgroundError(
          error instanceof Error ? error : new Error(String(error)),
          'session-loop',
        );
        if (!this.execCtrl.shuttingDown) this.armSessionLoopExpiry(live, 60_000);
      });
    }, delay);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    this.sessionLoopExpiryTimers.set(task.id, timer);
  }

  override listSchedules(): IBackgroundTaskState[] {
    return [
      ...super.listSchedules(),
      ...this.bgTracker.listHeldSessionLoops().filter((task) => task.kind === 'scheduled'),
    ];
  }

  private assertNotSelfPacedTimer(taskId: string): void {
    if (this.getBackgroundTaskManager()?.get(taskId)?.metadata?.['sessionLoopSelfPaced'] === true) {
      throw new Error('This timer belongs to a self-paced loop; manage it with /loop instead.');
    }
  }

  override async pauseSchedule(taskId: string): Promise<void> {
    this.assertNotSelfPacedTimer(taskId);
    await super.pauseSchedule(taskId);
  }

  override async resumeSchedule(taskId: string): Promise<void> {
    this.assertNotSelfPacedTimer(taskId);
    await super.resumeSchedule(taskId);
  }

  override async editSchedule(
    taskId: string,
    patch: Parameters<InteractiveSessionBase['editSchedule']>[1],
  ): Promise<void> {
    this.assertNotSelfPacedTimer(taskId);
    await super.editSchedule(taskId, patch);
  }

  /** Session-owned self-paced loops remain addressable after a one-shot timer has completed. */
  listSelfPacedLoops(): readonly ISessionLoopState[] {
    return this.selfPacedLoops.list();
  }

  async createSelfPacedLoop(
    instruction: string,
    options: { useDefaultPrompt?: boolean } = {},
  ): Promise<ISessionLoopState> {
    await this.ensureInitialized();
    if (this.sessionLoopsDisabled) throw new Error('Session loops are disabled by the host.');
    if (!this.sessionStore) throw new Error('A session store is required for a resumable loop.');
    const fixedCount = this.listSchedules().filter(
      (task) =>
        task.metadata?.['sessionLoop'] === true &&
        task.metadata?.['sessionLoopSelfPaced'] !== true &&
        task.status !== 'cancelled' &&
        task.status !== 'completed' &&
        task.status !== 'failed',
    ).length;
    const dynamicCount = this.selfPacedLoops
      .list()
      .filter((state) => state.phase !== 'stopped' && state.phase !== 'expired').length;
    if (fixedCount + dynamicCount >= 3) {
      throw new Error('At most 3 active loops are allowed. Stop one before creating another.');
    }
    const state = createSelfPacedLoopState(
      `loop_${randomUUID()}`,
      instruction,
      Date.now(),
      options,
    );
    this.selfPacedLoops.commit(state);
    this.submitSelfPacedIteration(state);
    return state;
  }

  async stopSelfPacedLoop(loopId: string, reason = 'Loop stopped by user'): Promise<void> {
    if (!this.initialized) await this.ensureInitialized();
    const live = this.selfPacedLoops.get(loopId);
    if (!live) throw new Error(`Self-paced loop not found: ${loopId}`);
    const stopped = stopSelfPacedLoopState(live, reason);
    if (!stopped) return;
    this.selfPacedLoops.commit(stopped);
    const wakeId = this.selfPacedWakeId(live);
    this.stoppedWakeTaskIds.add(wakeId);
    this.execCtrl.removePendingWake(wakeId);
    this.execCtrl.wakeTaskIds.delete(wakeId);
    const timerId = this.selfPacedTimerIds.get(loopId);
    this.selfPacedTimerIds.delete(loopId);
    if (timerId) await this.bgTracker.cancelTask(timerId, reason);
  }

  private selfPacedWakeId(state: ISessionLoopState): string {
    return `self-paced:${state.loopId}:${state.generation}`;
  }

  private parseSelfPacedWakeId(
    wakeId: string | undefined,
  ): { loopId: string; generation: number } | null {
    const match = /^self-paced:(loop_[^:]+):(\d+)$/.exec(wakeId ?? '');
    return match ? { loopId: match[1]!, generation: Number(match[2]) } : null;
  }

  private async finalizeSelfPacedIteration(
    wakeId: string,
    result: IExecutionResult | undefined,
    outcome: 'success' | 'failure' | 'interrupted',
    toolExecutions: readonly { name: string; args: unknown; success: boolean }[],
  ): Promise<void> {
    const identity = this.parseSelfPacedWakeId(wakeId);
    if (!identity) return;
    const current = this.selfPacedLoops.get(identity.loopId);
    if (!current) return;
    const decision =
      outcome === 'success' && result
        ? extractSelfPacedLoopDecision(result.toolSummaries, toolExecutions)
        : { action: 'stop' as const };
    const next = finishSelfPacedLoopTurn(current, identity.generation, decision, Date.now());
    if (!next) return; // A user stop won while the model was running.
    this.selfPacedLoops.commit(next);
    if (next.phase === 'waiting') {
      try {
        await this.armSelfPacedTimer(next);
      } catch (error) {
        await this.stopSelfPacedLoop(next.loopId, 'Could not arm the next timer');
        throw error;
      }
    }
    // Timer creation can yield to a user stop; describe the committed state, not a stale successor.
    const settled = this.selfPacedLoops.get(next.loopId) ?? next;
    const receipt =
      settled.phase === 'waiting'
        ? `Loop ${settled.loopId}: next check in ${settled.delaySeconds}s (${settled.reason}); eligible at ${settled.nextAllowedAt}.`
        : `Loop ${settled.loopId} ${settled.phase}: ${settled.terminalReason}.`;
    this.histTracker.append(messageToHistoryEntry(createSystemMessage(receipt)));
    this.persistCurrentSession();
  }

  private async armSelfPacedTimer(state: ISessionLoopState): Promise<void> {
    if (state.phase !== 'waiting' || !state.nextAllowedAt) return;
    const manager = this.bgTracker.getManagerOrThrow();
    const task = await manager.spawn({
      kind: 'scheduled',
      label: `Loop: ${state.instruction.slice(0, 48)}`,
      mode: 'background',
      parentSessionId: this.getSessionOrThrow().getSessionId(),
      depth: 0,
      cwd: this.getCwd(),
      cronExpression: state.nextAllowedAt,
      agentInstruction: state.instruction,
      metadata: {
        sessionLoop: true,
        sessionLoopSelfPaced: true,
        sessionLoopId: state.loopId,
        sessionLoopGeneration: state.generation,
        sessionLoopExpiresAt: state.expiresAt,
      },
    });
    const current = this.selfPacedLoops.get(state.loopId);
    if (
      !current ||
      current.phase !== 'waiting' ||
      current.generation !== state.generation ||
      task.status !== 'sleeping'
    ) {
      await manager.cancel(task.id, 'Stale self-paced loop timer');
      if (current?.phase === 'waiting' && current.generation === state.generation) {
        throw new Error('Self-paced loop could not arm a resumable timer.');
      }
      return;
    }
    this.selfPacedTimerIds.set(state.loopId, task.id);
  }

  private admitSelfPacedWake(taskId: string, metadata: Record<string, unknown>): boolean {
    const loopId = metadata['sessionLoopId'];
    const generation = metadata['sessionLoopGeneration'];
    if (
      typeof loopId !== 'string' ||
      !Number.isSafeInteger(generation) ||
      this.selfPacedWakeClaims.has(taskId)
    ) {
      return false;
    }
    this.selfPacedWakeClaims.add(taskId);
    try {
      const current = this.selfPacedLoops.get(loopId);
      if (!current || this.sessionLoopsDisabled || this.selfPacedLoops.isSuspended()) return false;
      const claimed = claimSelfPacedLoopWake(current, generation as number, Date.now());
      if (!claimed) return false;
      this.selfPacedLoops.commit(claimed);
      this.selfPacedTimerIds.delete(loopId);
      this.submitSelfPacedIteration(claimed);
      return true;
    } catch (error) {
      this.reportBackgroundError(
        error instanceof Error ? error : new Error(String(error)),
        'session-loop',
      );
      return false;
    } finally {
      this.selfPacedWakeClaims.delete(taskId);
    }
  }

  private resumeSelfPacedLoops(): void {
    for (const state of this.selfPacedLoops.list()) {
      // A host kill switch pauses restoration; it must not erase an unexpired persisted loop.
      if (this.sessionLoopsDisabled && Date.now() < Date.parse(state.expiresAt)) continue;
      const next = recoverSelfPacedLoopState(state, Date.now());
      try {
        if (next && next.revision !== state.revision) this.selfPacedLoops.commit(next);
        const current = next ?? state;
        if (current.phase === 'waiting' && !this.sessionLoopsDisabled) {
          void this.armSelfPacedTimer(current).catch(async (error: unknown) => {
            try {
              await this.stopSelfPacedLoop(current.loopId, 'Could not restore timer');
            } catch (stopError) {
              this.reportBackgroundError(
                stopError instanceof Error ? stopError : new Error(String(stopError)),
                'session-loop',
              );
            }
            this.reportBackgroundError(
              error instanceof Error ? error : new Error(String(error)),
              'session-loop',
            );
          });
        }
      } catch (error) {
        this.reportBackgroundError(
          error instanceof Error ? error : new Error(String(error)),
          'session-loop',
        );
      }
    }
  }

  private submitSelfPacedIteration(state: ISessionLoopState): void {
    const wakeId = this.selfPacedWakeId(state);
    if (this.execCtrl.wakeTaskIds.has(wakeId)) return;
    this.execCtrl.wakeTaskIds.add(wakeId);
    const input =
      `${state.instruction}\n\nAt the end of this self-paced loop iteration, call ` +
      '`report_loop_decision` exactly once: choose stop, or continue with a 60–3600 second delay and reason.';
    void this.submitNewTurn(input, state.instruction, undefined, {
      turnSource: 'agent-wakeup',
      wakeTaskId: wakeId,
    })
      .then((handle) => {
        void handle.completed.catch((error: unknown) =>
          this.handleSelfPacedSubmissionFailure(state, error),
        );
      })
      .catch((error: unknown) => this.handleSelfPacedSubmissionFailure(state, error));
  }

  private handleSelfPacedSubmissionFailure(state: ISessionLoopState, error: unknown): void {
    const wakeId = this.selfPacedWakeId(state);
    this.execCtrl.wakeTaskIds.delete(wakeId);
    const current = this.selfPacedLoops.get(state.loopId);
    if (current?.generation !== state.generation || current.phase !== 'pending') return;
    const reason = isTurnNotRunError(error)
      ? `Self-paced loop turn was ${error.reason}`
      : `Self-paced loop turn failed: ${error instanceof Error ? error.message : String(error)}`;
    void this.stopSelfPacedLoop(state.loopId, reason).catch((stopError: unknown) =>
      this.reportBackgroundError(
        stopError instanceof Error ? stopError : new Error(String(stopError)),
        'session-loop',
      ),
    );
    this.reportBackgroundError(
      error instanceof Error ? error : new Error(String(error)),
      'session-loop',
    );
  }

  override async cancelBackgroundTask(taskId: string, reason?: string): Promise<void> {
    const task = this.getBackgroundTaskManager()?.get(taskId);
    if (task?.metadata?.['sessionLoopSelfPaced'] === true) {
      const loopId = task.metadata['sessionLoopId'];
      if (typeof loopId !== 'string') throw new Error('Self-paced timer has no loop identity.');
      await this.stopSelfPacedLoop(loopId, reason ?? 'Loop timer cancelled');
      return;
    }
    // Admission must stop before any await: an already-fired wake may still be awaiting initialization.
    this.stoppedWakeTaskIds.add(taskId);
    let durableStop = false;
    try {
      // An accepted loop already initialized this session. Do not yield before its synchronous
      // stop write and queue removal: an active turn could drain the queued wake in that gap.
      if (!this.initialized) await this.ensureInitialized();
      const heldTask = this.bgTracker.getHeldSessionLoop(taskId);
      const trackedTask = this.bgTracker.getTask(taskId) ?? heldTask;
      const loopId = trackedTask?.metadata?.['sessionLoopId'];
      if (
        trackedTask?.metadata?.['sessionLoop'] === true &&
        (typeof loopId !== 'string' || !this.pendingLoopCreations.has(loopId))
      ) {
        this.pendingLoopStops.add(taskId);
        this.persistCurrentSession(true);
        durableStop = true;
      }
      this.execCtrl.removePendingWake(taskId);
      this.execCtrl.wakeTaskIds.delete(taskId);
      if (heldTask) this.bgTracker.markHeldSessionLoopCancelled(taskId);
      else await this.bgTracker.cancelTask(taskId, reason);
      const expiryTimer = this.sessionLoopExpiryTimers.get(taskId);
      if (expiryTimer) clearTimeout(expiryTimer);
      this.sessionLoopExpiryTimers.delete(taskId);
    } catch (error) {
      if (!durableStop) this.stoppedWakeTaskIds.delete(taskId);
      throw error;
    } finally {
      // If cancellation failed after the durable tombstone, keep both guards so a later snapshot
      // cannot revive the loop and a stray timer cannot submit another turn.
      if (
        !durableStop ||
        this.bgTracker.getTask(taskId)?.status === 'cancelled' ||
        this.bgTracker.getHeldSessionLoop(taskId)?.status === 'cancelled'
      ) {
        this.pendingLoopStops.delete(taskId);
      }
    }
  }

  override async spawnScheduledWake(input: {
    label: string;
    cronExpression: string;
    agentInstruction: string;
    sessionLoop?: boolean;
    sessionLoopId?: string;
    sessionLoopDefaultPrompt?: boolean;
    sessionLoopFirstAllowedAt?: string;
    sessionLoopExpiresAt?: string;
  }): Promise<IBackgroundTaskState> {
    await this.ensureInitialized();
    if (!input.sessionLoop) return super.spawnScheduledWake(input);
    if (this.sessionLoopsDisabled) throw new Error('Session loops are disabled by the host.');
    if (!this.sessionStore) throw new Error('A session store is required for a resumable loop.');
    if (!input.sessionLoopId) throw new Error('A stable loop ID is required for a resumable loop.');
    const sessionLoopExpiresAt = validatedSessionLoopExpiry(input.sessionLoopExpiresAt, Date.now());
    if (input.sessionLoopFirstAllowedAt !== undefined) {
      const firstAllowedMs = Date.parse(input.sessionLoopFirstAllowedAt);
      if (!Number.isFinite(firstAllowedMs) || firstAllowedMs >= Date.parse(sessionLoopExpiresAt)) {
        throw new Error('Session loop first-fire boundary is invalid or beyond its expiry.');
      }
    }
    this.pendingLoopCreations.add(input.sessionLoopId);
    let task: IBackgroundTaskState | undefined;
    try {
      task = await super.spawnScheduledWake({ ...input, sessionLoopExpiresAt });
      if (task.status !== 'sleeping' && task.status !== 'paused') {
        throw new Error(
          'Loop could not start a resumable timer; retry after capacity is available.',
        );
      }
      this.persistCurrentSession(true, input.sessionLoopId);
      this.armSessionLoopExpiry(task);
      return task;
    } catch (error) {
      // A loop whose creation was not durably acknowledged must not keep firing in this process.
      if (task) await this.cancelBackgroundTask(task.id, 'Loop creation was not acknowledged');
      throw error;
    } finally {
      this.pendingLoopCreations.delete(input.sessionLoopId);
    }
  }

  abort(): void {
    // REMOTE-014 E5: clearing the WHOLE shared queue is an OWNER-PRINCIPLE-legit cross-driver effect — emit an
    // attributed notice so a co-driver whose queued input was cleared sees why (and every wakeTaskId is freed).
    this.notifyQueueCleared(this.execCtrl.clearPendingQueue(), 'aborted');
    // REMOTE-007 D3: deny/cancel every parked prompt so an aborted turn never leaves the enforcer's
    // `await` (or a wrapped tool) hanging — reproduces the TUI's cancel-all-permissions/actions semantics.
    this.promptRegistry.drain();
    this.session?.abort();
  }

  override cancelQueue(): void {
    this.notifyQueueCleared(this.execCtrl.clearPendingQueue(), 'cancelled');
    this.promptRegistry.drain();
  }

  /** REMOTE-014 E5: emit an attributed system notice when a whole-queue clear dropped other drivers' input. */
  private notifyQueueCleared(clearedDrivers: TDriverId[], verb: 'aborted' | 'cancelled'): void {
    const others = clearedDrivers.filter((d) => d !== OWNER_DRIVER_ID);
    if (others.length > 0) {
      this.emit(
        'user_message',
        `[remote-control] queued input from ${others.join(', ')} was ${verb} (queue cleared).`,
      );
    }
  }

  shutdown(options: IInteractiveSessionShutdownOptions = {}): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.execCtrl.shuttingDown = true;
    this.externalEventIngress?.closeAll();
    for (const timer of this.sessionLoopExpiryTimers.values()) clearTimeout(timer);
    this.sessionLoopExpiryTimers.clear();
    this.shutdownPromise = (async () => {
      await this.ensureInitialized();
      this.execCtrl.clearPendingQueue();
      const session = this.session;
      session?.abort();
      const moduleShutdownErrors = await this.skillRouter.shutdownModules();
      await this.runtimeTools.drain();
      await this.getBackgroundTaskManager()?.shutdown(options.message ?? 'Session shutdown');
      this.bgTracker.dispose();
      await this.captureSandboxSnapshot();
      this.persistCurrentSession();
      await session?.shutdown({ reason: options.reason ?? 'other' });
      // REMOTE-007 D3: drain before dropping listeners so any prompt still parked at shutdown settles
      // fail-closed (the awaiting checkPermission/tool unblocks) rather than hanging on a cleared emitter.
      this.promptRegistry.drain();
      this.listeners.clear();
      if (moduleShutdownErrors.length > 0) {
        throw new AggregateError(moduleShutdownErrors, 'Command module shutdown failed');
      }
    })();
    return this.shutdownPromise;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /** Passive, content-free host observation; never registers an answering prompt listener. */
  getLocalActivityStatus(): 'working' | 'needs-input' | 'idle' | undefined {
    if (!this.initialized || this.execCtrl.shuttingDown) return undefined;
    if (this.promptRegistry.pendingCount > 0) return 'needs-input';
    return this.execCtrl.executing ? 'working' : 'idle';
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
   * The ONE way a preset field reaches the live prompt — recompose from the tracked context entries
   * plus the override. No-op before init. Extracted by ARCH-040: PRESET-014 and PRESET-017 were the
   * same five lines twice, and a third copy is how the next one diverges.
   */
  private rebuildLivePrompt(overrides: TLivePromptOverrides): void {
    if (this.rebuildSystemMessage === null) return;
    const agents = this.agentsFileEntries.map((e) => e.content).join('\n\n');
    const notes = this.projectNotesFileEntries.map((e) => e.content).join('\n\n');
    const rebuilt = this.rebuildSystemMessage(agents, notes, overrides);
    this.getSessionOrThrow().updateSystemMessage(rebuilt);
  }

  applyPersona(persona: string): void {
    this.rebuildLivePrompt({ persona });
  }

  getActiveOutputStyleId(): string {
    return this.activeOutputStyleId;
  }

  applyOutputStyle(style: IOutputStylePrompt): void {
    this.activeOutputStyleId = style.id;
    this.rebuildLivePrompt({ outputStyle: style });
  }

  applySelfVerification(enabled: boolean): void {
    this.rebuildLivePrompt({ selfVerification: enabled });
  }

  applyResponseLanguage(language: string): void {
    this.rebuildLivePrompt({ language });
  }

  applyPresetSystemPrompt(text: string): void {
    this.rebuildLivePrompt({ presetSystemPrompt: text });
  }

  /**
   * PRESET-015: re-apply a preset's command-module selection to the live session by delegating to
   * the skill router, which re-filters the session-start module set and rebuilds the executor.
   * INFRA-032: returns any `enabled`/`disabled` names that matched no live command module so the
   * `/preset` command can surface them as a non-fatal notice.
   */
  applyCommandModuleSelection(
    enabled: readonly string[] | undefined,
    disabled: readonly string[] | undefined,
  ): readonly IUnknownCommandModuleName[] {
    return this.skillRouter.reapplyCommandModuleSelection(enabled, disabled);
  }

  getAgentJobCapability(): IAgentJobHostContext {
    return this;
  }

  /**
   * CMD-004: the command "ask the user" port, or undefined when no interactive surface can answer
   * (headless/automation) — a command must treat absence as "no human available", never a silent
   * guess. The model-invocation guard lives in {@link createUserInteractionPort}.
   *
   * REMOTE-007 D4a: the framework's ask default is now always defined, so PRESENCE is gated on the live
   * `ask_request` listener count (evaluated per call — the port is rebuilt each call). Zero subscribed
   * surfaces ⇒ `undefined`, preserving the load-bearing headless "no-human ⇒ proceed" contract
   * (`/exit` exits, `/clear` clears); a subscribed TUI/WS/WebRTC surface ⇒ a live port. This is
   * orthogonal to the tool `setAskHandler` seam, which stays always-present (fail-closed on zero listeners).
   */
  getUserInteraction(): IUserInteraction | undefined {
    if ((this.listeners.get('ask_request')?.size ?? 0) === 0) return undefined;
    return createUserInteractionPort(this.askHandler, () => this.getCommandInvocationSource());
  }

  /**
   * REMOTE-007: answer a pending `permission_request` by id (any attached surface; first resolve wins,
   * later resolves for a settled id are no-ops). Idempotent and safe for an unknown/settled id.
   */
  resolvePermission(
    id: string,
    result: TPermissionResultValue,
    answererDriverId?: TDriverId,
  ): void {
    // REMOTE-014 E5: a LOCAL answer (no explicit id) is the owner; a remote transport injects its bound id.
    this.promptRegistry.resolvePermission(id, result, answererDriverId ?? OWNER_DRIVER_ID);
  }

  /** REMOTE-007: answer a pending `ask_request` by id (see {@link resolvePermission}). REMOTE-014: `answererDriverId`. */
  resolveAsk(id: string, response: TActionResponse, answererDriverId?: TDriverId): void {
    this.promptRegistry.resolveAsk(id, response, answererDriverId ?? OWNER_DRIVER_ID);
  }

  /** TERM-001 — see {@link SessionTerminalHandoffGate}. */
  canHandoffTerminal(): boolean {
    return this.terminalHandoffGate.canHandoffTerminal();
  }

  /** TERM-001 — see {@link SessionTerminalHandoffGate}. */
  runWithTerminal<T>(fn: () => Promise<T>): Promise<T> {
    return this.terminalHandoffGate.runWithTerminal(fn);
  }

  /**
   * CLI-1994: write a COPY of this conversation under a fresh id and a distinct name. The copy
   * carries the messages, the assembled system message, the tool schemas and the transcript; it
   * drops what the startup `--fork-session` drops. This session is untouched — the caller (`/fork`)
   * starts the background job that resumes the copy, and attaching to it later is a view switch,
   * never a merge back.
   */
  async forkSession(input: { name?: string } = {}): Promise<{ sessionId: string; name: string }> {
    await this.ensureInitialized();
    const session = this.getSessionOrThrow();
    if (!this.sessionStore) {
      throw new Error('Cannot fork: this session has no session store to write the copy to.');
    }
    return writeForkedSessionRecord({
      source: session,
      fullHistory: () => this.getFullHistory(),
      sessionStore: this.sessionStore,
      requestedName: input.name,
      sourceName: this.sessionName,
      sourceId: session.getSessionId(),
      cwd: this.getCwd(),
    });
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
    this.emit('history_cleared'); // CMD-004 Stage E: broadcast — every surface refreshes its transcript
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
      let id: string;
      try {
        id = this.getSessionOrThrow().getSessionId();
      } catch {
        return; // Session not initialized yet — nothing on disk to rename.
      }
      // TRANS-007: the store outcome is NOT swallowed. It used to sit inside the catch above, so a
      // record this build cannot read made the rename a silent no-op.
      persistSessionRename(this.sessionStore, id, name);
    }
  }

  private getBackgroundTaskManager(): IBackgroundTaskManager | undefined {
    if (!this.session) return undefined;
    return (
      retrieveSessionBackgroundTaskManager(this.session) ??
      retrieveAgentToolDeps(this.session)?.backgroundTaskManager
    );
  }

  /**
   * Surface an error that happened OUTSIDE the turn boundary (background task, catalog
   * refresh, persistence, un-caught promise) into the conversation (ERR-001 G1). The entry
   * carries `metadata.kind: 'error'` so transports render it as a styled error block, and the
   * 'error' event drives transport error state. The session stays fully usable.
   */
  reportBackgroundError(error: Error, source = 'background'): void {
    const message = humanizeApiError(error, this.providerErrorGuidance);
    this.histTracker.append(
      messageToHistoryEntry(
        createSystemMessage(`Error: ${message}`, { metadata: { kind: 'error', source } }),
      ),
    );
    this.emit('error', error);
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

  private persistCurrentSession(
    strict = false,
    acceptedLoopId?: string,
    loopStateOverride?: readonly ISessionLoopState[],
  ): void {
    if (!this.sessionStore || !this.session) {
      if (strict) throw new Error('A session store is required for a resumable loop.');
      return;
    }
    const bgState = this.bgTracker.getState();
    const histState = this.histTracker.getState();
    persistSession(
      this.sessionStore,
      this.session,
      this.sessionName,
      this.cwd ?? '',
      histState.history,
      {
        tasks: bgState.tasks
          .filter((task) => {
            const loopId = task.metadata?.['sessionLoopId'];
            return (
              typeof loopId !== 'string' ||
              !this.pendingLoopCreations.has(loopId) ||
              (strict && loopId === acceptedLoopId)
            );
          })
          .map((task) =>
            this.pendingLoopStops.has(task.id) ? { ...task, status: 'cancelled' as const } : task,
          ),
        events: bgState.taskEvents,
        groups: bgState.groups,
        groupEvents: bgState.groupEvents,
      },
      { events: histState.memoryEvents, usedReferences: histState.usedMemoryReferences },
      { events: histState.skillActivationEvents },
      { references: histState.contextReferences },
      { snapshotId: this.sandboxSnapshotId },
      this.goalController.getState() ?? undefined,
      this.planController.getState() ?? undefined,
      // SELFHOST-007: persist the active branch pointer so a branch survives --resume.
      this.histTracker.getActiveBranchPointer(),
      strict,
      loopStateOverride ?? this.selfPacedLoops.snapshotForOrdinarySave(),
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

  /**
   * SELFHOST-002: start a plan — draft it (phase `planning`) for review. Establishes the existing
   * `plan` permission mode so drafting is genuinely read-only (the mutation block), making the
   * "read-only until approved" contract true regardless of the mode the session was in.
   * {@link approvePlan} flips to `acceptEdits`. Returns the seeded artifact; throws on empty objective.
   */
  async setPlan(objective: string, steps: readonly string[] = []): Promise<IPlanArtifact> {
    await this.ensureInitialized();
    const session = this.getSessionOrThrow();
    const plan = this.planController.start(objective, steps);
    session.setPermissionMode('plan'); // drafting is read-only until approved
    this.emit('plan_event', { type: 'plan_created', plan });
    this.persistCurrentSession();
    return plan;
  }

  /** SELFHOST-002: the current plan artifact, or `null` when no plan has been started. */
  getPlanState(): IPlanArtifact | null {
    return this.planController.getState();
  }

  /**
   * SELFHOST-002: approve the current plan. The controller decides the mode flip (`plan →
   * acceptEdits`); THIS method applies it via `setPermissionMode` — the controller never does.
   * Approving auto-applies edits while shell stays per-call confirmed (`MODE_POLICY.acceptEdits`).
   */
  approvePlan(): IPlanArtifact {
    const session = this.getSessionOrThrow(); // fail fast before mutating controller phase
    if (this.planController.getState()?.phase === 'planning') {
      this.planController.requestApproval();
    }
    const decision = this.planController.approve();
    session.setPermissionMode(decision.nextMode);
    this.emit('plan_event', { type: 'plan_approved', plan: decision.plan });
    this.persistCurrentSession();
    return decision.plan;
  }

  /** SELFHOST-002: revert the plan to drafting, returning permission mode to `plan`. */
  revertPlan(): IPlanArtifact {
    const session = this.getSessionOrThrow(); // fail fast before mutating controller phase
    const decision = this.planController.revert();
    session.setPermissionMode(decision.nextMode);
    this.emit('plan_event', { type: 'plan_reverted', plan: decision.plan });
    this.persistCurrentSession();
    return decision.plan;
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
    // RUNTIME-26: route a detached init/goal-resume rejection to reportBackgroundError rather than dropping it.
    void this.ensureInitialized()
      .then(() => {
        if (!this.goalController.isActive() || this.execCtrl.shuttingDown) return;
        this.scheduleGoalTurn(buildGoalContinuationPrompt(goal), goal);
      })
      .catch((error) =>
        this.reportBackgroundError(
          error instanceof Error ? error : new Error(String(error)),
          'goal-resume',
        ),
      );
  }

  private async switchProvider(profileName: string): Promise<void> {
    const session = this.getSessionOrThrow();
    const { settings, provider } = resolveUserSettingsProviderSwitch(
      profileName,
      this.providerDefinitions,
      this.userSettingsSources,
    );
    session.swapProvider(provider, settings.model);
  }

  /** CMD-004: after the command runs, the HOST applies its host actions via
   * {@link applyCommandHostActions} and emits requester-routed `ui_intent` events. */
  override async executeCommand(
    name: string,
    args: string,
    source: TCommandInvocationSource = 'user',
    originDriverId?: TDriverId,
  ): Promise<ICommandResult | null> {
    if (this.orgPolicy?.blockedCommands?.includes(name)) {
      return {
        message: formatOrgPolicyViolationMessage(
          `Command /${name} is blocked by your organization policy.`,
          this.orgPolicy.adminContact,
        ),
        success: false,
      };
    }
    const result = await super.executeCommand(name, args, source, originDriverId);
    if (result === null) return null;
    const application = await applyCommandHostActions(result, {
      getAdapters: () => this.getCommandHostAdapters(),
      orgPolicy: this.orgPolicy,
      switchProvider: (profileName) => this.switchProvider(profileName),
      applyOutputStyle: (style) => this.applyOutputStyle(style),
      renameSession: (newName) => {
        this.setName(newName);
        this.emit('session_renamed', { name: newName }); // all surfaces update their titles
      },
    });
    emitUiIntentEvents(
      application.uiIntents,
      resolveUiIntentRequester(source, originDriverId, this.execCtrl.activeDriverId),
      (event) => this.emit('ui_intent', event),
    );
    return application.result;
  }
}
