/**
 * WireTuiChannel — the full TUI's channel for a session this terminal is attached to over the
 * session protocol (a daemon's session).
 *
 * The in-process channel owns its session; this one owns only its view of one. Each frame is
 * projected into the same render state the in-process event projector builds, and what the user does
 * goes back as a client message. Leaving — stop, shutdown, `/exit`, a closed connection — only
 * detaches: nothing sent from here ends the host's session, and a question left open stays open for
 * the other clients.
 *
 * The commands that belong to this terminal (`/shell`, `/editor`, `/theme`, `/keybindings`) never
 * reach the host: they run here, on this terminal and in its working directory.
 *
 * An observing terminal (`role: 'observe'`) sends only the reads an observer may send. Anything the
 * user does that would change the session is refused here with a notice; `/exit` and this terminal's
 * own commands still run.
 */

import {
  createSystemMessage,
  messageToHistoryEntry,
  printablePeerDriver,
} from '@robota-sdk/agent-core';
import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';
import { isObserverMessageType } from '@robota-sdk/agent-transport/client';

import { AttentionCoordinator } from './attention/attention-coordinator.js';
import { attributedUserEcho } from './attributed-user-echo.js';
import { shortSessionId } from './short-session-id.js';
import { parseSlashCommandInput } from './slash-command-input.js';
import { TuiChannelLifecycleCoordinator } from './tui-channel-lifecycle-coordinator.js';
import { TuiPermissionQueue, TuiUserActionQueue } from './tui-interaction-queues.js';
import { TuiStateManager } from './tui-state-manager.js';
import { waitingLoopStopNotice } from './waiting-loop-stop-notice.js';
import { WireHistorySync } from './wire-history-sync.js';
import {
  createTuiClientCommandHost,
  findTuiClientCommand,
  runTuiClientCommand,
} from './wire-tui-client-commands.js';
import {
  displayDriverId,
  filterCommandCatalog,
  findSubcommands,
  toCommandCatalog,
  toHistoryEntries,
} from './wire-tui-projection.js';

import type {
  IAttachedSessionConnection,
  TAttachedSessionEnd,
} from './attached-session-connection.js';
import type { IAttentionSource } from './attention/attention-tracker.js';
import type { TerminalHandoffController } from './terminal-handoff-controller.js';
import type {
  ITuiClientCommand,
  ITuiClientCommands,
  TTuiClientCommandHost,
} from './wire-tui-client-commands.js';
import type { IOwnDriver } from './wire-tui-projection.js';
import type {
  ITuiAppChannelPort,
  ITuiChannelSnapshot,
  ITuiCommandQueryPort,
  ITuiRuntimeStatusSnapshot,
  ITuiSessionUiEventPort,
  TTuiSessionUiEventName,
} from './tui-app-channel-port.js';
import type {
  IActionRequest,
  IHistoryEntry,
  TActionResponse,
  TPermissionMode,
  TSessionEndReason,
} from '@robota-sdk/agent-core';
import type { ICommand } from '@robota-sdk/agent-interface-command';
import type { IExecutionDetailPage } from '@robota-sdk/agent-interface-execution';
import type {
  IAskRequestEvent,
  IInteractiveSessionEvents,
  IPermissionRequestEvent,
  ISessionListingEntry,
  ISessionRenamedEvent,
  ISessionStatusSnapshot,
  IUiIntentEvent,
  TWaitingLoopStopOutcome,
} from '@robota-sdk/agent-interface-session';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport/client';

interface IWireTuiChannelBaseOptions {
  readonly connection: IAttachedSessionConnection;
  /** The driver id the host gave this connection; the transcript shows its prompts as the user's. */
  readonly driverId?: string;
  readonly sessionName?: string;
  readonly terminalHandoff?: TerminalHandoffController;
  readonly attention?: IAttentionSource;
  /** Told once, when this terminal stops showing the session: the user left or the connection closed. */
  readonly onEnd?: (reason: TAttachedSessionEnd) => void;
  /**
   * How the host let this terminal on: `'drive'` (the default) or `'observe'`, which may only read
   * the session. The host refuses anything else from an observer; this channel does not send it.
   */
  readonly role?: 'drive' | 'observe';
}

export type TWireTuiChannelOptions = IWireTuiChannelBaseOptions &
  (
    | {
        /** The commands this terminal runs itself instead of sending them to the host. */
        readonly clientCommands: ITuiClientCommands;
        /** This terminal's working directory, where its own commands run. */
        readonly cwd: string;
      }
    | { readonly clientCommands?: undefined }
  );

