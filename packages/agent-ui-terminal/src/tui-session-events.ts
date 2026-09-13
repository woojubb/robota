import type {
  IBranchEvent,
  IContextFileRefreshedEvent,
  IPlanApprovalEvent,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';

export type TTuiSessionEventClassification = 'channel' | 'react-side-effect' | 'non-surface';

/** Exhaustive TUI-owner policy over the shared session-event vocabulary. */
export const TUI_SESSION_EVENT_CLASSIFICATION = {
  text_delta: 'channel',
  tool_start: 'channel',
  tool_end: 'channel',
  thinking: 'channel',
  complete: 'channel',
  error: 'channel',
  context_update: 'channel',
  compact: 'channel',
  interrupted: 'channel',
  skill_activation: 'channel',
  background_task_event: 'non-surface',
  background_job_group_event: 'non-surface',
  execution_workspace_event: 'channel',
  user_message: 'channel',
  turn_source: 'non-surface',
  context_file_refreshed: 'channel',
  memory_event: 'channel',
  goal_event: 'non-surface',
  plan_event: 'channel',
  branch_event: 'channel',
  permission_request: 'channel',
  ask_request: 'channel',
  prompt_resolved: 'channel',
  ui_intent: 'react-side-effect',
  session_renamed: 'react-side-effect',
  history_cleared: 'channel',
} as const satisfies Record<TInteractiveEventName, TTuiSessionEventClassification>;

export interface ITuiSessionEventNotice {
  id: string;
  event: 'plan_event' | 'context_file_refreshed' | 'branch_event' | 'delivery-error';
  message: string;
}

export type TTuiNoticeInput =
  | { event: 'plan_event'; payload: IPlanApprovalEvent }
  | { event: 'context_file_refreshed'; payload: IContextFileRefreshedEvent }
  | { event: 'branch_event'; payload: IBranchEvent };

/** Pure deterministic projection from domain event to TUI render state. */
export function createTuiSessionEventNotice(
  id: string,
  input: TTuiNoticeInput,
): ITuiSessionEventNotice {
  switch (input.event) {
    case 'plan_event':
      return {
        id,
        event: input.event,
        message: `Plan ${input.payload.type.replaceAll('_', ' ')}`,
      };
    case 'context_file_refreshed':
      return {
        id,
        event: input.event,
        message: `Context refreshed: ${input.payload.filePath}`,
      };
    case 'branch_event':
      return {
        id,
        event: input.event,
        message: `Branch ${input.payload.kind.replaceAll('_', ' ')}: ${input.payload.branchId} @ ${input.payload.checkpointId}`,
      };
  }
}
