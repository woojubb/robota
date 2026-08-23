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

import { attributedUserEcho } from './attributed-user-echo.js';
import { createSessionInitPoller } from './flows/session-init-poller.js';
import { applySystemCommandResult } from './hooks/command-result-handler.js';
import { bindTuiSessionEvent, bindTuiSessionNoticeEvents } from './tui-session-binding.js';
import { buildTuiSessionOptions } from './tui-session-options.js';
import { TuiStateManager } from './tui-state-manager.js';

import type { ISessionInitPoller, TSessionInitFailure } from './flows/session-init-poller.js';
import type { TerminalHandoffController } from './terminal-handoff-controller.js';
import type { ITuiInteractionChannelOptions } from './tui-channel-options.js';
import type { ITuiSessionEventBinding } from './tui-session-binding.js';
import type { IPendingPermissionRequest } from './types.js';
import type { TSessionEndReason } from '@robota-sdk/agent-core';
import type { TToolArgs } from '@robota-sdk/agent-core';
// CMD-004 unified action contract (SSOT in agent-core).
import type {
  IActionRequest,
  TActionResponse as TUserActionResponse,
} from '@robota-sdk/agent-core';
import type { InteractiveSession } from '@robota-sdk/agent-framework';
import type {
  IExecutionDetailPage,
  IExecutionWorkspaceEvent,
} from '@robota-sdk/agent-interface-execution';
import type {
  ICommandInfo,
  IExecutionResult,
  IInteractiveSessionEvents,
  TInteractiveEventName,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-session';

const SESSION_INIT_POLL_MS = 200;
const SESSION_INIT_TIMEOUT_MS = 15000;
/** Upper bound on the graceful session shutdown so a wedged subsystem cannot block process exit
 * (CLI-075 / RUNTIME-33; api-boundary "safely cancelled within a configurable timeout"). */
const SHUTDOWN_TIMEOUT_MS = 5000;

export type { ITuiInteractionChannelOptions } from './tui-channel-options.js';

export class TuiInteractionChannel {
  readonly stateManager: TuiStateManager;

  private readonly interactiveSession: InteractiveSession;
  private readonly registry: CommandRegistry;
  private readonly opts: ITuiInteractionChannelOptions;

  private submitHandler: ((text: string) => Promise<void>) | null = null;

  // CMD-004 unified ask path. Handles `ask_request` from InteractiveSession and is rendered by
  // App's PendingActionPrompt.
  private userActionQueue: Array<{
    request: IActionRequest;
    resolve: (response: TUserActionResponse) => void;
    /** REMOTE-007: framework prompt id, so `prompt_resolved` can dismiss it on co-drive. */
    id?: string;
  }> = [];
  private processingUserAction = false;

  permissionRequest: IPendingPermissionRequest | null = null;
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
    /** REMOTE-007: framework prompt id, so `prompt_resolved` can dismiss it on co-drive. */
    id?: string;
  }> = [];
  private processingPermission = false;

  /** Retained session-event bindings so stop() can unwire every listener (CLI-075 RUNTIME-31). */
  private sessionEventBindings: ITuiSessionEventBinding[] = [];
  /** Idempotency guard for the full channel teardown (CLI-075). */
  private stopped = false;

  /** Set by React hook to trigger re-render on state change */
  onChange: (() => void) | null = null;

  constructor(opts: ITuiInteractionChannelOptions) {
    this.opts = opts;
    this.sessionName = opts.sessionName;
    this.stateManager = new TuiStateManager();
    this.stateManager.onChange = () => this.onChange?.();

    this.interactiveSession = this.createSession();
    this.registry = this.createRegistry();
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
    if (this.sessionStarted) return;
    this.sessionStarted = true;
    this.wireSessionEvents();
    this.syncRestoredHistory();
    this.startInitCheck();

    if (this.opts.transportRegistry) {
      await this.opts.transportRegistry.startAll(this.interactiveSession);
    }
  }

  /**
   * Full, idempotent channel teardown (CLI-075). Unwires every session listener, drains both
   * request queues, stops the init poller, disposes the render-state manager, stops transports, and
   * — unless a graceful `shutdown()` already ran — shuts the underlying session down so a discarded
   * or switched-away channel releases its background tasks, subagent processes, and timers.
   */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.sessionStarted = false;
    this.unwireSessionEvents();
    this.cancelAllPermissions();
    this.cancelAllUserActions();
    this.stopInitCheck();
    this.onChange = null;
    this.stateManager.dispose();
    if (this.opts.transportRegistry) {
      await this.opts.transportRegistry.stopAll();
    }
    if (!this.isShuttingDown) {
      await this.shutdownSessionBounded('other', 'channel stopped', SHUTDOWN_TIMEOUT_MS);
    }
  }

  // ── Additional methods for App.tsx ───────────────────────────

  getSession(): InteractiveSession {
    return this.interactiveSession;
  }

  getRegistry(): CommandRegistry {
    return this.registry;
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

  async shutdown(options?: { reason?: TSessionEndReason; timeoutMs?: number }): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    this.cancelAllUserActions();
    this.cancelAllPermissions();
    this.stateManager.addEntry(messageToHistoryEntry(createSystemMessage('Shutting down...')));
    this.onChange?.();
    await this.shutdownSessionBounded(
      options?.reason ?? 'prompt_input_exit',
      'CLI shutdown',
      options?.timeoutMs ?? SHUTDOWN_TIMEOUT_MS,
    );
  }

  /**
   * Await the SDK-owned session shutdown, but never longer than `timeoutMs`. A hung subsystem
   * (unresolved background task, stuck child process) must not wedge process exit — a second
   * Ctrl+C force-quits (RUNTIME-33), and this bound guarantees the first one still completes.
   * Best-effort: shutdown errors are swallowed here (the process is exiting regardless).
   */
  private async shutdownSessionBounded(
    reason: TSessionEndReason,
    message: string,
    timeoutMs: number,
  ): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
      timer.unref?.();
    });
    await Promise.race([
      this.interactiveSession.shutdown({ reason, message }).catch(() => undefined), // allow-fallback: best-effort shutdown — process is exiting; a shutdown error must not block exit
      timeout,
    ]);
    if (timer) clearTimeout(timer);
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
    return new Promise<TUserActionResponse>((resolve) => {
      this.userActionQueue.push({ request, resolve, ...(id !== undefined ? { id } : {}) });
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
    return new Promise<TPermissionResultValue>((resolve) => {
      this.permissionQueue.push({
        toolName,
        toolArgs,
        resolve,
        ...(id !== undefined ? { id } : {}),
      });
      this.processNextPermission();
    });
  }

  /**
   * REMOTE-007 co-drive: another surface answered the prompt with this framework `id`, so dismiss the
   * still-showing local dialog. Resolving the local entry (cancelled) is a no-op on the framework side
   * — that id is already settled — but it clears the TUI's queue + render state.
   */
  private dismissPromptById(id: string): void {
    if (this.userActionQueue.some((entry) => entry.id === id)) {
      const remaining = this.userActionQueue.filter((entry) => entry.id !== id);
      const dismissed = this.userActionQueue.filter((entry) => entry.id === id);
      this.userActionQueue = remaining;
      this.processingUserAction = false;
      this.pendingUserAction = null;
      for (const entry of dismissed) entry.resolve({ type: 'cancelled' });
      this.processNextUserAction();
    }
    if (this.permissionQueue.some((entry) => entry.id === id)) {
      const remaining = this.permissionQueue.filter((entry) => entry.id !== id);
      const dismissed = this.permissionQueue.filter((entry) => entry.id === id);
      this.permissionQueue = remaining;
      this.processingPermission = false;
      this.permissionRequest = null;
      for (const entry of dismissed) entry.resolve(false);
      this.processNextPermission();
    }
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

  /**
   * Resolve every queued/in-flight permission request as `false` (deny) — abort, cancelQueue,
   * shutdown, stop. Symmetric to `cancelAllUserActions()`: tearing down must neither leave a tool's
   * permission promise dangling (the tool would hang) nor silently grant it (CLI-075 RUNTIME-32).
   */
  private cancelAllPermissions(): void {
    const queued = this.permissionQueue;
    this.permissionQueue = [];
    this.processingPermission = false;
    this.permissionRequest = null;
    for (const pending of queued) {
      pending.resolve(false);
    }
    this.onChange?.();
  }

  private wireSessionEvents(): void {
    const session = this.interactiveSession;
    const manager = this.stateManager;

    const onUserMessage = (content: string): void => {
      this.handleAutoNaming(content);
      manager.addEntry(attributedUserEcho(content, session));
    };
    const onComplete = (result: IExecutionResult): void => {
      manager.onComplete(result);
      manager.syncHistory(session.getFullHistory());
    };
    const onError = (error: Error): void => {
      manager.onError(error);
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
    // CMD-004 Stage E: the broadcast `history_cleared` is the transcript-refresh carrier — a clear
    // performed by ANY surface (co-driving remote /clear included) empties this transcript too.
    const onHistoryCleared = (): void => {
      manager.clearHistory();
    };
    this.bindSession('user_message', onUserMessage);
    this.bindSession('text_delta', manager.onTextDelta);
    this.bindSession('tool_start', manager.onToolStart);
    this.bindSession('tool_end', manager.onToolEnd);
    this.bindSession('thinking', manager.onThinking);
    this.bindSession('complete', onComplete);
    this.bindSession('interrupted', manager.onInterrupted);
    this.bindSession('error', onError);
    this.bindSession('context_update', manager.onContextUpdate);
    this.bindSession('compact', onCompact);
    this.bindSession('skill_activation', onSkillActivation);
    this.bindSession('memory_event', onMemoryEvent);
    this.bindSession('execution_workspace_event', onExecutionWorkspaceEvent);
    this.bindSession('history_cleared', onHistoryCleared);
    bindTuiSessionNoticeEvents(this.bindSession.bind(this), manager);

    // REMOTE-007: the TUI is a subscribed surface for the transport-neutral permission/ask events. It
    // renders each through its existing Ink queues and answers via `resolvePermission`/`resolveAsk`; a
    // `prompt_resolved` (from co-drive or the framework's teardown drain) dismisses the local dialog.
    const onPermissionRequest: IInteractiveSessionEvents['permission_request'] = ({
      id,
      toolName,
      toolArgs,
    }) => {
      void this.handlePermissionRequest(toolName, toolArgs, id)
        .then((result) => session.resolvePermission(id, result))
        .catch(() => session.resolvePermission(id, false));
    };
    const onAskRequest: IInteractiveSessionEvents['ask_request'] = ({ id, request }) => {
      void this.askUser(request, id)
        .then((response) => session.resolveAsk(id, response))
        .catch(() => session.resolveAsk(id, { type: 'cancelled' }));
    };
    const onPromptResolved: IInteractiveSessionEvents['prompt_resolved'] = ({ id }) => {
      this.dismissPromptById(id);
    };
    this.bindSession('permission_request', onPermissionRequest);
    this.bindSession('ask_request', onAskRequest);
    this.bindSession('prompt_resolved', onPromptResolved);
  }

  /** Register a session listener and retain the binding so `unwireSessionEvents()` can remove it. */
  private bindSession<E extends TInteractiveEventName>(
    event: E,
    handler: IInteractiveSessionEvents[E],
  ): void {
    bindTuiSessionEvent(
      this.interactiveSession,
      event,
      handler,
      (error) => {
        const report = this.opts.onSessionEventDeliveryError;
        if (report) report(error, event);
        else this.stateManager.addSessionEventDeliveryError(error, event);
      },
      this.sessionEventBindings,
    );
  }

  /** Detach every session listener registered by `wireSessionEvents()` (CLI-075 RUNTIME-31). */
  private unwireSessionEvents(): void {
    for (const { event, handler } of this.sessionEventBindings) {
      this.interactiveSession.off(event, handler as IInteractiveSessionEvents[typeof event]);
    }
    this.sessionEventBindings = [];
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