/** Everything a view of the session reads beside its history, asked again after a session switch. */
const SNAPSHOT_REQUESTS = [
  'get-context',
  'get-commands',
  'get-status',
  'get-executing',
  'get-pending',
  'get-execution-workspace',
] as const;
/**
 * A question asked before this terminal attached is not sent to it again unless it asks. An observer
 * never asks: it answers no question.
 */
const DRIVER_SNAPSHOT_REQUESTS = [...SNAPSHOT_REQUESTS, 'get-prompts'] as const;
/** After a command the host may have changed the status, the context window or the catalog. */
const COMMAND_REFRESH_REQUESTS = ['get-context', 'get-status', 'get-commands'] as const;
/** In a shared session these would end it for everyone; here they only take this terminal away. */
const DETACH_COMMANDS: ReadonlySet<string> = new Set(['exit', 'quit']);
/** Screens that need this process's own plugin adapter or transport registry. */
const IN_PROCESS_SCREENS: ReadonlySet<IUiIntentEvent['intent']['type']> = new Set([
  'show-plugin-manager',
  'show-settings',
]);
const ATTACHED = 'while attached to a daemon';
const READ_ONLY_NOTICE =
  'Read only: this terminal observes the session and cannot change it. /exit detaches.';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The React-facing `ui_intent` / `session_renamed` port, fed from frames instead of a session. */
class WireSessionUiEvents implements ITuiSessionUiEventPort {
  private readonly handlers: {
    [E in TTuiSessionUiEventName]: Set<IInteractiveSessionEvents[E]>;
  } = { ui_intent: new Set(), session_renamed: new Set() };

  on<E extends TTuiSessionUiEventName>(event: E, handler: IInteractiveSessionEvents[E]): void {
    this.handlers[event].add(handler);
  }

  off<E extends TTuiSessionUiEventName>(event: E, handler: IInteractiveSessionEvents[E]): void {
    this.handlers[event].delete(handler);
  }

  emitUiIntent(event: IUiIntentEvent): void {
    for (const handler of [...this.handlers.ui_intent]) handler(event);
  }

  emitSessionRenamed(event: ISessionRenamedEvent): void {
    for (const handler of [...this.handlers.session_renamed]) handler(event);
  }
}

export class WireTuiChannel implements ITuiAppChannelPort {
  sessionName: string | undefined;

  private manager: TuiStateManager;
  private readonly userActions: TuiUserActionQueue;
  private readonly permissions: TuiPermissionQueue;
  private readonly attention: AttentionCoordinator | undefined;
  private readonly lifecycle: TuiChannelLifecycleCoordinator;
  private readonly uiEvents = new WireSessionUiEvents();
  /** One host for every client command, so one terminal handoff at a time spans all of them. */
  private readonly clientCommands:
    { readonly set: ITuiClientCommands; readonly host: TTuiClientCommandHost } | undefined;
  private readonly commandQueryPort: ITuiCommandQueryPort = {
    getCommands: (filter) => filterCommandCatalog(this.commandCatalog, filter),
    getSubcommands: (name) => findSubcommands(this.commandCatalog, name),
  };
  /** Only reads cross the wire from here, and nothing the user does changes the session. */
  private readonly readOnly: boolean;
  private commandCatalog: ICommand[] = [];
  private status: ISessionStatusSnapshot | undefined;
  /** How many prompts wait in the host's queue, the one `pendingPrompt` shows first among them. */
  private pendingCount = 0;
  private hostSessions: readonly ISessionListingEntry[] | undefined;
  private sessionListSequence = 0;
  /** Only the answer to the latest listing is shown: an earlier one may predate a switch. */
  private sessionListRequestId: string | undefined;
  /**
   * The picker `/resume` asked for, opened on the host's answer: what this terminal held since it
   * attached may be stale or missing, and an empty picker would only block the prompt.
   */
  private pendingPicker: IUiIntentEvent | undefined;
  private readonly hostHistory: WireHistorySync;
  /** Set when the channel attaches: history entries older than that are not this terminal's. */
  private own: IOwnDriver | undefined;
  /**
   * Commands sent and not yet answered, by request id; `handleInput` settles when the host's answer
   * is shown. The host echoes the id, so an answer settles only the command it answers.
   */
  private readonly pendingCommands = new Map<string, () => void>();
  private commandSequence = 0;
  /** Detail pages asked for and not yet answered, by request id. */
  private readonly pendingDetails = new Map<
    string,
    { readonly resolve: (page: IExecutionDetailPage) => void; readonly reject: (error: Error) => void }
  >();
  private detailSequence = 0;
  /** Esc's loop stops waiting for the host's outcome, by request id. */
  private readonly pendingLoopStops = new Map<
    string,
    (outcome: TWaitingLoopStopOutcome | undefined) => void
  >();
  private loopStopSequence = 0;
  /**
   * Inputs sent to a background task, by task id, oldest first. The host's control result names the
   * task but no request, so a result settles the oldest send to that task.
   */
  private readonly pendingTaskSends = new Map<string, ((message?: string) => void)[]>();
  /**
   * The switch the picker asked for, settled by the host's answer: `session_switched`, or a refusal
   * that names its request (or, from an older host, a protocol error that names none). A refusal
   * never settles a command.
   */
  private pendingSessionChange: { readonly requestId: string; readonly settle: () => void } | undefined;
  private sessionChangeSequence = 0;
  /** Bumped on a session switch: a question from a session no longer shown is never answered. */
  private promptGeneration = 0;
  /** Questions on screen or waiting for it: the host may send one again (`get-prompts`). */
  private readonly shownPromptIds = new Set<string>();
  /** Questions another client settled: dismissing them here answers nothing. */
  private readonly settledPromptIds = new Set<string>();
  /**
   * Bumped when the transcript starts over for another session. The terminal prints its transcript
   * once, counting what it printed, so a new one is printed from its start rather than past that count.
   */
  private transcriptGeneration = 0;
  private readonly unsubscribers: (() => void)[] = [];
  /** From here on nothing is sent: the terminal left, and the session is not this terminal's to end. */
  private detached = false;
  private ended = false;
  private onChange: (() => void) | null = null;

