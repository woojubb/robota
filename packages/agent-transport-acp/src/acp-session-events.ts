/**
 * Which session events this transport acts on.
 *
 * This is the ACP owner's own exhaustive policy over the shared event vocabulary, not the WebSocket
 * fan-out's: a new session event fails compilation here until someone decides what an editor sees.
 * The subscription is derived from it, so promoting an event to `stream` or `permission` without a
 * handler fails compilation too.
 */

import type {
  IInteractiveSessionEvents,
  ISessionEvents,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';

/**
 * - `stream`: forwarded to the editor as a session update while a prompt runs.
 * - `permission`: becomes a permission request to the editor.
 * - `settle`: ends the turn; the outcome is read from the submission's turn handle, which names its
 *   own turn, rather than from the session-wide event, which cannot say which turn ended.
 * - `ignore`: nothing an ACP editor shows. `ask_request` is deliberately here: a session with no
 *   listener answers an ask as cancelled, which fails closed because ACP v1 has no question prompt.
 */
export type TAcpEventPolicy = 'stream' | 'permission' | 'settle' | 'ignore';

export const ACP_SESSION_EVENT_POLICY = {
  text_delta: 'stream',
  tool_start: 'stream',
  tool_end: 'stream',
  thinking: 'ignore', // carries no text, so there is nothing for agent_thought_chunk
  complete: 'settle',
  error: 'settle',
  interrupted: 'settle',
  permission_request: 'permission',
  ask_request: 'ignore',
  context_update: 'ignore',
  compact: 'ignore',
  skill_activation: 'ignore',
  background_task_event: 'ignore',
  background_job_group_event: 'ignore',
  execution_workspace_event: 'ignore',
  user_message: 'ignore',
  turn_source: 'ignore',
  context_file_refreshed: 'ignore',
  memory_event: 'ignore',
  goal_event: 'ignore',
  plan_event: 'ignore',
  branch_event: 'ignore',
  prompt_resolved: 'ignore',
  ui_intent: 'ignore',
  session_renamed: 'ignore',
  history_cleared: 'ignore',
  session_switched: 'ignore',
  status_changed: 'ignore',
} as const satisfies Record<TInteractiveEventName, TAcpEventPolicy>;

type TPolicyMap = typeof ACP_SESSION_EVENT_POLICY;
type TEventsWith<P extends TAcpEventPolicy> = {
  [K in keyof TPolicyMap]: TPolicyMap[K] extends P ? K : never;
}[keyof TPolicyMap];

export type TAcpSubscribedEvent = TEventsWith<'stream' | 'permission'>;

/** Exactly one handler for every event the policy subscribes, and none for any other. */
export type TAcpEventHandlers = {
  readonly [K in TAcpSubscribedEvent]: IInteractiveSessionEvents[K];
};

/** Subscribe the handlers; returns the unsubscribe. */
export function subscribeAcpEvents(
  session: ISessionEvents,
  handlers: TAcpEventHandlers,
): () => void {
  const names = Object.keys(handlers) as TAcpSubscribedEvent[];
  for (const name of names) session.on(name, handlers[name]);
  return () => {
    for (const name of names) session.off(name, handlers[name]);
  };
}
