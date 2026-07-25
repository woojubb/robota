/**
 * Outbound session-event subscription for the WS/WebRTC transports (split from `ws-handler.ts` —
 * the inbound message routing stays there; this module owns the session→`TServerMessage` fan-out).
 *
 * Used by `createWsHandler` (one subscription per channel) and by the persistent
 * `SessionResumeBridge` (REMOTE-013 E4 — a SINGLE subscription that outlives per-channel handlers).
 */

import type { TServerMessage } from './ws-protocol.js';
import type { TDriverId } from '@robota-sdk/agent-interface-transport';
import type {
  IAskRequestEvent,
  IExecutionResult,
  IExecutionWorkspaceEvent,
  IInteractiveSession,
  IPermissionRequestEvent,
  IPromptResolvedEvent,
  ISessionRenamedEvent,
  IToolState,
  IUiIntentEvent,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-transport';

/** Options for {@link subscribeSessionEvents}. */
export interface ISubscribeSessionEventsOptions {
  /**
   * CMD-004 Stage D: lazily read the SERVER-ASSIGNED driver id of THIS surface — `ui_intent` is
   * requester-routed against it (lazy because the resume bridge binds the id only after pairing).
   */
  getSurfaceDriverId?: () => TDriverId | undefined;
}

/**
 * Subscribe the session's events and forward each as a `TServerMessage` via `send`; returns an unsubscribe.
 * Exported (REMOTE-013 E4) so the persistent `SessionResumeBridge` can own a SINGLE subscription that
 * outlives per-channel handlers.
 */
export function subscribeSessionEvents(
  session: IInteractiveSession,
  send: (message: TServerMessage) => void,
  options?: ISubscribeSessionEventsOptions,
): () => void {
  // REMOTE-014 E5: stamp the ACTIVE turn's driver id onto TURN-AUTHORED events (co-drive authorship,
  // display-only), read at emit time. Only these events — background/goal/memory/execution-workspace events
  // are NOT authored by a driver turn and carry no `driverId`. `undefined` when idle or unattributed.
  const attr = (): { driverId?: TDriverId } => {
    const d = session.getActiveDriverId?.() ?? undefined;
    return d ? { driverId: d } : {};
  };
  const onUserMessage = (content: string): void =>
    send({ type: 'user_message', content, ...attr() });
  const onTextDelta = (delta: string): void => send({ type: 'text_delta', delta, ...attr() });
  const onToolStart = (state: IToolState): void => send({ type: 'tool_start', state, ...attr() });
  const onToolEnd = (state: IToolState): void => send({ type: 'tool_end', state, ...attr() });
  const onThinking = (isThinking: boolean): void =>
    send({ type: 'thinking', isThinking, ...attr() });
  const onComplete = (result: IExecutionResult): void =>
    send({ type: 'complete', result, ...attr() });
  const onInterrupted = (result: IExecutionResult): void =>
    send({ type: 'interrupted', result, ...attr() });
  const onError = (error: Error): void =>
    send({ type: 'error', message: error.message, ...attr() });
  const onBackgroundTaskEvent = (event: TBackgroundTaskEvent): void =>
    send({ type: 'background_task_event', event });
  const onBackgroundJobGroupEvent = (event: TBackgroundJobGroupEvent): void =>
    send({ type: 'background_job_group_event', event });
  const onExecutionWorkspace = (event: IExecutionWorkspaceEvent): void =>
    send({ type: 'execution_workspace_event', snapshot: event.snapshot });
  // REMOTE-007: forward the transport-neutral prompt events so a remote surface can render + answer the
  // SAME permission/ask prompt; `prompt_resolved` dismisses it when another surface answered first.
  const onPermissionRequest = (event: IPermissionRequestEvent): void =>
    send({ type: 'permission_request', event });
  const onAskRequest = (event: IAskRequestEvent): void => send({ type: 'ask_request', event });
  const onPromptResolved = (event: IPromptResolvedEvent): void =>
    send({ type: 'prompt_resolved', event });
  // CMD-004 Stage D: `ui_intent` is REQUESTER-ROUTED — delivered only to the surface whose
  // server-assigned driver id issued the command. An UNATTRIBUTED intent (no requester id, e.g. an
  // idle model-invoked command) is unroutable and reaches every surface — never a silent drop.
  const onUiIntent = (event: IUiIntentEvent): void => {
    if (
      event.requesterDriverId !== undefined &&
      event.requesterDriverId !== options?.getSurfaceDriverId?.()
    ) {
      return; // another surface's intent — this surface never sees it (and never buffers it)
    }
    send({ type: 'ui_intent', event });
  };
  // CMD-004 Stage E: BROADCAST session-state events — the host executed the rename/clear; EVERY
  // attached surface (co-driving included) reflects it. Never requester-filtered, unlike `ui_intent`.
  const onSessionRenamed = (event: ISessionRenamedEvent): void =>
    send({ type: 'session_renamed', event });
  const onHistoryCleared = (): void => send({ type: 'history_cleared' });

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
    session.off('permission_request', onPermissionRequest);
    session.off('ask_request', onAskRequest);
    session.off('prompt_resolved', onPromptResolved);
    session.off('ui_intent', onUiIntent);
    session.off('session_renamed', onSessionRenamed);
    session.off('history_cleared', onHistoryCleared);
  };
}
