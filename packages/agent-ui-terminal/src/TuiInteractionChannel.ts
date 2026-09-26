/**
 * TuiInteractionChannel — session-owning presentation surface for the Ink TUI.
 *
 * Moves session lifecycle (InteractiveSession, CommandRegistry, TuiStateManager)
 * out of React hooks and into a plain TypeScript class.
 */

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import {
  CommandRegistry,
  buildRuntimeSession,
  generateSessionName,
} from '@robota-sdk/agent-framework';

import { AttentionCoordinator } from './attention/attention-coordinator.js';
import { MS_PER_SECOND } from './attention/time-units.js';
import { createSessionInitPoller } from './flows/session-init-poller.js';
import { applySystemCommandResult } from './hooks/command-result-handler.js';
import { parseSlashCommandInput } from './slash-command-input.js';
import {
  TuiChannelLifecycleCoordinator,
  TuiChannelStartRollbackError,
} from './tui-channel-lifecycle-coordinator.js';
import { TuiPermissionQueue, TuiUserActionQueue } from './tui-interaction-queues.js';
import { TuiSessionEventProjector } from './tui-session-event-projector.js';
import { buildTuiSessionOptions } from './tui-session-options.js';
import { TuiStateManager } from './tui-state-manager.js';

import type { IAttentionSource } from './attention/attention-tracker.js';
import type { ISessionInitPoller, TSessionInitFailure } from './flows/session-init-poller.js';
import type { TerminalHandoffController } from './terminal-handoff-controller.js';
import type {
  ITuiAppChannelPort,
  ITuiChannelSnapshot,
  ITuiCommandQueryPort,
  ITuiRuntimeStatusSnapshot,
  ITuiSessionUiEventPort,
} from './tui-app-channel-port.js';
import type { ITuiInteractionChannelOptions } from './tui-channel-options.js';
import type { IPendingPermissionRequest } from './types.js';
import type {
  IHistoryEntry,
  TPermissionMode,
  TSessionEndReason,
  TToolArgs,
} from '@robota-sdk/agent-core';
// CMD-004 unified action contract (SSOT in agent-core).
import type {
  IActionRequest,
  TActionResponse as TUserActionResponse,
} from '@robota-sdk/agent-core';
import type { InteractiveSession } from '@robota-sdk/agent-framework';
import type { IExecutionDetailPage } from '@robota-sdk/agent-interface-execution';
import type { ICommandInfo, TPermissionResultValue } from '@robota-sdk/agent-interface-session';

const SESSION_INIT_POLL_MS = 200;
const SESSION_INIT_TIMEOUT_MS = 15000;
/** Upper bound on the graceful session shutdown so a wedged subsystem cannot block process exit
 * (CLI-075 / RUNTIME-33; api-boundary "safely cancelled within a configurable timeout"). */
const SHUTDOWN_TIMEOUT_MS = 5000;

export type { ITuiInteractionChannelOptions } from './tui-channel-options.js';

export class TuiInteractionChannel implements ITuiAppChannelPort {
  readonly stateManager: TuiStateManager;

  private readonly interactiveSession: InteractiveSession;
  private readonly registry: CommandRegistry;
  private readonly opts: ITuiInteractionChannelOptions;

  private submitHandler: ((text: string) => Promise<void>) | null = null;

  private readonly userActions: TuiUserActionQueue;
  private readonly permissions: TuiPermissionQueue;
  private readonly eventProjector: TuiSessionEventProjector;
  /** SCREEN-1992: joins the terminal's attention to this channel's recap; absent without a source. */
  private readonly attention: AttentionCoordinator | undefined;
  private readonly lifecycle: TuiChannelLifecycleCoordinator;
  availableCommands: ICommandInfo[] = [];
  sessionName: string | undefined;

  private autoNameTriggered = false;
  private initPoller: ISessionInitPoller | null = null;

  /** TERM-002: the App registers its Ink suspend/resume hooks into this controller. */
  get terminalHandoffController(): TerminalHandoffController | undefined {
    return this.opts.terminalHandoff;
  }
  /** Set by React hook to trigger re-render on state change */
  onChange: (() => void) | null = null;