  constructor(private readonly options: TWireTuiChannelOptions) {
    this.sessionName = options.sessionName;
    this.readOnly = options.role === 'observe';
    this.manager = this.createManager();
    this.clientCommands =
      options.clientCommands !== undefined
        ? {
            set: options.clientCommands,
            host: createTuiClientCommandHost({
              terminalHandoff: options.terminalHandoff,
              cwd: options.cwd,
            }),
          }
        : undefined;
    this.hostHistory = new WireHistorySync({
      request: (fromIndex) =>
        this.send(fromIndex === 0 ? { type: 'get-history' } : { type: 'get-history', fromIndex }),
      show: (entries, echoes) => this.manager.syncHostHistory(entries, echoes),
      revive: (entries) => toHistoryEntries(entries, this.own),
    });
    this.userActions = new TuiUserActionQueue(() => this.notify());
    this.permissions = new TuiPermissionQueue(() => this.notify());
    this.attention = options.attention
      ? new AttentionCoordinator({
          source: options.attention,
          onRecap: (line) => this.manager.addAttentionRecap(line),
        })
      : undefined;
    this.lifecycle = new TuiChannelLifecycleCoordinator(
      {
        start: async () => this.attach(),
        stop: async () => {
          this.detach();
          this.attention?.unwire();
          this.onChange = null;
          this.manager.dispose();
        },
        beginShutdown: () => {
          this.detach();
          this.notice('Detached. The session keeps running.');
        },
        // Leaving never ends the host's session: it is shared, and it keeps running without us.
        shutdownSession: async () => undefined,
      },
      0,
    );
  }

  get terminalHandoffController(): TerminalHandoffController | undefined {
    return this.options.terminalHandoff;
  }

  async start(): Promise<void> {
    await this.lifecycle.start();
  }

  /** Detaches from the session; the connection belongs to whoever opened it. */
  async stop(): Promise<void> {
    await this.lifecycle.stop();
  }

  async shutdown(options?: { reason?: TSessionEndReason; timeoutMs?: number }): Promise<void> {
    await this.lifecycle.shutdown(options);
  }

  subscribe(onChange: () => void): () => void {
    this.onChange = onChange;
    return () => {
      if (this.onChange === onChange) this.onChange = null;
    };
  }

