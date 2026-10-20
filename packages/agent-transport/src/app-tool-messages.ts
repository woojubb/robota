/**
 * A driving surface that hosts an MCP app view acts for it here: it invokes one runtime tool
 * through the session's own permission gate, and it reads a finished call's view on demand.
 *
 * Both are drive-only (neither is in `OBSERVER_MESSAGES`): an observer neither runs a tool nor
 * receives a view's document. A message that decoded but cannot be served answers `protocol_error`
 * echoing `requestId`, so the view that asked can tell which call it was.
 */
import { MAX_INBOUND_FRAME_BYTES } from './message-decoders.js';

import type { TOutboundDeliver } from './outbound-delivery.js';
import type { TClientMessage, TServerMessage } from './wire-messages.js';
import type {
  ISessionRuntimeTools,
  ISessionToolAppViews,
  TDriverId,
} from '@robota-sdk/agent-interface-session';

type TCallAppToolMessage = Extract<TClientMessage, { type: 'call-app-tool' }>;
type TReadAppViewMessage = Extract<TClientMessage, { type: 'read-app-view' }>;

/**
 * Room a carrier that stamps frames after they are produced (the resume bridge adds `seq`) needs
 * beneath the inbound limit, so a frame sent within the limit is still received within it.
 */
const FRAME_STAMP_MARGIN_BYTES = 1024;

/** Where a frame answering an app message is measured, and what ends the work behind it. */
export interface IAppMessageOptions {
  /** The most bytes one answering frame may take; defaults to the inbound limit less a margin. */
  readonly maxFrameBytes?: number;
  /** Ends the connection's work: aborting it cancels a call still waiting on its prompt. */
  readonly signal?: AbortSignal;
}

export function isAppToolMessage(msg: TClientMessage): msg is TCallAppToolMessage {
  return msg.type === 'call-app-tool';
}

export function isAppViewMessage(msg: TClientMessage): msg is TReadAppViewMessage {
  return msg.type === 'read-app-view';
}

function frameLimit(options: IAppMessageOptions | undefined): number {
  return options?.maxFrameBytes ?? MAX_INBOUND_FRAME_BYTES - FRAME_STAMP_MARGIN_BYTES;
}

/** Checked before `deliver`, so a frame the channel cannot carry never enters a buffer. */
function fitsFrame(frame: TServerMessage, limit: number): boolean {
  return new TextEncoder().encode(JSON.stringify(frame)).byteLength <= limit;
}

/**
 * Runs the tool as an interactive call acting for this connection's driver, so a permission prompt
 * it raises is shown to the surfaces that can answer and is attributed to that driver. The call is
 * limited to the tools the named view's own source declared: the surface says which view it acts
 * for, and the session, not the surface, says what that view may reach.
 */
export function handleAppToolMessage(
  session: ISessionRuntimeTools & ISessionToolAppViews,
  deliver: TOutboundDeliver,
  msg: TCallAppToolMessage,
  driverId?: TDriverId,
  options?: IAppMessageOptions,
): void {
  const { requestId } = msg;
  const view = session.readToolAppView(msg.viewId);
  if (view === undefined) {
    deliver({ type: 'protocol_error', message: 'This app view is no longer available.', requestId });
    return;
  }
  if (!Object.values(view.callableTools).includes(msg.name)) {
    deliver({
      type: 'protocol_error',
      message: 'This tool is not available to this app view.',
      requestId,
    });
    return;
  }
  const { signal } = options ?? {};
  const limit = frameLimit(options);
  session
    .invokeRuntimeTool(msg.name, msg.arguments, {
      permissionInteraction: 'interactive',
      ...(driverId ? { driverId } : {}),
      ...(signal ? { signal } : {}),
    })
    .then(
      (result) => {
        // The connection that asked is gone: there is nobody to answer.
        if (signal?.aborted) return;
        const frame: TServerMessage = {
          type: 'app_tool_result',
          requestId,
          success: result.success,
          ...(result.result !== undefined ? { data: result.result } : {}),
          ...(result.parts !== undefined ? { parts: result.parts } : {}),
          ...(result.error !== undefined ? { error: result.error } : {}),
        };
        if (fitsFrame(frame, limit)) {
          deliver(frame);
        } else {
          deliver({
            type: 'protocol_error',
            message: 'This app tool result is too large to send.',
            requestId,
          });
        }
      },
      (error: unknown) => {
        if (signal?.aborted) return;
        deliver({
          type: 'protocol_error',
          message: error instanceof Error ? error.message : String(error),
          requestId,
        });
      },
    );
}

/** Answers with the whole document, or says why not: gone, or too large for a frame. */
export function handleAppViewMessage(
  session: ISessionToolAppViews,
  deliver: TOutboundDeliver,
  msg: TReadAppViewMessage,
  options?: IAppMessageOptions,
): void {
  const { requestId } = msg;
  const view = session.readToolAppView(msg.viewId);
  if (view === undefined) {
    deliver({ type: 'protocol_error', message: 'This app view is no longer available.', requestId });
    return;
  }
  const frame: TServerMessage = { type: 'app_view', requestId, view };
  if (!fitsFrame(frame, frameLimit(options))) {
    deliver({ type: 'protocol_error', message: 'This app view is too large to send.', requestId });
    return;
  }
  deliver(frame);
}
