import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

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
  command_result: 'visible-notice',
  messages: 'reducer-state',
  context: 'intentionally-not-rendered',
  usage_report: 'reducer-state',
  personal_usage_report: 'reducer-state',
  personal_usage_report_error: 'visible-notice',
  stored_session_usage_report: 'reducer-state',
  stored_session_usage_report_error: 'visible-notice',
  executing: 'intentionally-not-rendered',
  pending: 'intentionally-not-rendered',
  execution_workspace_event: 'reducer-state',
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
  ui_intent: 'visible-notice',
  session_renamed: 'reducer-state',
  history_cleared: 'reducer-state',
  background_task_control_result: 'intentionally-not-rendered',
  protocol_error: 'visible-notice',
  resume_gap: 'transport-control',
} as const satisfies Readonly<Record<TServerMessage['type'], TServerMessageHandling>>;