  getSnapshot(): ITuiChannelSnapshot {
    const manager = this.manager;
    return {
      history: manager.history,
      streamingText: manager.streamingText,
      activeTools: manager.activeTools,
      isThinking: manager.isThinking,
      isAborting: manager.isAborting,
      lastErrorMessage: manager.lastErrorMessage,
      isStalled: manager.isStalled,
      sessionEventNotices: manager.sessionEventNotices,
      isShuttingDown: this.lifecycle.isShuttingDown,
      pendingPrompt: manager.pendingPrompt,
      pendingCount: manager.pendingPrompt === null ? 0 : Math.max(this.pendingCount, 1),
      executionWorkspaceSnapshot: manager.executionWorkspaceSnapshot,
      ...(manager.selectedExecutionEntryId !== undefined
        ? { selectedExecutionEntryId: manager.selectedExecutionEntryId }
        : {}),
      permissionRequest: this.permissions.current,
      pendingUserAction: this.userActions.current,
      contextState: manager.contextState,
      ...(this.hostSessions !== undefined ? { hostSessions: this.hostSessions } : {}),
      transcriptGeneration: this.transcriptGeneration,
      ...(this.readOnly ? { readOnly: true } : {}),
      attached: true,
    };
  }

  getCommandQueryPort(): ITuiCommandQueryPort {
    return this.commandQueryPort;
  }

  getSessionUiEventPort(): ITuiSessionUiEventPort {
    return this.uiEvents;
  }

  getRuntimeStatusSnapshot(fallbackPermissionMode: TPermissionMode): ITuiRuntimeStatusSnapshot {
    const status = this.status;
    if (status === undefined) return { permissionMode: fallbackPermissionMode, sessionId: '' };
    return {
      permissionMode: status.permissionMode,
      sessionId: status.sessionId,
      effort: status.effort,
      modelId: status.model,
    };
  }

  addEntry(entry: IHistoryEntry): void {
    this.manager.addEntry(entry);
  }

  async handleInput(input: string): Promise<void> {
    if (!input.startsWith('/')) {
      if (this.refuseReadOnly()) return;
      // The host answers with its queue once it has taken the prompt.
      this.send({ type: 'submit', prompt: input });
      return;
    }
    const { name, args } = parseSlashCommandInput(input);
    if (DETACH_COMMANDS.has(name)) {
      this.end('user');
      return;
    }
    const clientCommand = findTuiClientCommand(this.clientCommands?.set, name);
    if (clientCommand !== undefined) {
      await this.runClientCommand(clientCommand, args);
      return;
    }
    if (this.refuseReadOnly()) return;
    // Settles when the host's answer is on screen, so what reads the settings after a command
    // (the status line, the theme) reads them after the host changed them.
    this.commandSequence += 1;
    const requestId = `wire-tui-command-${this.commandSequence}`;
    await new Promise<void>((settle) => {
      this.pendingCommands.set(requestId, settle);
      if (!this.send({ type: 'command', name, args, requestId })) this.settleCommand(requestId);
    });
  }

  /**
   * Runs a terminal-owned command here and shows its answer as the in-process session would. It
   * settles once what the command wrote is written: the App reads the appearance again after it.
   */
  private async runClientCommand(command: ITuiClientCommand, args: string): Promise<void> {
    const commands = this.clientCommands;
    if (commands === undefined) return;
    try {
      const { result, uiIntents } = await runTuiClientCommand(
        command,
        args,
        commands.host,
        commands.set,
      );
      for (const intent of uiIntents) {
        this.uiEvents.emitUiIntent({ intent, requesterDriverId: OWNER_DRIVER_ID });
      }
      this.notice(result.message);
    } catch (error) {
      this.notice(`/${command.name} failed: ${errorMessage(error)}`);
    }
  }

  abort(): void {
    if (this.refuseReadOnly()) return;
    this.manager.setAborting(true);
    this.userActions.cancelAll();
    this.permissions.cancelAll();
    this.send({ type: 'abort' });
  }

  cancelQueue(): void {
    if (this.refuseReadOnly()) return;
    this.send({ type: 'cancel-queue' });
    this.userActions.cancelAll();
    this.permissions.cancelAll();
    this.pendingCount = 0;
    this.manager.setPendingPrompt(null);
  }

  /** Esc on an idle prompt: the host's session decides which waiting loop, if any, stops. */
  async stopWaitingSelfPacedLoop(): Promise<void> {
    if (this.refuseReadOnly()) return;
    this.loopStopSequence += 1;
    const requestId = `wire-tui-loop-stop-${this.loopStopSequence}`;
    const outcome = await new Promise<TWaitingLoopStopOutcome | undefined>((settle) => {
      this.pendingLoopStops.set(requestId, settle);
      if (!this.send({ type: 'stop-waiting-loop', requestId })) this.settleLoopStop(requestId);
    });
    const notice = outcome === undefined ? undefined : waitingLoopStopNotice(outcome);
    if (notice !== undefined) this.notice(notice);
  }

