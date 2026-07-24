/**
 * WebSocket transport adapter — exposes IInteractiveSession over WebSocket.
 *
 * Framework-agnostic: works with any WebSocket implementation via
 * send/onMessage callbacks. No dependency on ws, uWebSockets, etc.
 *
 * Protocol: JSON messages with { type, ...payload } structure.
 * Server pushes IInteractiveSession events to client in real-time.
 */

import {
  handleBackgroundControlMessage,
  handleBackgroundQueryMessage,
} from './ws-background-messages.js';
import { subscribeSessionEvents } from './ws-session-events.js';

import type { TClientMessage, TServerMessage } from './ws-protocol.js';
import type { IInteractiveSession, TDriverId } from '@robota-sdk/agent-interface-transport';

// Outbound session→TServerMessage fan-out (incl. CMD-004 requester-routed `ui_intent`) lives in
// `ws-session-events.ts`; re-exported here for the bridge and existing importers.
export { subscribeSessionEvents } from './ws-session-events.js';
export type { ISubscribeSessionEventsOptions } from './ws-session-events.js';

export interface IWsHandlerOptions {
  /** IInteractiveSession to expose. */
  session: IInteractiveSession;
  /** Send a JSON message to the client. */
  send: (message: TServerMessage) => void;
  /**
   * REMOTE-014 E5: the SERVER-ASSIGNED driver id for THIS remote surface (the E3 `deviceId`). Injected into
   * every inbound `submit`/`command`/prompt-response so a co-drive turn/answer is attributed to this driver —
   * a client-supplied driver id is NEVER trusted. Absent → unattributed (the session defaults to the owner).
   */
  driverId?: TDriverId;
}

/**
 * Create a WebSocket message handler for an IInteractiveSession.
 *
 * Returns:
 * - `onMessage(data)`: call this when the WebSocket receives a message
 * - `cleanup()`: call this when the WebSocket disconnects
 *
 * Usage:
 * ```typescript
 * const { onMessage, cleanup } = createWsHandler({
 *   session: interactiveSession,
 *   send: (msg) => ws.send(JSON.stringify(msg)),
 * });
 *
 * ws.on('message', (data) => onMessage(String(data)));
 * ws.on('close', cleanup);
 * ```
 */
export function createWsHandler(options: IWsHandlerOptions): {
  onMessage: (data: string) => void;
  cleanup: () => void;
} {
  const cleanup = subscribeSessionEvents(options.session, options.send, {
    getSurfaceDriverId: () => options.driverId,
  });
  const onMessage = createWsMessageHandler(options.session, options.send, options.driverId);

  return { onMessage, cleanup };
}

function createWsMessageHandler(
  session: IInteractiveSession,
  send: (message: TServerMessage) => void,
  driverId?: TDriverId,
): (data: string) => void {
  return (data: string): void => {
    const msg = parseClientMessage(data, send);
    if (!msg) return;
    handleClientMessage(session, send, msg, driverId);
  };
}

/** Parse a client JSON frame; on invalid JSON it emits `protocol_error` and returns null. Exported for E4. */
export function parseClientMessage(
  data: string,
  send: (message: TServerMessage) => void,
): TClientMessage | null {
  try {
    return JSON.parse(data) as TClientMessage;
  } catch {
    send({ type: 'protocol_error', message: 'Invalid JSON' });
    return null;
  }
}

/**
 * Route a parsed client message to the session (control/query/background/prompt-response). Exported for E4:
 * the {@link SessionResumeBridge} intercepts `resume`/`ack` itself and delegates everything else here.
 */
export function handleClientMessage(
  session: IInteractiveSession,
  send: (message: TServerMessage) => void,
  msg: TClientMessage,
  driverId?: TDriverId,
): void {
  if (isSessionControlMessage(msg)) {
    handleSessionControlMessage(session, send, msg, driverId);
    return;
  }
  if (isSessionQueryMessage(msg)) {
    handleSessionQueryMessage(session, send, msg);
    return;
  }
  if (isBackgroundQueryMessage(msg)) {
    handleBackgroundQueryMessage(session, send, msg);
    return;
  }
  if (isBackgroundControlMessage(msg)) {
    handleBackgroundControlMessage(session, send, msg);
    return;
  }
  if (isPromptResponseMessage(msg)) {
    handlePromptResponseMessage(session, msg, driverId);
    return;
  }
  const unknownType = (msg as { type: string }).type;
  send({ type: 'protocol_error', message: `Unknown message type: ${unknownType}` });
}

function isSessionControlMessage(
  msg: TClientMessage,
): msg is Extract<TClientMessage, { type: 'submit' | 'command' | 'abort' | 'cancel-queue' }> {
  return (
    msg.type === 'submit' ||
    msg.type === 'command' ||
    msg.type === 'abort' ||
    msg.type === 'cancel-queue'
  );
}

