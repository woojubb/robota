/**
 * TuiInteractionChannel — implements IInteractionChannel for the Ink TUI.
 *
 * Moves session lifecycle (InteractiveSession, CommandRegistry, TuiStateManager)
 * out of React hooks and into a plain TypeScript class.
 */

import {
  createSystemMessage,
  createUserMessage,
  messageToHistoryEntry,
} from '@robota-sdk/agent-core';
import {
  InteractiveSession,
  CommandRegistry,
  generateSessionName,
} from '@robota-sdk/agent-framework';

import { createSessionInitPoller } from './flows/session-init-poller.js';
import { CommandEffectQueue, type ICommandEffectQueue } from './hooks/command-effect-queue.js';
import { applySystemCommandResult } from './hooks/useSlashRouting.js';
import { TuiStateManager } from './tui-state-manager.js';

import type { ISessionInitPoller, TSessionInitFailure } from './flows/session-init-poller.js';
import type { TerminalHandoffController } from './terminal-handoff-controller.js';
import type { IPendingPermissionRequest } from './types.js';
import type { IAIProvider, TPermissionMode, TSessionEndReason } from '@robota-sdk/agent-core';
import type { TToolArgs } from '@robota-sdk/agent-core';
// CMD-004 unified action contract (SSOT in agent-core). Aliased to avoid clashing with the legacy
// interface-transport `TActionResponse` still used by the (dead, removed in PR-H) requestAction path.
import type {
  IActionRequest,
  TActionResponse as TUserActionResponse,
} from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  TSubagentRunnerFactory,
  TShellExecFn,
} from '@robota-sdk/agent-framework';
import type {
  TActionRequest,
  TActionResponse,
  ICommandInfo,
  IExecutionDetailPage,
  IExecutionResult,
  IExecutionWorkspaceEvent,
  IInteractionChannel,
  IInteractiveSession,
  IInteractiveSessionStore,
  ITransportRegistryView,
  InteractionEvent,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-transport';

const SESSION_INIT_POLL_MS = 200;
const SESSION_INIT_TIMEOUT_MS = 15000;

export interface ITuiInteractionChannelOptions {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  forkSession?: boolean;
  sessionName?: string;
  onAutoNamed?: (name: string) => void;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  shellExec?: TShellExecFn;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  language?: string;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
  agentName?: string;
  /** Active preset id selected at startup (PRESET-011 runtime state). Defaults to 'default'. */
  activePresetId?: string;
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  /** Preset execution capability: activate agent runtime + subagent/background dispatch. */
  enableParallelSubagents?: boolean;
  /** Preset execution capability: run a post-task self-verification step. */
  selfVerification?: boolean;
  /** TERM-002: process-shared terminal-handoff controller (the TUI implementation of ITerminalHandoff). */
  terminalHandoff?: TerminalHandoffController;
}

export class TuiInteractionChannel implements IInteractionChannel {
  readonly stateManager: TuiStateManager;

  private readonly interactiveSession: InteractiveSession;
  private readonly registry: CommandRegistry;
  private readonly commandEffectQueue: ICommandEffectQueue;
  private readonly opts: ITuiInteractionChannelOptions;

  private submitHandler: ((text: string) => Promise<void>) | null = null;
  private actionQueue: Array<{
    action: TActionRequest;
    resolve: (response: TActionResponse) => void;
  }> = [];
  private processingAction = false;

  // CMD-004 unified ask path (parallel to the legacy actionQueue above; that legacy path is removed
  // in PR-H). Backs askHandler → InteractiveSession; rendered by App's PendingActionPrompt.
  private userActionQueue: Array<{
    request: IActionRequest;
    resolve: (response: TUserActionResponse) => void;
  }> = [];
  private processingUserAction = false;

  permissionRequest: IPendingPermissionRequest | null = null;
  pendingAction: TActionRequest | null = null;
  /** CMD-004: the action currently awaiting a user answer, or null. Read by App to render the dialog. */
  pendingUserAction: IActionRequest | null = null;
  availableCommands: ICommandInfo[] = [];
  isShuttingDown = false;
  sessionName: string | undefined;

  private autoNameTriggered = false;
  private sessionStarted = false;
  private initPoller: ISessionInitPoller | null = null;

  /** TERM-002: the App registers its Ink suspend/resume hooks into this controller. */
  get terminalHandoffController(): TerminalHandoffController | undefined {
    return this.opts.terminalHandoff;
  }
  private permissionQueue: Array<{
    toolName: string;
    toolArgs: TToolArgs;
    resolve: (result: TPermissionResultValue) => void;
  }> = [];
  private processingPermission = false;

  /** Set by React hook to trigger re-render on state change */
  onChange: (() => void) | null = null;

  constructor(opts: ITuiInteractionChannelOptions) {
    this.opts = opts;
    this.sessionName = opts.sessionName;
    this.stateManager = new TuiStateManager();
    this.stateManager.onChange = () => this.onChange?.();

    this.interactiveSession = this.createSession();
    this.registry = this.createRegistry();
    this.commandEffectQueue = new CommandEffectQueue();
  }

  private createSession(): InteractiveSession {
    const opts = this.opts;
    return new InteractiveSession({
      cwd: opts.cwd,
      provider: opts.provider,
      permissionMode: opts.permissionMode,
      maxTurns: opts.maxTurns,
      permissionHandler: (toolName, toolArgs) => this.handlePermissionRequest(toolName, toolArgs),
      askHandler: (request) => this.askUser(request),
      sessionStore: opts.sessionStore,
      resumeSessionId: opts.resumeSessionId,
      forkSession: opts.forkSession,
      sessionName: opts.sessionName,
      backgroundTaskRunners: opts.backgroundTaskRunners,
      subagentRunnerFactory: opts.subagentRunnerFactory,
      commandModules: opts.commandModules,
      commandHostAdapters: opts.commandHostAdapters,
      shellExec: opts.shellExec,
      language: opts.language,
      agentName: opts.agentName,
      activePresetId: opts.activePresetId,
      persona: opts.persona,
      systemPrompt: opts.systemPrompt,
      appendSystemPrompt: opts.appendSystemPrompt,
      allowedTools: opts.allowedTools,
      deniedTools: opts.deniedTools,
      enableParallelSubagents: opts.enableParallelSubagents,
      selfVerification: opts.selfVerification,
      terminalHandoff: opts.terminalHandoff,
    });
  }

  private createRegistry(): CommandRegistry {
    const registry = new CommandRegistry();
    for (const module of this.opts.commandModules ?? []) {
      registry.addModule(module);
    }
    this.opts.reloadPluginCommandSource?.(registry);
    return registry;
  }

  // ── IInteractionChannel ──────────────────────────────────────

  onSubmit(handler: (text: string) => Promise<void>): void {
    this.submitHandler = handler;
  }

  write(_event: InteractionEvent): void {
    // Intentionally unused in TUI direct-wiring mode.
    // TuiInteractionChannel subscribes to session events directly via start() →
    // wireSessionEvents(), not through the IInteractionChannel event protocol used
    // by createInteractiveRuntime. The two paths are mutually exclusive.
  }

  async requestAction(action: TActionRequest): Promise<TActionResponse> {
    return new Promise<TActionResponse>((resolve) => {
      this.actionQueue.push({ action, resolve });
      this.processNextAction();
    });
  }

  setAvailableCommands(commands: ICommandInfo[]): void {
    this.availableCommands = commands;
    this.onChange?.();
  }

  setBusy(busy: boolean): void {
    this.stateManager.onThinking(busy);
  }

  async start(): Promise<void> {
    if (this.sessionStarted) return;
    this.sessionStarted = true;
    this.wireSessionEvents();
    this.syncRestoredHistory();
    this.startInitCheck();

    if (this.opts.transportRegistry) {
      await this.opts.transportRegistry.startAll(this.interactiveSession);
    }
  }

  async stop(): Promise<void> {
    this.onChange = null;
    this.sessionStarted = false;
    this.stopInitCheck();
    if (this.opts.transportRegistry) {
      await this.opts.transportRegistry.stopAll();
    }
  }

  // ── Additional methods for App.tsx ───────────────────────────

  getSession(): InteractiveSession {
    return this.interactiveSession;
  }

  getRegistry(): CommandRegistry {
    return this.registry;
  }

  getCommandEffectQueue(): ICommandEffectQueue {
    return this.commandEffectQueue;
  }

  abort(): void {
    this.stateManager.setAborting(true);
    this.cancelAllUserActions();
    this.interactiveSession.abort();
  }

  cancelQueue(): void {
    this.interactiveSession.cancelQueue();
    this.cancelAllUserActions();
    this.stateManager.setPendingPrompt(null);
  }

  async shutdown(options?: { reason?: TSessionEndReason }): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.cancelAllUserActions();
    this.stateManager.addEntry(messageToHistoryEntry(createSystemMessage('Shutting down...')));
    this.onChange?.();
    await this.interactiveSession.shutdown({
      reason: options?.reason ?? 'prompt_input_exit',
      message: 'CLI shutdown',
    });
  }

  selectExecutionWorkspaceEntry(entryId: string): void {
    this.stateManager.selectExecutionWorkspaceEntry(entryId);
  }

  async readExecutionWorkspaceDetail(entryId: string): Promise<IExecutionDetailPage> {
    return this.interactiveSession.readExecutionWorkspaceDetail(entryId);
  }

  async sendAgentJob(jobId: string, input: string): Promise<void> {
    await this.interactiveSession.sendAgentJob(jobId, input);
  }

  setSessionName(name: string): void {
    this.sessionName = name;
    this.interactiveSession.setName(name);
    this.onChange?.();
  }

  resolveAction(response: TActionResponse): void {
    const pending = this.actionQueue[0];
    if (!pending) return;
    this.actionQueue.shift();
    this.processingAction = false;
    this.pendingAction = null;
    this.onChange?.();
    pending.resolve(response);
    this.processNextAction();
  }

  // ── CMD-004 unified ask path ─────────────────────────────────

  /** Framework's `askHandler` entry point: queue the request and resolve when the user answers. */
  async askUser(request: IActionRequest): Promise<TUserActionResponse> {
    return new Promise<TUserActionResponse>((resolve) => {
      this.userActionQueue.push({ request, resolve });
      this.processNextUserAction();
    });
  }

  /** Called by App's PendingActionPrompt when the user answers (or cancels) the pending action. */
  resolveUserAction(response: TUserActionResponse): void {
    const pending = this.userActionQueue[0];
    if (!pending) return;
    this.userActionQueue.shift();
    this.processingUserAction = false;
    this.pendingUserAction = null;
    this.onChange?.();
    pending.resolve(response);
    this.processNextUserAction();
  }

  private processNextUserAction(): void {
    if (this.processingUserAction) return;
    const next = this.userActionQueue[0];
    if (!next) {
      this.pendingUserAction = null;
      this.onChange?.();
      return;
    }
    this.processingUserAction = true;
    this.pendingUserAction = next.request;
    this.onChange?.();
  }

  /** Resolve every queued/in-flight ask as cancelled (abort, shutdown). */
  private cancelAllUserActions(): void {
    const queued = this.userActionQueue;
    this.userActionQueue = [];
    this.processingUserAction = false;
    this.pendingUserAction = null;
    for (const pending of queued) {
      pending.resolve({ type: 'cancelled' });
    }
    this.onChange?.();
  }

  async handleInput(input: string): Promise<void> {
    if (!input.startsWith('/')) {
      await this.interactiveSession.submit(input);
      this.stateManager.setPendingPrompt(this.interactiveSession.getPendingPrompt());
      return;
    }
    await this.handleSlashCommand(input);
  }

  private async handleSlashCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? '';
    const args = parts.slice(1).join(' ');

    const result = await this.interactiveSession.executeCommand(cmd, args);
    if (result) {
      if (result.effects?.some((effect) => effect.type === 'session-execution-started')) {
        this.stateManager.setPendingPrompt(this.interactiveSession.getPendingPrompt());
        return;
      }
      applySystemCommandResult(
        result,
        this.interactiveSession,
        this.registry,
        this.stateManager,
        this.commandEffectQueue,
        this.opts.reloadPluginCommandSource,
      );
      return;
    }

    this.stateManager.addEntry(
      messageToHistoryEntry(createSystemMessage(`Unknown command "/${cmd}". Type /help for help.`)),
    );
  }

  // ── Private helpers ──────────────────────────────────────────

  private processNextAction(): void {
    if (this.processingAction) return;
    const next = this.actionQueue[0];
    if (!next) {
      this.pendingAction = null;
      this.onChange?.();
      return;
    }
    this.processingAction = true;
    this.pendingAction = next.action;
    this.onChange?.();
  }

  private handlePermissionRequest(
    toolName: string,
    toolArgs: TToolArgs,
  ): Promise<TPermissionResultValue> {
    return new Promise<TPermissionResultValue>((resolve) => {
      this.permissionQueue.push({ toolName, toolArgs, resolve });
      this.processNextPermission();
    });
  }

  private processNextPermission(): void {
    if (this.processingPermission) return;
    const next = this.permissionQueue[0];
    if (!next) {
      this.permissionRequest = null;
      this.onChange?.();
      return;
    }
    this.processingPermission = true;
    this.permissionRequest = {
      toolName: next.toolName,
      toolArgs: next.toolArgs,
      resolve: (result) => {
        this.permissionQueue.shift();
        this.processingPermission = false;
        this.permissionRequest = null;
        next.resolve(result);
        setTimeout(() => this.processNextPermission(), 0);
      },
    };
    this.onChange?.();
  }

  private wireSessionEvents(): void {
    const session = this.interactiveSession;
    const manager = this.stateManager;

    const onUserMessage = (content: string): void => {
      this.handleAutoNaming(content);
      manager.addEntry(messageToHistoryEntry(createUserMessage(content)));
    };
    const onComplete = (result: IExecutionResult): void => {
      manager.onComplete(result);
      manager.syncHistory(session.getFullHistory());
    };
    const onError = (): void => {
      manager.onError();
      manager.syncHistory(session.getFullHistory());
    };
    const onCompact = (): void => {
      manager.syncHistory(session.getFullHistory());
    };
    const onSkillActivation = (): void => {
      manager.syncHistory(session.getFullHistory());
    };
    const onMemoryEvent = (): void => {
      manager.syncHistory(session.getFullHistory());
    };
    const onExecutionWorkspaceEvent = (event: IExecutionWorkspaceEvent): void => {
      manager.syncExecutionWorkspaceSnapshot(event.snapshot);
    };

    session.on('user_message', onUserMessage);
    session.on('text_delta', manager.onTextDelta);
    session.on('tool_start', manager.onToolStart);
    session.on('tool_end', manager.onToolEnd);
    session.on('thinking', manager.onThinking);
    session.on('complete', onComplete);
    session.on('interrupted', manager.onInterrupted);
    session.on('error', onError);
    session.on('context_update', manager.onContextUpdate);
    session.on('compact', onCompact);
    session.on('skill_activation', onSkillActivation);
    session.on('memory_event', onMemoryEvent);
    session.on('execution_workspace_event', onExecutionWorkspaceEvent);
  }

  private handleAutoNaming(content: string): void {
    if (this.autoNameTriggered) return;
    if (this.opts.sessionName || this.interactiveSession.getName()) return;
    this.autoNameTriggered = true;
    generateSessionName(this.opts.provider, content)
      .then((name) => {
        this.interactiveSession.setName(name);
        this.sessionName = name;
        this.opts.onAutoNamed?.(name);
        this.onChange?.();
      })
      .catch(() => {
        this.autoNameTriggered = false;
      });
  }

  private syncRestoredHistory(): void {
    if (this.stateManager.history.length === 0) {
      const restored = this.interactiveSession.getFullHistory();
      if (restored.length > 0) {
        this.stateManager.syncHistory(restored);
      }
    }
  }

  private startInitCheck(): void {
    this.initPoller = createSessionInitPoller({
      check: () => this.runInitCheck(),
      intervalMs: SESSION_INIT_POLL_MS,
      timeoutMs: SESSION_INIT_TIMEOUT_MS,
      onReady: () => undefined,
      onFailure: (failure) => this.onInitFailure(failure),
    });
    this.initPoller.start();
  }

  /** Throws while the session is not ready; the init poller classifies the error. */
  private runInitCheck(): void {
    const ctx = this.interactiveSession.getContextState();
    this.stateManager.setContextState({
      percentage: ctx.usedPercentage,
      usedTokens: ctx.usedTokens,
      maxTokens: ctx.maxTokens,
    });
    const restored = this.interactiveSession.getFullHistory();
    if (restored.length > 0) {
      this.stateManager.syncHistory(restored);
    }
    this.syncExecutionWorkspace();
  }

  private onInitFailure(failure: TSessionInitFailure): void {
    const message =
      failure.kind === 'timeout'
        ? `Session initialization timed out after ${SESSION_INIT_TIMEOUT_MS / 1000}s${
            failure.lastError ? ` (last error: ${failure.lastError.message})` : ''
          }`
        : `Session initialization failed: ${failure.error.message}`;
    this.stateManager.onError();
    this.stateManager.addEntry({
      id: `session-init-error-${Date.now()}`,
      timestamp: new Date(),
      category: 'event',
      type: 'session-init-error',
      data: { message },
    });
  }

  private stopInitCheck(): void {
    this.initPoller?.stop();
    this.initPoller = null;
  }

  private syncExecutionWorkspace(): void {
    try {
      // allow-fallback: session may not be initialized yet; swallow until ready
      this.stateManager.syncExecutionWorkspaceSnapshot(
        this.interactiveSession.getExecutionWorkspaceSnapshot({
          selectedEntryId: this.stateManager.selectedExecutionEntryId,
        }),
      );
    } catch {
      // allow-fallback: session may not be initialized yet; swallow until ready
      /* Session not initialized yet */
    }
  }
}