  selectExecutionWorkspaceEntry(entryId: string): void {
    this.manager.selectExecutionWorkspaceEntry(entryId);
  }

  /** A page of what a workspace entry recorded, read from the host. An observer may read it too. */
  async readExecutionWorkspaceDetail(entryId: string): Promise<IExecutionDetailPage> {
    this.detailSequence += 1;
    const requestId = `wire-tui-detail-${this.detailSequence}`;
    return new Promise<IExecutionDetailPage>((resolve, reject) => {
      this.pendingDetails.set(requestId, { resolve, reject });
      if (!this.send({ type: 'read-execution-detail', requestId, entryId })) {
        this.rejectDetail(requestId, 'Could not reach the session.');
      }
    });
  }

  /** Settles once the host says whether the task took the input; a refusal is shown as a notice. */
  async sendAgentJob(taskId: string, input: string): Promise<void> {
    if (this.refuseReadOnly()) return;
    const failure = await new Promise<string | undefined>((settle) => {
      const waiting = this.pendingTaskSends.get(taskId) ?? [];
      waiting.push(settle);
      this.pendingTaskSends.set(taskId, waiting);
      if (!this.send({ type: 'send-background-task', taskId, input: { prompt: input } })) {
        this.settleTaskSend(taskId);
      }
    });
    if (failure !== undefined) this.notice(`Could not send to background task ${taskId}: ${failure}`);
  }

  resolveUserAction(request: IActionRequest, response: TActionResponse): void {
    this.userActions.resolveCurrent(request, response);
  }

  /**
   * Ask the host to show another session; its `session_switched` resets this channel. Settles on the
   * host's answer, so the picker's switch is pending until the session changed or was refused.
   */
  async requestSessionSwitch(sessionId: string): Promise<void> {
    if (this.refuseReadOnly()) return;
    // The host answers a switch to the session already shown with nothing: there is nothing to wait for.
    if (sessionId === this.status?.sessionId) return;
    // An earlier switch still waiting is overtaken by this one.
    this.settleSessionChange();
    this.sessionChangeSequence += 1;
    const requestId = `wire-tui-session-change-${this.sessionChangeSequence}`;
    await new Promise<void>((settle) => {
      this.pendingSessionChange = { requestId, settle };
      if (!this.send({ type: 'switch-session', sessionId, requestId })) this.settleSessionChange();
    });
  }

  // ── Frames → render state ─────────────────────────────────────

  private attach(): void {
    const { connection } = this.options;
    if (this.options.driverId !== undefined) {
      this.own = { driverId: this.options.driverId, since: Date.now() };
    }
    this.unsubscribers.push(
      connection.subscribe((frame) => this.onFrame(frame)),
      connection.onClose(() => this.end('closed')),
    );
    this.attention?.wire();
    this.requestSnapshot();
  }

  private onFrame(frame: TServerMessage): void {
    if (this.detached) return;
    try {
      this.project(frame);
    } catch (error) {
      // A frame this terminal cannot show must not take the connection's reader down with it.
      this.notice(`Could not show the session's ${frame.type} update: ${errorMessage(error)}`);
    }
  }