function isSessionQueryMessage(msg: TClientMessage): msg is Extract<
  TClientMessage,
  {
    type:
      'get-messages' | 'get-context' | 'get-executing' | 'get-pending' | 'get-execution-workspace';
  }
> {
  return (
    msg.type === 'get-messages' ||
    msg.type === 'get-context' ||
    msg.type === 'get-executing' ||
    msg.type === 'get-pending' ||
    msg.type === 'get-execution-workspace'
  );
}

function isBackgroundQueryMessage(
  msg: TClientMessage,
): msg is Extract<
  TClientMessage,
  | { type: 'get-background-tasks' | 'get-background-task' | 'read-background-task-log' }
  | { type: 'get-background-job-groups' | 'get-background-job-group' | 'wait-background-job-group' }
> {
  return (
    msg.type === 'get-background-tasks' ||
    msg.type === 'get-background-task' ||
    msg.type === 'read-background-task-log' ||
    msg.type === 'get-background-job-groups' ||
    msg.type === 'get-background-job-group' ||
    msg.type === 'wait-background-job-group'
  );
}

function isBackgroundControlMessage(
  msg: TClientMessage,
): msg is Extract<
  TClientMessage,
  { type: 'cancel-background-task' | 'close-background-task' | 'send-background-task' }
> {
  return (
    msg.type === 'cancel-background-task' ||
    msg.type === 'close-background-task' ||
    msg.type === 'send-background-task'
  );
}

function isPromptResponseMessage(
  msg: TClientMessage,
): msg is Extract<TClientMessage, { type: 'permission-response' | 'ask-response' }> {
  return msg.type === 'permission-response' || msg.type === 'ask-response';
}

/**
 * REMOTE-007: a driving client answered a pending prompt by id. `resolvePermission`/`resolveAsk` are
 * idempotent — a stale id (already answered by another surface, or drained) is a safe no-op, so no
 * acknowledgement is needed; the resulting `prompt_resolved` server event is the shared signal.
 */
function handlePromptResponseMessage(
  session: IInteractiveSession,
  msg: Extract<TClientMessage, { type: 'permission-response' | 'ask-response' }>,
  driverId?: TDriverId,
): void {
  // REMOTE-014 E5: record the SERVER-ASSIGNED answering driver (not client-sent) on `prompt_resolved`.
  if (msg.type === 'permission-response') {
    session.resolvePermission(msg.id, msg.result, driverId);
  } else {
    session.resolveAsk(msg.id, msg.response, driverId);
  }
}

function handleSessionControlMessage(
  session: IInteractiveSession,
  send: (message: TServerMessage) => void,
  msg: Extract<TClientMessage, { type: 'submit' | 'command' | 'abort' | 'cancel-queue' }>,
  driverId?: TDriverId,
): void {
  if (msg.type === 'submit') {
    if (!msg.prompt) {
      send({ type: 'protocol_error', message: 'prompt is required' });
      return;
    }
    // REMOTE-014 E5: attribute this remote turn to the SERVER-ASSIGNED driver id (never a client-sent one).
    session
      .submit(msg.prompt, undefined, undefined, driverId ? { driverId } : undefined)
      .catch((error: Error) => {
        send({ type: 'protocol_error', message: error.message });
      });
  } else if (msg.type === 'command') {
    if (!msg.name) {
      send({ type: 'protocol_error', message: 'name is required' });
      return;
    }
    // REMOTE-003: a transport-origin command is tagged `'remote'` (optional policy, allow-by-default;
    // REMOTE-006). CMD-004: the SERVER-ASSIGNED driver id (E5) is the command origin — intents route back here.
    session.executeCommand(msg.name, msg.args ?? '', 'remote', driverId).then(
      (result) => {
        send({
          type: 'command_result',
          name: msg.name,
          message: result?.message ?? `Unknown command: ${msg.name}`,
          success: result?.success ?? false,
          data: result?.data,
        });
      },
      (error: Error) => {
        send({ type: 'protocol_error', message: error.message });
      },
    );
  } else if (msg.type === 'abort') {
    session.abort();
  } else {
    session.cancelQueue();
  }
}

function handleSessionQueryMessage(
  session: IInteractiveSession,
  send: (message: TServerMessage) => void,
  msg: Extract<
    TClientMessage,
    {
      type:
        | 'get-messages'
        | 'get-context'
        | 'get-executing'
        | 'get-pending'
        | 'get-execution-workspace';
    }
  >,
): void {
  if (msg.type === 'get-messages') {
    send({ type: 'messages', messages: session.getMessages() });
  } else if (msg.type === 'get-context') {
    send({ type: 'context', state: session.getContextState() });
  } else if (msg.type === 'get-executing') {
    send({ type: 'executing', executing: session.isExecuting() });
  } else if (msg.type === 'get-execution-workspace') {
    send({
      type: 'execution_workspace_event',
      snapshot: session.getExecutionWorkspaceSnapshot(),
    });
  } else {
    send({ type: 'pending', pending: session.getPendingPrompt() });
  }
}
