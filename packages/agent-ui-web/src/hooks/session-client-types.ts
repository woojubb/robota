import type { TConnectionStatus, TClientMessage } from '../client/ws-session-client.js';
import type { TPendingPrompt } from './prompt-state.js';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';
import type {
  IDiffLine,
  IToolState,
  ISettingsSnapshot,
  TDriverId,
  TPermissionResultValue,
  TSettingsPatch,
} from '@robota-sdk/agent-interface-session';
import type {
  IBackgroundTaskState,
  IExecutionDetailRecord,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';
import type { IWireAgentDefinitionSummary, TServerMessage } from '@robota-sdk/agent-transport';

export type TPersonalUsageReport = Extract<
  TServerMessage,
  { type: 'personal_usage_report' }
>['report'];
export type TStoredSessionUsageReport = Extract<
  TServerMessage,
  { type: 'stored_session_usage_report' }
>['report'];
/** The commands and skills the session offers — what a `/` menu lists. */
export type TCommandCatalog = Omit<Extract<TServerMessage, { type: 'commands' }>, 'type'>;
/** The session's status beside the conversation: model, permission mode, effort, context. */
export type TSessionStatus = Extract<TServerMessage, { type: 'session_status' }>['status'];

/**
 * #3282 §2 (part 2): the models a person may switch to, grouped by configured provider profile —
 * what the model control's pop-up menu is built from. `null` until requested (`list-models`).
 */
export type TModelListSnapshot = Omit<
  Extract<TServerMessage, { type: 'model_list' }>,
  'type' | 'requestId'
>;

/** The host's sessions in this workspace, which one is current, and the records it could not read. */
export type TSessionListing = Extract<TServerMessage, { type: 'sessions' }>['listing'];
/** Why the host did not list its sessions: it cannot (`not_available`), or listing failed. */
export type TSessionsError = Omit<Extract<TServerMessage, { type: 'sessions_error' }>, 'type' | 'requestId'>;

export type TCurrentSessionUsageReport = Extract<
  TServerMessage,
  { type: 'usage_report' }
>['report'];

/** #3282 §4c — the Project panel's reads. Each result crosses the wire unchanged from the session
 *  method's own return value (see `wire-messages.ts`'s doc comment on `project_status`). */
export type TProjectStatusRead = Extract<TServerMessage, { type: 'project_status' }>['result'];
export type TProjectDiffRead = Extract<TServerMessage, { type: 'project_diff' }>['result'];
export type TProjectMemoryRead = Extract<TServerMessage, { type: 'project_memory' }>['result'];

export interface IConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  /** REMOTE-014 E5: the co-driving author of a user turn. */
  author?: string;
}

/**
 * The outcome of a slash command, shown in the conversation where it was typed — the TUI adds the
 * same outcome to its transcript. `info` is a command this surface cannot carry out.
 */
export interface ICommandOutputEntry {
  id: string;
  role: 'command';
  name: string;
  content: string;
  tone: 'success' | 'error' | 'info';
}

/** The tool calls of one finished turn, kept in the conversation ahead of the reply they led to. */
export interface IToolGroupEntry {
  id: string;
  role: 'tools';
  tools: readonly IActiveTool[];
}

/** One file an Edit/Write call touched during a turn, and the (latest) diff a click can open. */
export interface IChangedFileSummary {
  path: string;
  added: number;
  removed: number;
  diffLines: readonly IDiffLine[];
}

/** #3288: a turn that changed files ends with this compact summary row. */
export interface IChangedFilesEntry {
  id: string;
  role: 'changed-files';
  files: readonly IChangedFileSummary[];
}

export type TConversationEntry =
  | IConversationMessage
  | ICommandOutputEntry
  | IToolGroupEntry
  | IChangedFilesEntry;

export interface IActiveTool {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  input?: string;
  result?: IToolState['result'];
  /** #3288: correlates this call across `tool_start`/`tool_end` — how a finished call is matched. */
  executionId?: string;
  /** #3288: a unified diff (Edit/Write), built server-side — the same one an approval prompt showed. */
  diffLines?: readonly IDiffLine[];
  /** #3288: the file `diffLines` concerns, workspace-relative when the server could make it so. */
  diffFile?: string;
  /** #3288: the tool's raw result payload (Shell output, Read content, …), already capped server-side. */
  toolResultData?: string;
  /** #3288: a workspace-relative display form of a path argument, additive to `input`/`firstArg`. */
  displayPath?: string;
  /** #3288: set when this call is a projected `/command` tool — render "Ran /<commandName>". */
  commandName?: string;
  /** #3288: true for an internal signal tool (e.g. goal-status) — never rendered as a call. */
  internal?: boolean;
}

/**
 * #3280 §2: a prompt the host queued behind the running turn — the server has already taken it, so it
 * is not lost, but it will not run until the turn ends. `count` is the TOTAL number waiting (the shown
 * `text` plus any behind it), matching the wire's `pendingCount`.
 */