  private project(frame: TServerMessage): void {
    const manager = this.manager;
    switch (frame.type) {
      case 'user_message': {
        const driverId = displayDriverId(frame.driverId, this.options.driverId) ?? null;
        this.hostHistory.echo(
          attributedUserEcho(frame.content, { getActiveDriverId: () => driverId }),
          frame.content,
        );
        return;
      }
      case 'text_delta':
        manager.onTextDelta(frame.delta);
        return;
      case 'tool_start':
        manager.onToolStart(frame.state);
        return;
      case 'tool_end':
        manager.onToolEnd(frame.state);
        return;
      case 'thinking':
        manager.onThinking(frame.isThinking);
        // A turn starting or ending is when the host's queue moves.
        this.send({ type: 'get-pending' });
        return;
      case 'executing':
        if (frame.executing !== manager.isThinking) manager.onThinking(frame.executing);
        return;
      case 'complete':
        manager.onComplete(frame.result);
        this.attention?.onComplete();
        // The answer is in the host's history now; only what came after the known entries is read.
        this.hostHistory.readTail();
        return;
      case 'interrupted':
        manager.onInterrupted();
        // The host kept the partial answer; the next turn's prompt must not take its place.
        this.hostHistory.readTail();
        return;
      case 'error':
        manager.onError(new Error(frame.message));
        this.attention?.onError();
        this.hostHistory.readTail();
        return;
      case 'history':
        this.hostHistory.onPage(frame);
        return;
      case 'history_changed':
        this.hostHistory.reload();
        return;
      case 'history_cleared':
        manager.clearHistory();
        this.hostHistory.reset();
        this.hostHistory.reload();
        return;
      case 'context':
        manager.onContextUpdate(frame.state);
        return;
      case 'turn_source':
        this.attention?.onTurnSource(frame.source);
        return;
      case 'pending':
        this.pendingCount = frame.pendingCount ?? (frame.pending === null ? 0 : 1);
        manager.setPendingPrompt(frame.pending);
        return;
      case 'execution_workspace_event':
        manager.syncExecutionWorkspaceSnapshot(frame.snapshot);
        this.attention?.onWorkspaceSnapshot(frame.snapshot);
        return;
      case 'plan_event':
        manager.addSessionEventNotice({ event: 'plan_event', payload: frame.event });
        return;
      case 'context_file_refreshed':
        manager.addSessionEventNotice({ event: 'context_file_refreshed', payload: frame.event });
        return;
      case 'branch_event':
        manager.addSessionEventNotice({ event: 'branch_event', payload: frame.event });
        return;
      default:
        this.projectSessionFrame(frame);
    }
  }

  /** Frames about the session rather than its turn: questions, commands, status, switching. */
  private projectSessionFrame(frame: TServerMessage): void {
    switch (frame.type) {
      case 'permission_request':
        this.askPermission(frame.event);
        return;
      case 'ask_request':
        this.askUser(frame.event);
        return;
      case 'prompt_resolved':
        this.dismissPrompt(frame.event.id);
        return;
      case 'ui_intent':
        this.showUiIntent(frame.event);
        return;
      case 'session_renamed':
        this.rename(frame.event.name);
        return;
      case 'session_status':
        this.applyStatus(frame.status);
        return;
      case 'commands':
        this.commandCatalog = toCommandCatalog(frame.commands, frame.skills);
        this.notify();
        return;
      case 'command_result':
        this.showCommandResult(frame);
        return;
      case 'sessions':
        if (frame.requestId !== this.sessionListRequestId) return;
        this.hostSessions = frame.listing.sessions;
        this.notify();
        this.openPendingPicker();
        return;
      case 'sessions_error':
        if (frame.requestId !== this.sessionListRequestId) return;
        // Asked for at attach too, where a host without a session list is nothing to report.
        if (this.pendingPicker !== undefined) {
          this.pendingPicker = undefined;
          this.notice(frame.message);
        }
        return;
      case 'session_switched':
        this.settleSessionChange();
        this.followSessionSwitch(frame.event.sessionId);
        return;
      case 'session_change_failed':
        // Only the client that asked is told. It answers the switch, never a command.
        if (frame.requestId === undefined || frame.requestId === this.pendingSessionChange?.requestId) {
          this.settleSessionChange();
        }
        this.notice(frame.message);
        return;
      case 'protocol_error':
        // A command the host could not run answers with this, naming the command's request. A host
        // older than `session_change_failed` refuses a switch with one that names no request.
        if (frame.requestId !== undefined) this.settleCommand(frame.requestId);
        else this.settleSessionChange();
        this.notice(frame.message);
        return;
      case 'resume_gap':
        // Frames were lost, perhaps the page a history read waits for: read everything again.
        this.hostHistory.restart();
        this.requestState();
        return;
      default:
        this.projectReply(frame);
    }
  }

  /** Answers to one request of this terminal's: a detail page, a loop stop, a task's input. */
  private projectReply(frame: TServerMessage): void {
    switch (frame.type) {
      case 'execution_detail': {
        const pending = this.pendingDetails.get(frame.requestId);
        this.pendingDetails.delete(frame.requestId);
        pending?.resolve(frame.page);
        return;
      }
      case 'execution_detail_error':
        this.rejectDetail(frame.requestId, frame.message);
        return;
      case 'waiting_loop_stop':
        this.settleLoopStop(frame.requestId, frame.outcome);
        return;
      case 'background_task_control_result':
        if (frame.action !== 'send') return;
        this.settleTaskSend(frame.taskId, frame.success ? undefined : (frame.message ?? 'refused'));
        return;
      default:
        // Other background-task and usage frames: the full TUI reads background work from the workspace.
        return;
    }
  }