  constructor(opts: ITuiInteractionChannelOptions) {
    this.opts = opts;
    this.sessionName = opts.sessionName;
    this.stateManager = new TuiStateManager();
    this.stateManager.onChange = () => this.onChange?.();
    this.userActions = new TuiUserActionQueue(() => this.onChange?.());
    this.permissions = new TuiPermissionQueue(() => this.onChange?.());

    this.interactiveSession = this.createSession();
    this.registry = this.createRegistry();
    this.attention = this.createAttention(opts.attention);
    this.eventProjector = new TuiSessionEventProjector({
      session: this.interactiveSession,
      manager: this.stateManager,
      ...(this.attention ? { attention: this.attention } : {}),
      onUserMessage: (content) => this.handleAutoNaming(content),
      requestPermission: (toolName, toolArgs, id, canPersistProjectPermission, requestedByPeer) =>
        this.permissions.enqueue(
          toolName,
          toolArgs,
          id,
          canPersistProjectPermission,
          requestedByPeer,
        ),
      askUser: (request, id) => this.askUser(request, id),
      dismissPrompt: (id) => this.dismissPromptById(id),
      ...(opts.onSessionEventDeliveryError
        ? { onDeliveryError: opts.onSessionEventDeliveryError }
        : {}),
    });
    this.lifecycle = new TuiChannelLifecycleCoordinator(
      {
        start: () => this.startRuntime(),
        stop: async () => {
          this.eventProjector.unwire();
          this.cancelAllPermissions();
          this.cancelAllUserActions();
          this.stopInitCheck();
          this.onChange = null;
          this.stateManager.dispose();
          await this.stopTransports();
        },
        beginShutdown: () => {
          this.cancelAllUserActions();
          this.cancelAllPermissions();
          this.stateManager.addEntry(
            messageToHistoryEntry(createSystemMessage('Shutting down...')),
          );
          this.onChange?.();
        },
        shutdownSession: async ({ reason, message }) => {
          await this.interactiveSession.shutdown({ reason, message });
        },
      },
      SHUTDOWN_TIMEOUT_MS,
    );
  }

  private async startRuntime(): Promise<void> {
    let transportStartAttempted = false;
    try {
      this.eventProjector.wire();
      this.syncRestoredHistory();
      this.startInitCheck();
      if (this.opts.transportRegistry) {
        transportStartAttempted = true;
        await this.opts.bindTransports?.(this.interactiveSession);
        await this.opts.transportRegistry.startAll();
      }
    } catch (startError) {
      this.eventProjector.unwire();
      this.stopInitCheck();
      if (transportStartAttempted && this.opts.transportRegistry) {
        try {
          await this.stopTransports();
        } catch (rollbackError) {
          const rollbackErrors =
            rollbackError instanceof AggregateError ? rollbackError.errors : [rollbackError];
          throw new TuiChannelStartRollbackError(
            [startError, ...rollbackErrors],
            'TUI channel start failed and transport rollback also failed.',
          );
        }
      }
      throw startError;
    }
  }

  private async stopTransports(): Promise<void> {
    if (!this.opts.transportRegistry) return;
    const result = await this.opts.transportRegistry.stopAll();
    if (result.errors.length > 0) {
      throw new AggregateError(result.errors, 'TUI transport teardown failed.');
    }
  }

  get permissionRequest(): IPendingPermissionRequest | null {
    return this.permissions.current;
  }

  /** CMD-004: the action currently awaiting a user answer, or null. */
  get pendingUserAction(): IActionRequest | null {
    return this.userActions.current;
  }

  get isShuttingDown(): boolean {
    return this.lifecycle.isShuttingDown;
  }

  get isActiveForPeerStatus(): boolean {
    return this.lifecycle.isActiveForPeerStatus;
  }

  private createSession(): InteractiveSession {
    return buildRuntimeSession(buildTuiSessionOptions(this.opts));
  }

  private createRegistry(): CommandRegistry {
    const registry = new CommandRegistry();
    for (const module of this.opts.commandModules ?? []) {
      registry.addModule(module);
    }
    this.opts.reloadPluginCommandSource?.(registry);
    return registry;
  }

  onSubmit(handler: (text: string) => Promise<void>): void {
    this.submitHandler = handler;
  }

  setAvailableCommands(commands: ICommandInfo[]): void {
    this.availableCommands = commands;
    this.onChange?.();
  }

