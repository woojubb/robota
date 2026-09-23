import type { TerminalHandoffController } from './terminal-handoff-controller.js';
import type { ITuiSessionEventNotice } from './tui-session-events.js';
import type { IPendingPermissionRequest } from './types.js';
import type {
  IActionRequest,
  IHistoryEntry,
  TActionResponse,
  TModelEffortSelection,
  TSessionEndReason,
  TPermissionMode,
} from '@robota-sdk/agent-core';
import type { ICommand } from '@robota-sdk/agent-interface-command';
import type {
  IExecutionDetailPage,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';
import type { IInteractiveSessionEvents, IToolState } from '@robota-sdk/agent-interface-session';

export interface ITuiCommandQueryPort {
  getCommands(filter?: string): ICommand[];
  getSubcommands(commandName: string): ICommand[];
}

export type TTuiSessionUiEventName = 'ui_intent' | 'session_renamed';

export interface ITuiSessionUiEventPort {
  on<E extends TTuiSessionUiEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;
  off<E extends TTuiSessionUiEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;
}

export interface ITuiRuntimeStatusSnapshot {
  permissionMode: TPermissionMode;
  sessionId: string;
  activePresetId?: string;
  effort?: TModelEffortSelection;
}

export interface ITuiChannelSnapshot {
  history: readonly IHistoryEntry[];
  streamingText: string;
  activeTools: readonly IToolState[];
  isThinking: boolean;
  isAborting: boolean;
  lastErrorMessage: string | null;
  isStalled: boolean;
  sessionEventNotices: readonly ITuiSessionEventNotice[];
  isShuttingDown: boolean;
  pendingPrompt: string | null;
  pendingCount: number;
  executionWorkspaceSnapshot: IExecutionWorkspaceSnapshot | null;
  selectedExecutionEntryId?: string;
  permissionRequest: IPendingPermissionRequest | null;
  pendingUserAction: IActionRequest | null;
  contextState: { percentage: number; usedTokens: number; maxTokens: number };
}

/**
 * Complete channel surface visible below the top-level App composition shell.
 *
 * Deliberately excludes the concrete-session, concrete-registry and mutable-state-manager
 * compatibility escapes retained by TuiInteractionChannel for non-React consumers.
 */
export interface ITuiAppChannelPort {
  readonly terminalHandoffController: TerminalHandoffController | undefined;
  readonly sessionName: string | undefined;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(onChange: () => void): () => void;
  getSnapshot(): ITuiChannelSnapshot;
  getCommandQueryPort(): ITuiCommandQueryPort;
  getSessionUiEventPort(): ITuiSessionUiEventPort;
  getRuntimeStatusSnapshot(fallbackPermissionMode: TPermissionMode): ITuiRuntimeStatusSnapshot;
  addEntry(entry: IHistoryEntry): void;
  handleInput(input: string): Promise<void>;
  abort(): void;
  cancelQueue(): void;
  stopWaitingSelfPacedLoop(): Promise<void>;
  shutdown(options?: { reason?: TSessionEndReason; timeoutMs?: number }): Promise<void>;
  selectExecutionWorkspaceEntry(entryId: string): void;
  readExecutionWorkspaceDetail(entryId: string): Promise<IExecutionDetailPage>;
  sendAgentJob(taskId: string, input: string): Promise<void>;
  resolveUserAction(request: IActionRequest, response: TActionResponse): void;
}