  /** A question this terminal shows already is not shown twice (`get-prompts` sends it again). */
  private showsPrompt(id: string): boolean {
    if (this.shownPromptIds.has(id)) return true;
    this.shownPromptIds.add(id);
    return false;
  }

  private askPermission(event: IPermissionRequestEvent): void {
    if (this.showsPrompt(event.id)) return;
    this.attention?.onNeedsInput();
    // A peer turn's ask names the peer, printed only as a plain identifier.
    const requestedByPeer = event.requesterDriverId?.startsWith('peer:')
      ? printablePeerDriver(event.requesterDriverId)
      : undefined;
    const generation = this.promptGeneration;
    void this.permissions
      .enqueue(
        event.toolName,
        event.toolArgs,
        event.id,
        event.canPersistProjectPermission,
        requestedByPeer,
      )
      .then((result) =>
        this.answer(generation, event.id, { type: 'permission-response', id: event.id, result }),
      );
  }

  private askUser(event: IAskRequestEvent): void {
    if (this.showsPrompt(event.id)) return;
    this.attention?.onNeedsInput();
    const generation = this.promptGeneration;
    void this.userActions
      .enqueue(event.request, event.id)
      .then((response) =>
        this.answer(generation, event.id, { type: 'ask-response', id: event.id, response }),
      );
  }

  private answer(generation: number, id: string, message: TClientMessage): void {
    if (generation !== this.promptGeneration) return;
    this.shownPromptIds.delete(id);
    if (this.settledPromptIds.delete(id)) return;
    this.send(message);
  }

  /** Another client answered first: take the question off this screen without answering it. */
  private dismissPrompt(id: string): void {
    this.settledPromptIds.add(id);
    const dismissedAction = this.userActions.dismissById(id);
    const dismissedPermission = this.permissions.dismissById(id);
    if (!dismissedAction && !dismissedPermission) this.settledPromptIds.delete(id);
  }

  private showUiIntent(event: IUiIntentEvent): void {
    // An unattributed intent reaches every client; the App's own rule leaves it to its issuer.
    if (event.requesterDriverId === undefined) {
      this.uiEvents.emitUiIntent(event);
      return;
    }
    if (IN_PROCESS_SCREENS.has(event.intent.type)) {
      this.notice(`That screen is not available ${ATTACHED}.`);
      return;
    }
    // The host routes an attributed intent only to the client that asked: this terminal's operator.
    const own: IUiIntentEvent = { ...event, requesterDriverId: OWNER_DRIVER_ID };
    if (event.intent.type === 'show-session-picker') {
      this.pendingPicker = own;
      if (!this.requestSessionList()) this.pendingPicker = undefined;
      return;
    }
    this.uiEvents.emitUiIntent(own);
  }

  private openPendingPicker(): void {
    const picker = this.pendingPicker;
    if (picker === undefined) return;
    this.pendingPicker = undefined;
    this.uiEvents.emitUiIntent(picker);
  }

  private rename(name: string): void {
    this.sessionName = name;
    this.uiEvents.emitSessionRenamed({ name });
    this.notify();
  }

  /** The session is labelled by its name, or by its id until it has one: never by the host's label. */
  private applyStatus(status: ISessionStatusSnapshot): void {
    this.status = status;
    this.manager.onContextUpdate(status.context);
    const label =
      status.sessionName ??
      (status.sessionId !== '' ? shortSessionId(status.sessionId) : undefined);
    if (label !== undefined && label !== this.sessionName) this.rename(label);
  }

  private showCommandResult(frame: Extract<TServerMessage, { type: 'command_result' }>): void {
    for (const type of COMMAND_REFRESH_REQUESTS) this.send({ type });
    // A command that started a turn says nothing itself; the turn is its answer.
    if (frame.data?.['sessionExecution'] === true) {
      this.send({ type: 'get-pending' });
    } else {
      this.notice(frame.message);
    }
    if (frame.requestId !== undefined) this.settleCommand(frame.requestId);
  }

  private settleCommand(requestId: string): void {
    const settle = this.pendingCommands.get(requestId);
    this.pendingCommands.delete(requestId);
    settle?.();
  }

