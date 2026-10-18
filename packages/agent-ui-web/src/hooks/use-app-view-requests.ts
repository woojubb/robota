import { useCallback, useRef } from 'react';

import type { TClientMessage } from '../client/ws-session-client.js';
import type { TAppToolArguments, TAppToolOutcome, TAppView } from '../app-view/types.js';
import type { IActiveTool } from './session-client-types.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

interface IPendingRequest {
  resolve: (value: TAppView | TAppToolOutcome) => void;
  reject: (error: Error) => void;
  /** Which answer settles it: a view read, or the outcome of a tool call. */
  answer: 'app_view' | 'app_tool_result';
}

let requestCounter = 0;
function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}_${requestCounter}_${Date.now()}`;
}

const CONNECTION_CLOSED = 'The connection to the session closed.';

/**
 * The key a finished call's app view is read and called by, taken from the tool row's `appView`
 * reference; `undefined` when the row gives none. Everything outside this module treats it as an
 * opaque string — it is read here and put on the two wire messages below, nowhere else.
 */
export function appViewKey(tool: IActiveTool): string | undefined {
  return tool.appView === undefined ? undefined : tool.executionId;
}

function readAppViewMessage(requestId: string, viewKey: string): TClientMessage {
  return { type: 'read-app-view', requestId, executionId: viewKey };
}

/** A tool run for the view `viewKey` names; the wire does not carry the key on a call yet. */
function callAppToolMessage(
  requestId: string,
  _viewKey: string,
  name: string,
  args: TAppToolArguments,
): TClientMessage {
  return { type: 'call-app-tool', requestId, name, arguments: args };
}

/**
 * The app-view host's two requests to the session, each a promise settled by the reply that echoes
 * its `requestId` (`app_view` / `app_tool_result`, or a `protocol_error` naming it). Unlike the
 * panels' latest-wins state, several can be outstanding at once (one per frame on screen), so each
 * keeps its own entry. A reply that lost its connection never arrives: the owner of the connection
 * rejects every outstanding request when it drops, is replaced or goes away (`rejectPendingAppRequests`).
 */
export function useAppViewRequests(
  send: (msg: TClientMessage) => void,
  isConnected: () => boolean,
): {
  readAppView: (viewKey: string) => Promise<TAppView>;
  callAppTool: (
    viewKey: string,
    name: string,
    args: TAppToolArguments,
  ) => Promise<TAppToolOutcome>;
  handleAppViewMessage: (msg: TServerMessage) => boolean;
  rejectPendingAppRequests: (reason?: string) => void;
} {
  const pendingRef = useRef(new Map<string, IPendingRequest>());

  const rejectPendingAppRequests = useCallback((reason: string = CONNECTION_CLOSED): void => {
    const pending = [...pendingRef.current.values()];
    pendingRef.current.clear();
    for (const request of pending) request.reject(new Error(reason));
  }, []);

  const request = useCallback(
    <T extends TAppView | TAppToolOutcome>(
      prefix: string,
      answer: IPendingRequest['answer'],
      message: (requestId: string) => TClientMessage,
    ): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (!isConnected()) {
          reject(new Error(CONNECTION_CLOSED));
          return;
        }
        const requestId = nextRequestId(prefix);
        pendingRef.current.set(requestId, {
          answer,
          resolve: (value) => resolve(value as T),
          reject,
        });
        try {
          send(message(requestId));
        } catch (error: unknown) {
          pendingRef.current.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    [isConnected, send],
  );

  const readAppView = useCallback(
    (viewKey: string): Promise<TAppView> =>
      request<TAppView>('app_view', 'app_view', (requestId) =>
        readAppViewMessage(requestId, viewKey),
      ),
    [request],
  );

  const callAppTool = useCallback(
    (viewKey: string, name: string, args: TAppToolArguments): Promise<TAppToolOutcome> =>
      request<TAppToolOutcome>('app_tool', 'app_tool_result', (requestId) =>
        callAppToolMessage(requestId, viewKey, name, args),
      ),
    [request],
  );

  /** True when the message answered one of this hook's requests; every other message is not its own. */
  const handleAppViewMessage = useCallback((msg: TServerMessage): boolean => {
    if (msg.type === 'app_view' || msg.type === 'app_tool_result') {
      const pending = pendingRef.current.get(msg.requestId);
      // A reply to a request that already settled (or never was ours) matches nothing.
      if (pending === undefined || pending.answer !== msg.type) return true;
      pendingRef.current.delete(msg.requestId);
      if (msg.type === 'app_view') {
        pending.resolve(msg.view);
      } else {
        const { success, data, parts, error } = msg;
        pending.resolve({
          success,
          ...(data !== undefined ? { data } : {}),
          ...(parts !== undefined ? { parts } : {}),
          ...(error !== undefined ? { error } : {}),
        });
      }
      return true;
    }
    if (msg.type === 'protocol_error' && msg.requestId !== undefined) {
      const pending = pendingRef.current.get(msg.requestId);
      if (pending === undefined) return false;
      pendingRef.current.delete(msg.requestId);
      pending.reject(new Error(msg.message));
      return true;
    }
    return false;
  }, []);

  return { readAppView, callAppTool, handleAppViewMessage, rejectPendingAppRequests };
}