export interface IQueuedPrompt {
  text: string;
  count: number;
}

export interface ISessionNotice {
  id: string;
  /**
   * `session-change-refused`: the host refused a new or switch this surface asked for.
   * `background-task-control-failed`: a Stop in the Agents panel did not take effect.
   * `command-failed` (#3282 §2 part 2): a change made through a status control (model/mode/effort)
   * failed — a plain notice rather than a conversation card, since the control's own label is where
   * a successful change confirms itself and the label stays unchanged when it fails.
   */
  kind:
    | 'session-error'
    | 'protocol-error'
    | 'session-change-refused'
    | 'background-task-control-failed'
    | 'command-failed';
  message: string;
  /**
   * A `session-error` classified at the wire boundary (#3289 §3) — present only when the host could
   * tell what kind of failure this was. `SessionNotices` maps it to one plain sentence and keeps
   * `message` behind a "Details" disclosure; absent, it shows `message` as before.
   */
  code?: 'auth' | 'rate_limit' | 'model_unavailable' | 'network' | 'provider';
  provider?: string;
  retryAfterSeconds?: number;
  /**
   * For `code: 'model_unavailable'`, the model the failed request tried — captured when the notice
   * was created (from the wire frame's own `model`, or `sessionStatus` at that moment), never read
   * live off the CURRENT session status. The person may switch models before dismissing the notice,
   * and a live read would then blame the new model for the old failure.
   */
  model?: string;
}

export interface ISessionClientHandle {
  connect: () => void;
  disconnect: () => void;
  send: (msg: TClientMessage) => void;
}

export type TMakeSessionClient<TStatus extends string = TConnectionStatus> = (callbacks: {
  onMessage: (msg: TServerMessage) => void;
  onStatusChange: (status: TStatus) => void;
}) => ISessionClientHandle;

