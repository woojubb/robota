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
  IToolState,
  IExecutionResult,
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  ICommandResult,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-sdk';
import {
  handleBackgroundControlMessage,
  handleBackgroundQueryMessage,
} from './ws-background-messages.js';

type TBackgroundControlAction = 'cancel' | 'close' | 'send';

/** Inbound message from client → server. */
export type TClientMessage =
  | { type: 'submit'; prompt: string }
  | { type: 'command'; name: string; args?: string }
  | { type: 'abort' }
  | { type: 'cancel-queue' }
  | { type: 'get-messages' }
  | { type: 'get-context' }
  | { type: 'get-executing' }
  | { type: 'get-pending' }
  | { type: 'get-background-tasks'; filter?: IBackgroundTaskListFilter }
  | { type: 'get-background-task'; taskId: string }
  | { type: 'cancel-background-task'; taskId: string; reason?: string }
  | { type: 'close-background-task'; taskId: string }
  | { type: 'send-background-task'; taskId: string; input: IBackgroundTaskInput }
  | { type: 'read-background-task-log'; taskId: string; cursor?: IBackgroundTaskLogCursor };

/** Outbound message from server → client. */
export type TServerMessage =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; state: IToolState }
  | { type: 'tool_end'; state: IToolState }
  | { type: 'thinking'; isThinking: boolean }
  | { type: 'complete'; result: IExecutionResult }
  | { type: 'interrupted'; result: IExecutionResult }
  | { type: 'error'; message: string }
  | {
      type: 'command_result';
      name: string;
      message: string;
      success: boolean;
      data?: ICommandResult['data'];
    }
  | { type: 'messages'; messages: ReturnType<InteractiveSession['getMessages']> }
  | { type: 'context'; state: ReturnType<InteractiveSession['getContextState']> }
  | { type: 'executing'; executing: boolean }
  | { type: 'pending'; pending: string | null }
  | { type: 'background_task_event'; event: TBackgroundTaskEvent }
  | { type: 'background_tasks'; tasks: IBackgroundTaskState[] }
  | { type: 'background_task'; taskId: string; task: IBackgroundTaskState | null }
  | { type: 'background_task_log'; taskId: string; page: IBackgroundTaskLogPage }
  | {
      type: 'background_task_control_result';
      action: TBackgroundControlAction;
      taskId: string;
      success: boolean;
      message?: string;
    }
  | { type: 'protocol_error'; message: string };

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

  session.on('text_delta', onTextDelta);
  session.on('tool_start', onToolStart);
  session.on('tool_end', onToolEnd);
  session.on('thinking', onThinking);
  session.on('complete', onComplete);
  session.on('interrupted', onInterrupted);
  session.on('error', onError);
  session.on('background_task_event', onBackgroundTaskEvent);

  return (): void => {
    session.off('text_delta', onTextDelta);
    session.off('tool_start', onToolStart);
    session.off('tool_end', onToolEnd);
    session.off('thinking', onThinking);
    session.off('complete', onComplete);
    session.off('interrupted', onInterrupted);
    session.off('error', onError);
    session.off('background_task_event', onBackgroundTaskEvent);
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
  switch (msg.type) {
    case 'submit':
    case 'command':
    case 'abort':
    case 'cancel-queue':
      handleSessionControlMessage(session, send, msg);
      return;
    case 'get-messages':
    case 'get-context':
    case 'get-executing':
    case 'get-pending':
      handleSessionQueryMessage(session, send, msg);
      return;
    case 'get-background-tasks':
    case 'get-background-task':
    case 'read-background-task-log':
      handleBackgroundQueryMessage(session, send, msg);
      return;
    case 'cancel-background-task':
    case 'close-background-task':
    case 'send-background-task':
      handleBackgroundControlMessage(session, send, msg);
      return;
    default:
      send({ type: 'protocol_error', message: `Unknown message type: ${getMessageType(msg)}` });
  }
}

function getMessageType(msg: TClientMessage): string {
  return (msg as { type: string }).type;
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
