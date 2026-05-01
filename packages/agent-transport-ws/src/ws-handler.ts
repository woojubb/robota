/**
 * WebSocket transport adapter — exposes InteractiveSession over WebSocket.
 *
 * Framework-agnostic: works with any WebSocket implementation via
 * send/onMessage callbacks. No dependency on ws, uWebSockets, etc.
 *
 * Protocol: JSON messages with { type, ...payload } structure.
 * Server pushes InteractiveSession events to client in real-time.
 */

import type {
  InteractiveSession,
  IExecutionResult,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
  IToolState,
} from '@robota-sdk/agent-sdk';
import type { TClientMessage, TServerMessage } from './ws-protocol.js';
import {
  handleBackgroundControlMessage,
  handleBackgroundQueryMessage,
} from './ws-background-messages.js';

export interface IWsHandlerOptions {
  /** InteractiveSession to expose. */
  session: InteractiveSession;
  /** Send a JSON message to the client. */
  send: (message: TServerMessage) => void;
}

/**
 * Create a WebSocket message handler for an InteractiveSession.
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
  const cleanup = subscribeSessionEvents(options.session, options.send);
  const onMessage = createWsMessageHandler(options.session, options.send);

  return { onMessage, cleanup };
}

function subscribeSessionEvents(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
): () => void {
  const onTextDelta = (delta: string): void => send({ type: 'text_delta', delta });
  const onToolStart = (state: IToolState): void => send({ type: 'tool_start', state });
  const onToolEnd = (state: IToolState): void => send({ type: 'tool_end', state });
  const onThinking = (isThinking: boolean): void => send({ type: 'thinking', isThinking });
  const onComplete = (result: IExecutionResult): void => send({ type: 'complete', result });
  const onInterrupted = (result: IExecutionResult): void => send({ type: 'interrupted', result });
  const onError = (error: Error): void => send({ type: 'error', message: error.message });
  const onBackgroundTaskEvent = (event: TBackgroundTaskEvent): void =>
    send({ type: 'background_task_event', event });
  const onBackgroundJobGroupEvent = (event: TBackgroundJobGroupEvent): void =>
    send({ type: 'background_job_group_event', event });

  session.on('text_delta', onTextDelta);
  session.on('tool_start', onToolStart);
  session.on('tool_end', onToolEnd);
  session.on('thinking', onThinking);
  session.on('complete', onComplete);
  session.on('interrupted', onInterrupted);
  session.on('error', onError);
  session.on('background_task_event', onBackgroundTaskEvent);
  session.on('background_job_group_event', onBackgroundJobGroupEvent);

  return (): void => {
    session.off('text_delta', onTextDelta);
    session.off('tool_start', onToolStart);
    session.off('tool_end', onToolEnd);
    session.off('thinking', onThinking);
    session.off('complete', onComplete);
    session.off('interrupted', onInterrupted);
    session.off('error', onError);
    session.off('background_task_event', onBackgroundTaskEvent);
    session.off('background_job_group_event', onBackgroundJobGroupEvent);
  };
}

function createWsMessageHandler(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
): (data: string) => void {
  return (data: string): void => {
    const msg = parseClientMessage(data, send);
    if (!msg) return;
    handleClientMessage(session, send, msg);
  };
}

function parseClientMessage(
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

function handleClientMessage(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
  msg: TClientMessage,
): void {
  if (isSessionControlMessage(msg)) {
    handleSessionControlMessage(session, send, msg);
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
  send({ type: 'protocol_error', message: `Unknown message type: ${getMessageType(msg)}` });
}

function getMessageType(msg: TClientMessage): string {
  return (msg as { type: string }).type;
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

function isSessionQueryMessage(
  msg: TClientMessage,
): msg is Extract<
  TClientMessage,
  { type: 'get-messages' | 'get-context' | 'get-executing' | 'get-pending' }
> {
  return (
    msg.type === 'get-messages' ||
    msg.type === 'get-context' ||
    msg.type === 'get-executing' ||
    msg.type === 'get-pending'
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

function handleSessionControlMessage(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
  msg: Extract<TClientMessage, { type: 'submit' | 'command' | 'abort' | 'cancel-queue' }>,
): void {
  if (msg.type === 'submit') {
    if (!msg.prompt) {
      send({ type: 'protocol_error', message: 'prompt is required' });
      return;
    }
    session.submit(msg.prompt);
  } else if (msg.type === 'command') {
    if (!msg.name) {
      send({ type: 'protocol_error', message: 'name is required' });
      return;
    }
    session.executeCommand(msg.name, msg.args ?? '').then((result) => {
      send({
        type: 'command_result',
        name: msg.name,
        message: result?.message ?? `Unknown command: ${msg.name}`,
        success: result?.success ?? false,
        data: result?.data,
      });
    });
  } else if (msg.type === 'abort') {
    session.abort();
  } else {
    session.cancelQueue();
  }
}

function handleSessionQueryMessage(
  session: InteractiveSession,
  send: (message: TServerMessage) => void,
  msg: Extract<
    TClientMessage,
    { type: 'get-messages' | 'get-context' | 'get-executing' | 'get-pending' }
  >,
): void {
  if (msg.type === 'get-messages') {
    send({ type: 'messages', messages: session.getMessages() });
  } else if (msg.type === 'get-context') {
    send({ type: 'context', state: session.getContextState() });
  } else if (msg.type === 'get-executing') {
    send({ type: 'executing', executing: session.isExecuting() });
  } else {
    send({ type: 'pending', pending: session.getPendingPrompt() });
  }
}