export interface IWsSessionState<TStatus extends string = TConnectionStatus> {
  status: TStatus;
  /**
   * Set by `useWsSession` once its reconnect retries give up (issue #3280 §5): the runtime is not
   * coming back by itself. Cleared again once `status` reaches `connected`. Undefined for a reducer
   * with no such concept (e.g. the WebRTC surface, which has its own `failed`/`refused` statuses).
   */
  connectionLost?: boolean;
  messages: TConversationEntry[];
  activeTools: IActiveTool[];
  streamingText: string;
  isThinking: boolean;
  executionWorkspace: IExecutionWorkspaceSnapshot | null;
  sessionName: string | null;
  /** This connection's own driver id, learned from the server's first frame; null until then. */
  ownDriverId: TDriverId | null;
  /** Null until the session has answered; refreshed after every command. */
  commandCatalog: TCommandCatalog | null;
  /** Null until the session has answered; refreshed after every command and turn. */
  sessionStatus: TSessionStatus | null;
  /**
   * #3282 §2 (part 2): the models the model control's pop-up menu offers. Null until requested — the
   * menu asks for it when it opens (or refreshes it) rather than every surface fetching it eagerly.
   */
  modelList: TModelListSnapshot | null;
  /** Ask the session for the current model list (a fresh `list-models` round trip). */
  requestModelList: () => void;
  /** Null until the host has answered; refreshed on connect, after a switch, a rename and a turn. */
  sessionListing: TSessionListing | null;
  /** Set when the host answered the latest listing request with an error instead. */
  sessionsError: TSessionsError | null;
  requestSessions: () => void;
  /** Make another stored session current. A refusal arrives as a notice saying why. */
  switchSession: (sessionId: string) => void;
  /** Start a fresh session and make it current. */
  newSession: () => void;
  /** Rename a row in the list — current or not. A refusal arrives as a notice saying why. */
  renameSessionInList: (sessionId: string, name: string) => void;
  /** Delete a stored session for good. A refusal arrives as a notice saying why. */
  deleteSession: (sessionId: string) => void;
  /** Whether the session sidebar is shown; `/resume` opens it. */
  sessionSidebarOpen: boolean;
  setSessionSidebarOpen: (open: boolean) => void;
  send: (msg: TClientMessage) => void;
  /**
   * #3282 §2 (part 2): run a command the SAME way `send({type:'command', ...})` does, but mark its
   * outcome as controls-triggered — `useSessionClient` skips the conversation card for a change made
   * this way (the control's own label confirms it instead), while a typed command keeps its card.
   */
  sendCommandSilently: (name: string, args?: string) => void;
  pendingPrompts: readonly TPendingPrompt[];
  /** #3280 §2: the prompt queued behind a running turn, or null when none is queued. */
  queuedPrompt: IQueuedPrompt | null;
  answerPermission: (id: string, result: TPermissionResultValue) => void;
  answerAsk: (id: string, response: TActionResponse) => void;
  personalUsageStatus: 'idle' | 'loading' | 'ready' | 'error';
  personalUsageReport: TPersonalUsageReport | null;
  personalUsageError: string | null;
  requestPersonalUsage: (period: '7d' | '30d') => void;
  storedSessionUsageStatus: 'idle' | 'loading' | 'ready' | 'error';
  storedSessionUsageReport: TStoredSessionUsageReport | null;
  storedSessionUsageSessionId: string | null;
  storedSessionUsageError: string | null;
  requestStoredSessionUsage: (sessionId: string) => void;
  currentSessionUsageStatus: 'idle' | 'loading' | 'ready' | 'error';
  currentSessionUsageReport: TCurrentSessionUsageReport | null;
  requestCurrentSessionUsage: () => void;
  sessionNotices: readonly ISessionNotice[];
  dismissSessionNotice: (id: string) => void;
  /** #3282 §4a: whether the Settings modal is shown. `/settings` and the gear button both open it. */
  settingsOpen: boolean;
  settingsStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** Null until the first `get-settings` reply arrives. */
  settingsSnapshot: ISettingsSnapshot | null;
  /** The plain message from the most recent failed read or write, if any. */
  settingsError: string | null;
  /** #3282 §4 part b-2: which section the screen should land on for the open in progress. */
  settingsInitialSectionId: string | null;
  /**
   * Opens the screen and (re-)fetches its snapshot — the "reopen and see the new value" path.
   * `sectionId` jumps straight to that section (e.g. `/plugin` → `'plugins'`); omitted opens on the
   * screen's own default.
   */
  openSettings: (sectionId?: string) => void;
  closeSettings: () => void;
  /** A failed write leaves `settingsSnapshot` at its previous value; `settingsError` names why. */
  updateSettings: (patch: TSettingsPatch) => void;
  /** #3288 §1: the id of the execution-workspace entry open in the detail sheet, or null when closed. */
  openEntryId: string | null;
  executionDetailStatus: 'idle' | 'loading' | 'ready' | 'error';
  executionDetailRecords: readonly IExecutionDetailRecord[];
  executionDetailError: string | null;
  /** True once the last page read had no further cursor — nothing more to load. */
  executionDetailComplete: boolean;
  openExecutionDetail: (entryId: string) => void;
  loadMoreExecutionDetail: () => void;
  closeExecutionDetail: () => void;
  /** #3282 §4c — the Project panel's "Changes" section (git status). */
  projectStatusState: 'idle' | 'loading' | 'ready' | 'error';
  projectStatus: TProjectStatusRead | null;
  requestProjectStatus: () => void;
  /** #3282 §4c — the Project panel's "File diff" section, for the file `projectDiffPath` names. */
  projectDiffState: 'idle' | 'loading' | 'ready' | 'error';
  projectDiffPath: string | null;
  projectDiff: TProjectDiffRead | null;
  requestProjectDiff: (path: string) => void;
  /** #3282 §4c — the Project panel's "Memory" section. */
  projectMemoryState: 'idle' | 'loading' | 'ready' | 'error';
  projectMemory: TProjectMemoryRead | null;
  requestProjectMemory: () => void;
  /**
   * #3282 §4 part b-3: whether the agent switcher sheet is shown. `/agent` (bare) and this surface's
   * own control both open it.
   */
  agentSwitcherOpen: boolean;
  agentSwitcherStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** The available agents: name, one-line description, and where each is defined in plain words. */
  agentDefinitions: readonly IWireAgentDefinitionSummary[];
  /** The agent type `/agent <name>` (no prompt) currently selects — the checked row. */
  currentAgentType: string | null;
  /** The plain confirmation of the last selection's result, shown in the sheet — never a conversation card. */
  agentSwitchMessage: string | null;
  /** Opens the sheet and (re-)fetches its roster. */
  openAgentSwitcher: () => void;
  closeAgentSwitcher: () => void;
  /** Runs the same path as `/agent <name>`. */
  selectAgent: (agentType: string) => void;
  /**
   * #3282 §4 part b-3: the schedules shown in the Agents panel's "Scheduled" group — every
   * `IBackgroundTaskState` of `kind: 'scheduled'`, refreshed on connect and after a write.
   */
  scheduledTasks: readonly IBackgroundTaskState<'scheduled'>[];
  /** Runs the same path as `/schedule pause <id>` / `/schedule resume <id>`. */
  pauseSchedule: (taskId: string) => void;
  resumeSchedule: (taskId: string) => void;
  /**
   * Permanently stops a schedule — the same `cancel-background-task` write Stop already uses. A
   * failure surfaces the same way a failed Stop does (#3288 §1's `background-task-control-failed`
   * session notice) — no separate error state here.
   */
  deleteSchedule: (taskId: string) => void;
}
