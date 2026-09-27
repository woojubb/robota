import type { TConnectionStatus, TClientMessage } from '../client/ws-session-client.js';
import type { TPendingPrompt } from './prompt-state.js';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';
import type {
  IToolState,
  TDriverId,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-session';
import type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-interface-execution';
import type { TServerMessage } from '@robota-sdk/agent-transport';

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

/** The host's sessions in this workspace, which one is current, and the records it could not read. */
export type TSessionListing = Extract<TServerMessage, { type: 'sessions' }>['listing'];
/** Why the host did not list its sessions: it cannot (`not_available`), or listing failed. */
export type TSessionsError = Omit<Extract<TServerMessage, { type: 'sessions_error' }>, 'type' | 'requestId'>;

export type TCurrentSessionUsageReport = Extract<
  TServerMessage,
  { type: 'usage_report' }
>['report'];

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

export type TConversationEntry = IConversationMessage | ICommandOutputEntry | IToolGroupEntry;

export interface IActiveTool {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  input?: string;
  result?: IToolState['result'];
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
  /** `session-change-refused`: the host refused a new or switch this surface asked for. */
  kind: 'session-error' | 'protocol-error' | 'session-change-refused';
  message: string;
  /**
   * A `session-error` classified at the wire boundary (#3289 §3) — present only when the host could
   * tell what kind of failure this was. `SessionNotices` maps it to one plain sentence and keeps
   * `message` behind a "Details" disclosure; absent, it shows `message` as before.
   */
  code?: 'auth' | 'rate_limit' | 'model_unavailable' | 'network' | 'provider';
  provider?: string;
  retryAfterSeconds?: number;
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
  /** Null until the host has answered; refreshed on connect, after a switch, a rename and a turn. */
  sessionListing: TSessionListing | null;
  /** Set when the host answered the latest listing request with an error instead. */
  sessionsError: TSessionsError | null;
  requestSessions: () => void;
  /** Make another stored session current. A refusal arrives as a notice saying why. */
  switchSession: (sessionId: string) => void;
  /** Start a fresh session and make it current. */
  newSession: () => void;
  /** Whether the session sidebar is shown; `/resume` opens it. */
  sessionSidebarOpen: boolean;
  setSessionSidebarOpen: (open: boolean) => void;
  send: (msg: TClientMessage) => void;
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
}
