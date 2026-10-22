import { useCallback, useRef, useState } from 'react';

import type { TClientMessage } from '../client/ws-session-client.js';
import type { TAppToolArguments, TAppToolOutcome, TAppView } from '../app-view/types.js';
import type { IActiveTool } from './session-client-types.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

type TPendingRequest = {
  reject: (error: Error) => void;
  dispose: () => void;
} & (
  | { answer: 'app_view'; resolve: (value: TAppView) => void }
  | { answer: 'app_tool_result'; resolve: (value: TAppToolOutcome) => void }
);

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
  return tool.appView?.viewId;
}

function readAppViewMessage(requestId: string, viewKey: string): TClientMessage {
  return { type: 'read-app-view', requestId, viewId: viewKey };
}

function callAppToolMessage(
  requestId: string,
  viewKey: string,
  name: string,
  args: TAppToolArguments,
): TClientMessage {
  return { type: 'call-app-tool', requestId, viewId: viewKey, name, arguments: args };
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
  readAppView: (viewKey: string, signal?: AbortSignal) => Promise<TAppView>;
  callAppTool: (
    viewKey: string,
    name: string,
    args: TAppToolArguments,
    signal?: AbortSignal,
  ) => Promise<TAppToolOutcome>;
  handleAppViewMessage: (msg: TServerMessage) => boolean;
  rejectPendingAppRequests: (reason?: string) => void;
} {
  const pendingRef = useRef(new Map<string, TPendingRequest>());
  const [requestOwner] = useState(() => nextRequestId('app_request'));

  const rejectPendingAppRequests = useCallback((reason: string = CONNECTION_CLOSED): void => {
    const pending = [...pendingRef.current.values()];
    pendingRef.current.clear();
    for (const request of pending) {
      request.dispose();
      request.reject(new Error(reason));
    }
  }, []);

  const request = useCallback(
    <T extends TAppView | TAppToolOutcome>(
      prefix: string,
      message: (requestId: string) => TClientMessage,
      pending: (
        resolve: (value: T) => void,
        reject: (error: Error) => void,
        dispose: () => void,
      ) => TPendingRequest,
      signal?: AbortSignal,
    ): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        if (!isConnected() || signal?.aborted) {
          reject(new Error(signal?.aborted ? 'The app view closed.' : CONNECTION_CLOSED));
          return;
        }
        const requestId = nextRequestId(`${requestOwner}_${prefix}`);
        const dispose = (): void => signal?.removeEventListener('abort', abort);
        const abort = (): void => {
          pendingRef.current.delete(requestId);
          dispose();
          reject(new Error('The app view closed.'));
        };
        pendingRef.current.set(requestId, pending(resolve, reject, dispose));
        signal?.addEventListener('abort', abort, { once: true });
        try {
          send(message(requestId));
        } catch (error: unknown) {
          pendingRef.current.delete(requestId);
          dispose();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    [isConnected, requestOwner, send],
  );

  const readAppView = useCallback(
    (viewKey: string, signal?: AbortSignal): Promise<TAppView> =>
      request<TAppView>(
        'app_view',
        (requestId) => readAppViewMessage(requestId, viewKey),
        (resolve, reject, dispose) => ({ answer: 'app_view', resolve, reject, dispose }),
        signal,
      ),
    [request],
  );

  const callAppTool = useCallback(
    (
      viewKey: string,
      name: string,
      args: TAppToolArguments,
      signal?: AbortSignal,
    ): Promise<TAppToolOutcome> =>
      request<TAppToolOutcome>(
        'app_tool',
        (requestId) => callAppToolMessage(requestId, viewKey, name, args),
        (resolve, reject, dispose) => ({ answer: 'app_tool_result', resolve, reject, dispose }),
        signal,
      ),
    [request],
  );

  /** True when the message answered one of this hook's requests; every other message is not its own. */
  const handleAppViewMessage = useCallback(
    (msg: TServerMessage): boolean => {
      if (msg.type === 'app_view' || msg.type === 'app_tool_result') {
        const pending = pendingRef.current.get(msg.requestId);
        // A reply to a request that already settled (or never was ours) matches nothing.
        if (pending === undefined || pending.answer !== msg.type) return true;
        pendingRef.current.delete(msg.requestId);
        pending.dispose();
        if (msg.type === 'app_view' && pending.answer === 'app_view') {
          pending.resolve(msg.view);
        } else if (msg.type === 'app_tool_result' && pending.answer === 'app_tool_result') {
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
        if (pending === undefined) return msg.requestId.startsWith(`${requestOwner}_`);
        pendingRef.current.delete(msg.requestId);
        pending.dispose();
        pending.reject(new Error(msg.message));
        return true;
      }
      return false;
    },
    [requestOwner],
  );

  return { readAppView, callAppTool, handleAppViewMessage, rejectPendingAppRequests };
}