  setBusy(busy: boolean): void {
    this.stateManager.onThinking(busy);
  }

  async start(): Promise<void> {
    await this.lifecycle.start();
  }

  /**
   * Full, idempotent channel teardown (CLI-075). Unwires every session listener, drains both
   * request queues, stops the init poller, disposes the render-state manager, stops transports, and
   * — unless a graceful `shutdown()` already ran — shuts the underlying session down so a discarded
   * or switched-away channel releases its background tasks, subagent processes, and timers.
   */
  async stop(): Promise<void> {
    await this.lifecycle.stop();
  }

  // ── Additional methods for App.tsx ───────────────────────────

  getSession(): InteractiveSession {
    return this.interactiveSession;
  }

  getRegistry(): CommandRegistry {
    return this.registry;
  }

  subscribe(onChange: () => void): () => void {
    this.onChange = onChange;
    return () => {
      if (this.onChange === onChange) this.onChange = null;
    };
  }

  getSnapshot(): ITuiChannelSnapshot {
    const manager = this.stateManager;
    return {
      history: manager.history,
      streamingText: manager.streamingText,
      activeTools: manager.activeTools,
      isThinking: manager.isThinking,
      isAborting: manager.isAborting,
      lastErrorMessage: manager.lastErrorMessage,
      isStalled: manager.isStalled,
      sessionEventNotices: manager.sessionEventNotices,
      isShuttingDown: this.isShuttingDown,
      pendingPrompt: manager.pendingPrompt,
      pendingCount: this.interactiveSession.getPendingCount(),
      executionWorkspaceSnapshot: manager.executionWorkspaceSnapshot,
      ...(manager.selectedExecutionEntryId !== undefined
        ? { selectedExecutionEntryId: manager.selectedExecutionEntryId }
        : {}),
      permissionRequest: this.permissionRequest,
      pendingUserAction: this.pendingUserAction,
      contextState: manager.contextState,
    };
  }

  getCommandQueryPort(): ITuiCommandQueryPort {
    return this.registry;
  }

  getSessionUiEventPort(): ITuiSessionUiEventPort {
    return this.interactiveSession;
  }

  getRuntimeStatusSnapshot(fallbackPermissionMode: TPermissionMode): ITuiRuntimeStatusSnapshot {
    try {
      const session = this.interactiveSession.getSession();
      const activePresetId = session.getActivePresetId?.();
      const effort = session.getModelEffort();
      return {
        permissionMode: session.getPermissionMode(),
        sessionId: session.getSessionId(),
        ...(activePresetId !== undefined ? { activePresetId } : {}),
        ...(effort !== undefined ? { effort } : {}),
      };
    } catch {
      return { permissionMode: fallbackPermissionMode, sessionId: '' };
    }
  }

  addEntry(entry: IHistoryEntry): void {
    this.stateManager.addEntry(entry);
  }

  abort(): void {
    this.stateManager.setAborting(true);
    this.cancelAllUserActions();
    this.cancelAllPermissions();
    this.interactiveSession.abort();
  }

  cancelQueue(): void {
    this.interactiveSession.cancelQueue();
    this.cancelAllUserActions();
    this.cancelAllPermissions();
    this.stateManager.setPendingPrompt(null);
  }

