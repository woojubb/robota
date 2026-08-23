/**
 * Outbound session-event subscription for the WS/WebRTC transports (split from `ws-handler.ts` —
 * the inbound message routing stays there; this module owns the session→`TServerMessage` fan-out).
 *
 * Used by `createWsHandler` (one subscription per channel) and by the persistent
 * `SessionResumeBridge` (REMOTE-013 E4 — a SINGLE subscription that outlives per-channel handlers).
 */

import type { TOutboundDeliver } from './outbound-delivery.js';
import type { IProtocolSession } from './protocol-session.js';
import type { TDriverId, TInteractiveEventName } from '@robota-sdk/agent-interface-transport';
import type {
  IAskRequestEvent,
  IBranchEvent,
  IContextFileRefreshedEvent,
  IExecutionResult,
  IPermissionRequestEvent,
  IPromptResolvedEvent,
  IPlanApprovalEvent,
  ISessionRenamedEvent,
  IToolState,
  IUiIntentEvent,
} from '@robota-sdk/agent-interface-transport';
import type {
  IExecutionWorkspaceEvent,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';

export type TProtocolSessionEventClassification = 'forwarded' | 'requester-routed' | 'non-surface';

/** Exhaustive protocol-owner policy over the shared session-event vocabulary. */
export const PROTOCOL_SESSION_EVENT_CLASSIFICATION = {
  text_delta: 'forwarded',
  tool_start: 'forwarded',
  tool_end: 'forwarded',
  thinking: 'forwarded',
  complete: 'forwarded',
  error: 'forwarded',
  context_update: 'non-surface',
  compact: 'non-surface',
  interrupted: 'forwarded',
  skill_activation: 'non-surface',
  background_task_event: 'forwarded',
  background_job_group_event: 'forwarded',
  execution_workspace_event: 'forwarded',
  user_message: 'forwarded',
  turn_source: 'non-surface',
  context_file_refreshed: 'forwarded',
  memory_event: 'non-surface',
  goal_event: 'non-surface',
  plan_event: 'forwarded',
  branch_event: 'forwarded',
  permission_request: 'forwarded',
  ask_request: 'forwarded',
  prompt_resolved: 'forwarded',
  ui_intent: 'requester-routed',
  session_renamed: 'forwarded',
  history_cleared: 'forwarded',
} as const satisfies Record<TInteractiveEventName, TProtocolSessionEventClassification>;

/**
 * Options for {@link subscribeSessionEvents}.
 *
 * ARCH-030: `onDeliveryError` is NOT here. Carrier-failure containment moved to the one
 * connection-scoped {@link TOutboundDeliver} boundary this function now receives, so the fan-out and
 * every reply share a single guard instead of the fan-out having its own.
 */
export interface ISubscribeSessionEventsOptions {
  /**
   * CMD-004 Stage D: lazily read the SERVER-ASSIGNED driver id of THIS surface — `ui_intent` is
   * requester-routed against it (lazy because the resume bridge binds the id only after pairing).
   */
  getSurfaceDriverId?: () => TDriverId | undefined;
}

/**
 * Subscribe the session's events and forward each as a `TServerMessage` through the connection's
 * outbound boundary; returns an unsubscribe. Exported (REMOTE-013 E4) so the persistent
 * `SessionResumeBridge` can own a SINGLE subscription that outlives per-channel handlers.
 *
 * ARCH-030: the second parameter is the boundary, not a raw sink — a carrier `send` cannot be passed
 * here, which is what keeps the fan-out and the reply paths on one guard.
 */
export function subscribeSessionEvents(
  session: IProtocolSession,
  deliver: TOutboundDeliver,
  options: ISubscribeSessionEventsOptions = {},
): () => void {
  // ARCH-030: no local guard wrapper any more, and no event name passed alongside the message. The name
  // existed so the local guard could label a failure with it; the boundary labels with `message.type`,
  // which is identical for every forwarded event (asserted in `session-event-delivery.test.ts`). Keeping
  // the argument would have been a parameter that documents nothing and is read by nobody.
  // REMOTE-014 E5: stamp the ACTIVE turn's driver id onto TURN-AUTHORED events (co-drive authorship,
  // display-only), read at emit time. Only these events — background/goal/memory/execution-workspace events
  // are NOT authored by a driver turn and carry no `driverId`. `undefined` when idle or unattributed.
  const attr = (): { driverId?: TDriverId } => {
    // ARCH-012: a plain call, not `?.() ?? undefined`. The member is required, so `null` means
    // nobody is driving — it can no longer also mean "this host cannot answer".
    const driverId = session.getActiveDriverId();
    return driverId ? { driverId } : {};
  };
  const onUserMessage = (content: string): void =>
    deliver({ type: 'user_message', content, ...attr() });
  const onTextDelta = (delta: string): void => deliver({ type: 'text_delta', delta, ...attr() });
  const onToolStart = (state: IToolState): void =>
    deliver({ type: 'tool_start', state, ...attr() });
  const onToolEnd = (state: IToolState): void => deliver({ type: 'tool_end', state, ...attr() });
  const onThinking = (isThinking: boolean): void =>
    deliver({ type: 'thinking', isThinking, ...attr() });
  const onComplete = (result: IExecutionResult): void =>
    deliver({ type: 'complete', result, ...attr() });
  const onInterrupted = (result: IExecutionResult): void =>
    deliver({ type: 'interrupted', result, ...attr() });
  const onError = (error: Error): void =>
    deliver({ type: 'error', message: error.message, ...attr() });
  const onBackgroundTaskEvent = (event: TBackgroundTaskEvent): void =>
    deliver({ type: 'background_task_event', event });
  const onBackgroundJobGroupEvent = (event: TBackgroundJobGroupEvent): void =>
    deliver({ type: 'background_job_group_event', event });
  const onExecutionWorkspace = (event: IExecutionWorkspaceEvent): void =>
    deliver({
      type: 'execution_workspace_event',
      snapshot: event.snapshot,
    });
  const onPlanEvent = (event: IPlanApprovalEvent): void => deliver({ type: 'plan_event', event });
  const onContextFileRefreshed = (event: IContextFileRefreshedEvent): void =>
    deliver({ type: 'context_file_refreshed', event });
  const onBranchEvent = (event: IBranchEvent): void => deliver({ type: 'branch_event', event });
  // REMOTE-007: forward the transport-neutral prompt events so a remote surface can render + answer the
  // SAME permission/ask prompt; `prompt_resolved` dismisses it when another surface answered first.
  const onPermissionRequest = (event: IPermissionRequestEvent): void =>
    deliver({ type: 'permission_request', event });
  const onAskRequest = (event: IAskRequestEvent): void => deliver({ type: 'ask_request', event });
  const onPromptResolved = (event: IPromptResolvedEvent): void =>
    deliver({ type: 'prompt_resolved', event });
  // CMD-004 Stage D: `ui_intent` is REQUESTER-ROUTED — delivered only to the surface whose
  // server-assigned driver id issued the command. An UNATTRIBUTED intent (no requester id, e.g. an
  // idle model-invoked command) is unroutable and reaches every surface — never a silent drop.
  const onUiIntent = (event: IUiIntentEvent): void => {
    if (
      event.requesterDriverId !== undefined &&
      event.requesterDriverId !== options.getSurfaceDriverId?.()
    ) {
      return; // another surface's intent — this surface never sees it (and never buffers it)
    }
    deliver({ type: 'ui_intent', event });
  };
  // CMD-004 Stage E: BROADCAST session-state events — the host executed the rename/clear; EVERY
  // attached surface (co-driving included) reflects it. Never requester-filtered, unlike `ui_intent`.
  const onSessionRenamed = (event: ISessionRenamedEvent): void =>
    deliver({ type: 'session_renamed', event });
  const onHistoryCleared = (): void => deliver({ type: 'history_cleared' });

  session.on('user_message', onUserMessage);
  session.on('text_delta', onTextDelta);
  session.on('tool_start', onToolStart);
  session.on('tool_end', onToolEnd);
  session.on('thinking', onThinking);
  session.on('complete', onComplete);
  session.on('interrupted', onInterrupted);
  session.on('error', onError);
  session.on('background_task_event', onBackgroundTaskEvent);
  session.on('background_job_group_event', onBackgroundJobGroupEvent);
  session.on('execution_workspace_event', onExecutionWorkspace);
  session.on('plan_event', onPlanEvent);
  session.on('context_file_refreshed', onContextFileRefreshed);
  session.on('branch_event', onBranchEvent);
  session.on('permission_request', onPermissionRequest);
  session.on('ask_request', onAskRequest);
  session.on('prompt_resolved', onPromptResolved);
  session.on('ui_intent', onUiIntent);
  session.on('session_renamed', onSessionRenamed);
  session.on('history_cleared', onHistoryCleared);

  return (): void => {
    session.off('user_message', onUserMessage);
    session.off('text_delta', onTextDelta);
    session.off('tool_start', onToolStart);
    session.off('tool_end', onToolEnd);
    session.off('thinking', onThinking);
    session.off('complete', onComplete);
    session.off('interrupted', onInterrupted);
    session.off('error', onError);
    session.off('background_task_event', onBackgroundTaskEvent);
    session.off('background_job_group_event', onBackgroundJobGroupEvent);
    session.off('execution_workspace_event', onExecutionWorkspace);
    session.off('plan_event', onPlanEvent);
    session.off('context_file_refreshed', onContextFileRefreshed);
    session.off('branch_event', onBranchEvent);
    session.off('permission_request', onPermissionRequest);
    session.off('ask_request', onAskRequest);
    session.off('prompt_resolved', onPromptResolved);
    session.off('ui_intent', onUiIntent);
    session.off('session_renamed', onSessionRenamed);
    session.off('history_cleared', onHistoryCleared);
  };
}
