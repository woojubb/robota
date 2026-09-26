import type {
  IPersonalUsageReport,
  IPersonalUsageRequest,
  IUsageBySourceReport,
} from '@robota-sdk/agent-interface-analytics';
import type {
  ICommandListEntry,
  ICommandResult,
  ICommandSkillListEntry,
} from '@robota-sdk/agent-interface-command';
import type {
  IBackgroundJobGroupState,
  IExecutionWorkspaceSnapshot,
  TBackgroundJobGroupEvent,
} from '@robota-sdk/agent-interface-execution';
import type {
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';
import type {
  IAskRequestEvent,
  IBranchEvent,
  IExecutionResult,
  IContextFileRefreshedEvent,
  IPermissionRequestEvent,
  IPromptResolvedEvent,
  IPlanApprovalEvent,
  ISessionRenamedEvent,
  IToolState,
  ISessionListing,
  ISessionStatusSnapshot,
  ISessionSwitchedEvent,
  IUiIntentEvent,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-session';
import type {
  ISessionConversationRead,
  TDriverId,
  TTurnSource,
} from '@robota-sdk/agent-interface-session';
import type { TActionResponse } from '@robota-sdk/agent-interface-transport';

export type TBackgroundControlAction = 'cancel' | 'close' | 'send';

type THistoryEntry = ReturnType<ISessionConversationRead['getFullHistory']>[number];

/**
 * #3189: one entry of the session's full history as it crosses the wire. The same record the session
 * keeps, except that `timestamp` is an ISO 8601 string: a `Date` does not survive JSON, and a
 * declared `Date` that arrives as a string would let a client call `Date` methods on a string.
 */
export interface IWireHistoryEntry extends Omit<THistoryEntry, 'timestamp'> {
  /** ISO 8601. */
  timestamp: string;
}

/**
 * #3189: a turn's result as it crosses the wire. The session's whole history stays behind: it only
 * grows, so a client reads it in bounded pages with `get-history` instead.
 */
export type TWireExecutionResult = Omit<IExecutionResult, 'history'>;

/** Inbound message from client to server. */
export type TClientMessage =
  | { type: 'submit'; prompt: string }
  // `requestId` is echoed on the command's `command_result` or `protocol_error`, so a client with
  // several commands in flight knows which one each answer settles.
  | { type: 'command'; name: string; args?: string; requestId?: string }
  | { type: 'abort' }
  | { type: 'cancel-queue' }
  | { type: 'get-messages' }
  // #3189: the session's full history — what a client that renders the whole session (the TUI) shows —
  // one bounded page at a time, from `fromIndex` (default 0). The client asks for the next page
  // after the previous one arrived, so replies never pile up in the connection.
  | { type: 'get-history'; fromIndex?: number }
  // #3189: the permission and ask prompts open now, each sent again as the frame that asked it: a
  // client that attached after a prompt was asked has not seen it.
  | { type: 'get-prompts' }
  | { type: 'get-context' }
  // #3186: what every client needs beside the conversation — the commands and skills it can offer
  // (a `/` menu), and the session's status (model, permission mode, effort, context).
  | { type: 'get-commands' }
  | { type: 'get-status' }
  // #3189: the host's sessions — list them, start a new one, make another current. A switch that
  // would lose work in progress is refused with a protocol_error that says why.
  | { type: 'list-sessions'; requestId: string }
  | { type: 'new-session' }
  | { type: 'switch-session'; sessionId: string }
  // SELFHOST-004: request the assembled trace/cost read-model (spans + cost-by-source) for the run.
  | { type: 'get-usage-report' }
  | {
      type: 'get-personal-usage-report';
      requestId: string;
      period: IPersonalUsageRequest['period'];
      timezone: string;
    }
  | { type: 'get-stored-session-usage-report'; requestId: string; sessionId: string }
  | { type: 'get-executing' }
  | { type: 'get-pending' }
  | { type: 'get-execution-workspace' }
  | { type: 'get-background-tasks'; filter?: IBackgroundTaskListFilter }
  | { type: 'get-background-task'; taskId: string }
  | { type: 'get-background-job-groups' }
  | { type: 'get-background-job-group'; groupId: string }
  | { type: 'wait-background-job-group'; groupId: string }
  | { type: 'cancel-background-task'; taskId: string; reason?: string }
  | { type: 'close-background-task'; taskId: string }
  | { type: 'send-background-task'; taskId: string; input: IBackgroundTaskInput }
  | { type: 'read-background-task-log'; taskId: string; cursor?: IBackgroundTaskLogCursor }
  // REMOTE-007: a driving client answers a pending permission/ask prompt by id (first answer wins).
  | { type: 'permission-response'; id: string; result: TPermissionResultValue }
  | { type: 'ask-response'; id: string; response: TActionResponse }
  // REMOTE-013 E4 session-resume: `resume` asks the host to replay the tail after `lastSeq` (the last seq the
  // client applied); `ack` lets the host free its un-acked buffer up to `seq`. Only meaningful post-E3-accept.
  | { type: 'resume'; lastSeq: number }
  | { type: 'ack'; seq: number };

/** Outbound message from server to client. */
export type TServerMessage =
  // REMOTE-014 E5: turn-authored events optionally carry the ACTIVE turn's `driverId` (co-drive authorship,
  // display-only). Stamped at `subscribeSessionEvents` from `getActiveDriverId()`; background/goal/memory/
  // execution-workspace events are NEVER stamped (they are not authored by a driver turn).
  | { type: 'text_delta'; delta: string; driverId?: TDriverId }
  | { type: 'user_message'; content: string; driverId?: TDriverId }
  | { type: 'tool_start'; state: IToolState; driverId?: TDriverId }
  | { type: 'tool_end'; state: IToolState; driverId?: TDriverId }
  | { type: 'thinking'; isThinking: boolean; driverId?: TDriverId }
  | { type: 'complete'; result: TWireExecutionResult; driverId?: TDriverId }
  | { type: 'interrupted'; result: TWireExecutionResult; driverId?: TDriverId }
  | { type: 'error'; message: string; driverId?: TDriverId }
  | {
      type: 'command_result';
      name: string;
      message: string;
      success: boolean;
      data?: ICommandResult['data'];
      /** The `requestId` of the `command` this answers, when it carried one. */
      requestId?: string;
    }
  | { type: 'messages'; messages: ReturnType<ISessionConversationRead['getMessages']> }
  // #3189: one page of the full history. `entries` start at `startIndex` of the `total` the session
  // holds now, and stop before a page grows past a bounded size (a single larger entry is sent alone).
  | { type: 'history'; startIndex: number; total: number; entries: IWireHistoryEntry[] }
  // Sent in reply to `get-context`, and pushed whenever the session's context window changes.
  | { type: 'context'; state: ReturnType<ISessionConversationRead['getContextState']> }
  // #3189: the full history gained entries that no streamed frame carries (a compaction, a skill
  // activation, a memory event). A client that shows the full history re-reads it with `get-history`.
  | { type: 'history_changed' }
  // #3189: where the turn now starting came from (the user, a wake-up, a peer, an external event).
  | { type: 'turn_source'; source: TTurnSource }
  | { type: 'commands'; commands: ICommandListEntry[]; skills: ICommandSkillListEntry[] }
  | { type: 'session_status'; status: ISessionStatusSnapshot }
  | { type: 'sessions'; requestId: string; listing: ISessionListing }
  | {
      type: 'sessions_error';
      requestId: string;
      code: 'not_available' | 'list_failed';
      message: string;
    }
  // Broadcast: the host made another session current; every client re-reads what it shows.
  | { type: 'session_switched'; event: ISessionSwitchedEvent }
  // SELFHOST-004 (P5, TC-08): carry the assembled trace/cost read-model (per-op span timeline +
  // cost-by-source) across the sidecar boundary — no existing variant carries per-op `durationMs` or
  // per-source `costUsd`. The GUI renders it renderer-side.
  | { type: 'usage_report'; report: IUsageBySourceReport }
  | { type: 'personal_usage_report'; requestId: string; report: IPersonalUsageReport }
  | {
      type: 'personal_usage_report_error';
      requestId: string;
      code: 'not_available' | 'report_failed';
      message: string;
    }
  | {
      type: 'stored_session_usage_report';
      requestId: string;
      sessionId: string;
      report: IUsageBySourceReport;
    }
  | {
      type: 'stored_session_usage_report_error';
      requestId: string;
      sessionId: string;
      code: 'not_available' | 'report_failed';
      message: string;
    }
  | { type: 'executing'; executing: boolean }
  // The next queued prompt and how many wait. Sent in reply to `get-pending`, and to a `submit` once
  // the host has taken the prompt (queued it behind a running turn, or run it).
  | { type: 'pending'; pending: string | null; pendingCount?: number }
  | { type: 'execution_workspace_event'; snapshot: IExecutionWorkspaceSnapshot }
  | { type: 'background_task_event'; event: TBackgroundTaskEvent }
  | { type: 'background_job_group_event'; event: TBackgroundJobGroupEvent }
  | { type: 'plan_event'; event: IPlanApprovalEvent }
  | { type: 'context_file_refreshed'; event: IContextFileRefreshedEvent }
  | { type: 'branch_event'; event: IBranchEvent }
  | { type: 'background_tasks'; tasks: IBackgroundTaskState[] }
  | { type: 'background_task'; taskId: string; task: IBackgroundTaskState | null }
  | { type: 'background_job_groups'; groups: IBackgroundJobGroupState[] }
  | { type: 'background_job_group'; groupId: string; group: IBackgroundJobGroupState | null }
  | { type: 'background_task_log'; taskId: string; page: IBackgroundTaskLogPage }
  // REMOTE-007: forward the session's transport-neutral prompt events so a remote surface can render +
  // answer the SAME prompt (permission/ask). `prompt_resolved` dismisses it when another surface won.
  | { type: 'permission_request'; event: IPermissionRequestEvent }
  | { type: 'ask_request'; event: IAskRequestEvent }
  | { type: 'prompt_resolved'; event: IPromptResolvedEvent }
  // CMD-004 Phase 2: forward command-issued UI intents (same pattern as `ask_request`). The event is
  // requester-routed — a client renders it only when `event.requesterDriverId` is its own driver id;
  // an unsupported intent yields an explicit "not available on this surface" notice, never a silent drop.
  | { type: 'ui_intent'; event: IUiIntentEvent }
  // CMD-004 Phase 2 Stage E: BROADCAST session events — every attached surface receives them
  // (co-driving titles/transcripts follow the host-executed rename/clear; never requester-filtered).
  | { type: 'session_renamed'; event: ISessionRenamedEvent }
  | { type: 'history_cleared' }
  | {
      type: 'background_task_control_result';
      action: TBackgroundControlAction;
      taskId: string;
      success: boolean;
      message?: string;
    }
  // `requestId` names the `command` whose failure this reports; a refusal of anything else has none.
  | { type: 'protocol_error'; message: string; requestId?: string }
  // REMOTE-013 E4: sent instead of a replay when the client's `lastSeq` predates the host's retained buffer
  // (overrun) — the client must do a full `get-messages` refresh rather than accept a silent gap.
  | { type: 'resume_gap' };

/**
 * REMOTE-013 E4: a server message stamped with its monotonic session sequence number (added by the
 * {@link SessionResumeBridge} on the reconnectable WebRTC path). Intersecting over the union distributes the
 * `seq` field onto every variant. The WS localhost path never stamps it (a `type`-dispatching client ignores
 * an absent/extra `seq`).
 */
export type TSeqServerMessage = TServerMessage & { seq: number };