  private rejectDetail(requestId: string, message: string): void {
    const pending = this.pendingDetails.get(requestId);
    this.pendingDetails.delete(requestId);
    pending?.reject(new Error(message));
  }

  private settleLoopStop(requestId: string, outcome?: TWaitingLoopStopOutcome): void {
    const settle = this.pendingLoopStops.get(requestId);
    this.pendingLoopStops.delete(requestId);
    settle?.(outcome);
  }

  /** Settles the oldest input sent to the task; `failure` is why the host refused it. */
  private settleTaskSend(taskId: string, failure?: string): void {
    const waiting = this.pendingTaskSends.get(taskId);
    const settle = waiting?.shift();
    if (waiting !== undefined && waiting.length === 0) this.pendingTaskSends.delete(taskId);
    settle?.(failure);
  }

  /** An observer is told it cannot change the session; true when this terminal only observes. */
  private refuseReadOnly(): boolean {
    if (this.readOnly) this.notice(READ_ONLY_NOTICE);
    return this.readOnly;
  }

  private settleSessionChange(): void {
    const pending = this.pendingSessionChange;
    this.pendingSessionChange = undefined;
    pending?.settle();
  }

  /** The host now serves another session: nothing shown belongs to it, so start over from it. */
  private followSessionSwitch(sessionId: string): void {
    this.promptGeneration += 1;
    this.userActions.cancelAll();
    this.permissions.cancelAll();
    this.shownPromptIds.clear();
    this.settledPromptIds.clear();
    this.status = undefined;
    this.pendingCount = 0;
    this.hostHistory.reset();
    this.manager.dispose();
    this.manager = this.createManager();
    // A new transcript, printed from its start whatever this render also brings.
    this.transcriptGeneration += 1;
    this.notice(`Switched to session ${sessionId}.`);
    // Until the new session's status names it.
    this.rename(shortSessionId(sessionId));
    this.requestSnapshot();
  }

  // ── Requests ──────────────────────────────────────────────────

  private requestSnapshot(): void {
    this.hostHistory.reload();
    this.requestState();
  }

  /** Everything shown beside the history. */
  private requestState(): void {
    for (const type of this.readOnly ? SNAPSHOT_REQUESTS : DRIVER_SNAPSHOT_REQUESTS) {
      this.send({ type });
    }
    this.requestSessionList();
  }

  private requestSessionList(): boolean {
    this.sessionListSequence += 1;
    const id = `wire-tui-sessions-${this.sessionListSequence}`;
    this.sessionListRequestId = id;
    return this.send({ type: 'list-sessions', requestId: id });
  }

  private send(message: TClientMessage): boolean {
    if (this.detached) return false;
    // The host would refuse it: an observer sends only reads.
    if (this.readOnly && !isObserverMessageType(message.type)) return false;
    try {
      this.options.connection.send(message);
      return true;
    } catch (error) {
      this.notice(`Could not reach the session: ${errorMessage(error)}`);
      return false;
    }
  }

  // ── Leaving ───────────────────────────────────────────────────

  private end(reason: TAttachedSessionEnd): void {
    if (this.ended) return;
    this.ended = true;
    this.detach();
    this.notice(
      reason === 'closed'
        ? 'The connection to the session closed.'
        : 'Detached. The session keeps running.',
    );
    this.options.onEnd?.(reason);
  }

  /** Stop listening and sending. An open question is dropped here and stays open for others. */
  private detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.pendingPicker = undefined;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    this.userActions.cancelAll();
    this.permissions.cancelAll();
    const pending = [...this.pendingCommands.values()];
    this.pendingCommands.clear();
    for (const settle of pending) settle();
    this.settleSessionChange();
    for (const requestId of [...this.pendingDetails.keys()]) {
      this.rejectDetail(requestId, 'Detached from the session.');
    }
    for (const requestId of [...this.pendingLoopStops.keys()]) this.settleLoopStop(requestId);
    const taskSends = [...this.pendingTaskSends.values()].flat();
    this.pendingTaskSends.clear();
    for (const settle of taskSends) settle();
  }

  // ── Render state ──────────────────────────────────────────────

  private createManager(): TuiStateManager {
    const manager = new TuiStateManager();
    manager.onChange = () => this.notify();
    return manager;
  }

  private notice(text: string): void {
    this.manager.addEntry(messageToHistoryEntry(createSystemMessage(text)));
  }

  private notify(): void {
    this.onChange?.();
  }
}
