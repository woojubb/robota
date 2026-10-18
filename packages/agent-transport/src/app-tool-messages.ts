/**
 * A driving surface that hosts an MCP app view acts for it here: it invokes one runtime tool through
 * the session's own permission gate, and it reads a finished call's view on demand.
 *
 * Both are drive-only (neither is in `OBSERVER_MESSAGES`): an observer neither runs a tool nor
 * receives a view's document. A refusal answers `protocol_error` echoing `requestId`, so the view
 * that asked can tell which call it was.
 */
import { MAX_INBOUND_FRAME_BYTES } from './message-decoders.js';

import type { TOutboundDeliver } from './outbound-delivery.js';
import type { TClientMessage, TServerMessage } from './wire-messages.js';
import type { ISessionRuntimeTools, ISessionToolAppViews, TDriverId } from '@robota-sdk/agent-interface-session';

type TCallAppToolMessage = Extract<TClientMessage, { type: 'call-app-tool' }>;
type TReadAppViewMessage = Extract<TClientMessage, { type: 'read-app-view' }>;

export function isAppToolMessage(msg: TClientMessage): msg is TCallAppToolMessage {
  return msg.type === 'call-app-tool';
}

export function isAppViewMessage(msg: TClientMessage): msg is TReadAppViewMessage {
  return msg.type === 'read-app-view';
}

/**
 * Runs the tool as an interactive call acting for this connection's driver, so a permission prompt
 * it raises is shown to the surfaces that can answer and is attributed to that driver.
 */
export function handleAppToolMessage(
  session: ISessionRuntimeTools,
  deliver: TOutboundDeliver,
  msg: TCallAppToolMessage,
  driverId?: TDriverId,
): void {
  const { requestId } = msg;
  session
    .invokeRuntimeTool(msg.name, msg.arguments, {
      permissionInteraction: 'interactive',
      ...(driverId ? { driverId } : {}),
    })
    .then(
      (result) =>
        deliver({
          type: 'app_tool_result',
          requestId,
          success: result.success,
          ...(result.result !== undefined ? { data: result.result } : {}),
          ...(result.parts !== undefined ? { parts: result.parts } : {}),
          ...(result.error !== undefined ? { error: result.error } : {}),
        }),
      (error: unknown) =>
        deliver({
          type: 'protocol_error',
          message: error instanceof Error ? error.message : String(error),
          requestId,
        }),
    );
}

/** Answers with the whole document, or says why not: gone, or too large for a frame. */
export function handleAppViewMessage(
  session: ISessionToolAppViews,
  deliver: TOutboundDeliver,
  msg: TReadAppViewMessage,
): void {
  const { requestId } = msg;
  const view = session.readToolAppView(msg.executionId);
  if (view === undefined) {
    deliver({ type: 'protocol_error', message: 'This app view is no longer available.', requestId });
    return;
  }
  const frame: TServerMessage = { type: 'app_view', requestId, view };
  if (new TextEncoder().encode(JSON.stringify(frame)).byteLength > MAX_INBOUND_FRAME_BYTES) {
    deliver({ type: 'protocol_error', message: 'This app view is too large to send.', requestId });
    return;
  }
  deliver(frame);
}