  async stopWaitingSelfPacedLoop(): Promise<void> {
    const waiting = this.interactiveSession
      .listSelfPacedLoops()
      .filter((loop) => loop.phase === 'waiting');
    if (waiting.length === 0) return;
    if (waiting.length > 1) {
      this.addEntry(
        messageToHistoryEntry(
          createSystemMessage(
            'Several self-paced loops are waiting. Use /loop list and /loop stop <id> to choose one.',
          ),
        ),
      );
      return;
    }
    const loopId = waiting[0]!.loopId;
    try {
      await this.interactiveSession.stopSelfPacedLoop(loopId, 'Loop stopped by Esc');
      this.addEntry(messageToHistoryEntry(createSystemMessage(`Loop ${loopId} stopped by Esc.`)));
    } catch (error) {
      this.addEntry(
        messageToHistoryEntry(
          createSystemMessage(
            `Could not stop loop ${loopId}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
      );
    }
  }

  async shutdown(options?: { reason?: TSessionEndReason; timeoutMs?: number }): Promise<void> {
    await this.lifecycle.shutdown(options);
  }

  selectExecutionWorkspaceEntry(entryId: string): void {
    this.stateManager.selectExecutionWorkspaceEntry(entryId);
  }

  async readExecutionWorkspaceDetail(entryId: string): Promise<IExecutionDetailPage> {
    return this.interactiveSession.readExecutionWorkspaceDetail(entryId);
  }

  async sendAgentJob(taskId: string, input: string): Promise<void> {
    await this.interactiveSession.sendAgentJob(taskId, input);
  }

  setSessionName(name: string): void {
    this.sessionName = name;
    this.interactiveSession.setName(name);
    this.onChange?.();
  }

  // ── CMD-004 unified ask path ─────────────────────────────────

  /**
   * Queue an ask and resolve when the user answers. Reached via the `ask_request` event handler
   * (which passes the framework prompt `id` for co-drive dismissal) and by any direct
   * `IInteractionChannel.askUser` caller (no id).
   */
  async askUser(request: IActionRequest, id?: string): Promise<TUserActionResponse> {
    return this.userActions.enqueue(request, id);
  }

  /** Called by App's PendingActionPrompt when the user answers (or cancels) the pending action. */
  resolveUserAction(request: IActionRequest, response: TUserActionResponse): void {
    this.userActions.resolveCurrent(request, response);
  }

  /** Resolve every queued/in-flight ask as cancelled (abort, shutdown). */
  private cancelAllUserActions(): void {
    this.userActions.cancelAll();
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
    const { name: cmd, args } = parseSlashCommandInput(input);

    const result = await this.interactiveSession.executeCommand(cmd, args);
    if (result) {
      // CMD-004 Stage E: `data.sessionExecution` is the requester-local "a session turn is now
      // running" hint (formerly the `session-execution-started` effect).
      if (result.data?.['sessionExecution'] === true) {
        this.stateManager.setPendingPrompt(this.interactiveSession.getPendingPrompt());
        return;
      }
      applySystemCommandResult(
        result,
        this.interactiveSession,
        this.registry,
        this.stateManager,
        this.opts.reloadPluginCommandSource,
      );
      return;
    }

    this.stateManager.addEntry(
      messageToHistoryEntry(createSystemMessage(`Unknown command "/${cmd}". Type /help for help.`)),
    );
  }

  // ── Private helpers ──────────────────────────────────────────

  private handlePermissionRequest(
    toolName: string,
    toolArgs: TToolArgs,
    id?: string,
  ): Promise<TPermissionResultValue> {
    return this.permissions.enqueue(toolName, toolArgs, id);
  }

  /**
   * REMOTE-007 co-drive: another surface answered the prompt with this framework `id`, so dismiss the
   * still-showing local dialog. Resolving the local entry (cancelled) is a no-op on the framework side
   * — that id is already settled — but it clears the TUI's queue + render state.
   */
  private dismissPromptById(id: string): void {
    this.userActions.dismissById(id);
    this.permissions.dismissById(id);
  }

  /**
   * Resolve every queued/in-flight permission request as `false` (deny) — abort, cancelQueue,
   * shutdown, stop. Symmetric to `cancelAllUserActions()`: tearing down must neither leave a tool's
   * permission promise dangling (the tool would hang) nor silently grant it (CLI-075 RUNTIME-32).
   */
  private cancelAllPermissions(): void {
    this.permissions.cancelAll();
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
    this.stopInitCheck();
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
    const restoredSessionName = this.interactiveSession.getName();
    if (restoredSessionName && restoredSessionName !== this.sessionName) {
      this.sessionName = restoredSessionName;
      this.onChange?.();
    }
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

  /** SCREEN-1992: the recap lands in this channel's notice store; no source ⇒ no coordinator. */
  private createAttention(source: IAttentionSource | undefined): AttentionCoordinator | undefined {
    if (!source) return undefined;
    return new AttentionCoordinator({
      source,
      onRecap: (line) => this.stateManager.addAttentionRecap(line),
    });
  }

  private onInitFailure(failure: TSessionInitFailure): void {
    const message =
      failure.kind === 'timeout'
        ? `Session initialization timed out after ${SESSION_INIT_TIMEOUT_MS / MS_PER_SECOND}s${
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
