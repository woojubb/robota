import type { TServerMessage } from '@robota-sdk/agent-transport';

export type TServerMessageHandling =
  'reducer-state' | 'visible-notice' | 'intentionally-not-rendered' | 'transport-control';

/**
 * ARCH-2164: exhaustive ownership for every decoded server variant on the shared GUI surface.
 * Adding a wire variant without deciding its GUI disposition is a compile error instead of a silent
 * reducer omission. `intentionally-not-rendered` is an explicit disposition for server-side query
 * snapshots and domain events that this session/usage surface does not currently visualize.
 */
export const SERVER_MESSAGE_HANDLING = {
  text_delta: 'reducer-state',
  user_message: 'reducer-state',
  tool_start: 'reducer-state',
  tool_end: 'reducer-state',
  thinking: 'reducer-state',
  complete: 'reducer-state',
  interrupted: 'reducer-state',
  error: 'visible-notice',
  command_result: 'reducer-state',
  messages: 'reducer-state',
  // #3189: the full history and its change signal serve a client that renders the whole session
  // (the TUI); this surface builds its transcript from `messages` and the streamed turn.
  history: 'intentionally-not-rendered',
  history_changed: 'intentionally-not-rendered',
  context: 'intentionally-not-rendered',
  turn_source: 'intentionally-not-rendered',
  commands: 'reducer-state',
  session_status: 'reducer-state',
  // #3282 §2 part 2: the reply to `list-models`, fed into `modelList` state by the model control's
  // pop-up menu (`useModelListState`).
  model_list: 'reducer-state',
  sessions: 'reducer-state',
  sessions_error: 'reducer-state',
  session_switched: 'reducer-state',
  session_change_failed: 'visible-notice',
  session_renamed_in_list: 'reducer-state',
  session_rename_failed: 'visible-notice',
  session_deleted: 'reducer-state',
  session_delete_failed: 'visible-notice',
  usage_report: 'reducer-state',
  personal_usage_report: 'reducer-state',
  personal_usage_report_error: 'visible-notice',
  stored_session_usage_report: 'reducer-state',
  stored_session_usage_report_error: 'visible-notice',
  executing: 'intentionally-not-rendered',
  // #3280 §2: the prompt queued behind a running turn — shown above the composer with Edit/Remove.
  pending: 'reducer-state',
  execution_workspace_event: 'reducer-state',
  // #3288 §1: the Agents panel's detail sheet reads a page at a time.
  execution_detail: 'reducer-state',
  execution_detail_error: 'reducer-state',
  // Esc's loop stop is a TUI-only shortcut; this surface's loops stop through the Agents panel
  // instead (`/loop stop <id>`, or `stop-waiting-loop` is simply never sent here).
  waiting_loop_stop: 'intentionally-not-rendered',
  // The Agents panel already reflects a task's cancel/close/send through `execution_workspace_event`;
  // nothing here renders this narrower, task-only event on its own.
  background_task_event: 'intentionally-not-rendered',
  background_job_group_event: 'intentionally-not-rendered',
  plan_event: 'intentionally-not-rendered',
  context_file_refreshed: 'intentionally-not-rendered',
  branch_event: 'intentionally-not-rendered',
  background_tasks: 'intentionally-not-rendered',
  background_task: 'intentionally-not-rendered',
  background_job_groups: 'intentionally-not-rendered',
  background_job_group: 'intentionally-not-rendered',
  background_task_log: 'intentionally-not-rendered',
  permission_request: 'reducer-state',
  ask_request: 'reducer-state',
  prompt_resolved: 'reducer-state',
  ui_intent: 'reducer-state',
  session_renamed: 'reducer-state',
  history_cleared: 'reducer-state',
  // #3288 §1: a failed Stop (e.g. a task that finished a moment before it arrived) is worth telling
  // the operator; a success shows itself through the workspace snapshot's own update.
  background_task_control_result: 'visible-notice',
  protocol_error: 'visible-notice',
  resume_gap: 'transport-control',
  // #3282 §4a: the Settings screen's own correlated request/response state (`useSettingsState`).
  settings: 'reducer-state',
  settings_error: 'reducer-state',
} as const satisfies Readonly<Record<TServerMessage['type'], TServerMessageHandling>>;
