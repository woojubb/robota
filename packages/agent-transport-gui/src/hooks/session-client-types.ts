import type { TConnectionStatus, TClientMessage } from '../client/ws-session-client.js';
import type { TPendingPrompt } from './prompt-state.js';
import type { TUiIntentNotice } from './ui-intent-state.js';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';
import type { IToolState, TPermissionResultValue } from '@robota-sdk/agent-interface-session';
import type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-interface-execution';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

export type TPersonalUsageReport = Extract<
  TServerMessage,
  { type: 'personal_usage_report' }
>['report'];
export type TStoredSessionUsageReport = Extract<
  TServerMessage,
  { type: 'stored_session_usage_report' }
>['report'];
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

export interface IActiveTool {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  input?: string;
  result?: IToolState['result'];
}

export interface ISessionNotice {
  id: string;
  kind: 'session-error' | 'protocol-error' | 'command-result';
  message: string;
  success?: boolean;
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
  messages: IConversationMessage[];
  activeTools: IActiveTool[];
  streamingText: string;
  isThinking: boolean;
  executionWorkspace: IExecutionWorkspaceSnapshot | null;
  sessionName: string | null;
  send: (msg: TClientMessage) => void;
  pendingPrompts: readonly TPendingPrompt[];
  answerPermission: (id: string, result: TPermissionResultValue) => void;
  answerAsk: (id: string, response: TActionResponse) => void;
  uiIntentNotices: readonly TUiIntentNotice[];
  dismissUiIntentNotice: (id: string) => void;
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
