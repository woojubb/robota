/**
 * WebSocket transport adapter — exposes InteractiveSession over WebSocket.
 *
 * Framework-agnostic: works with any WebSocket implementation via
 * send/onMessage callbacks. No dependency on ws, uWebSockets, etc.
 *
 * Protocol: JSON messages with { type, ...payload } structure.
 * Server pushes InteractiveSession events to client in real-time.
 */

import type { InteractiveSession, IToolState, IExecutionResult } from '@robota-sdk/agent-sdk';

/** Inbound message from client → server. */
export type TClientMessage =
  | { type: 'submit'; prompt: string }
  | { type: 'command'; name: string; args?: string }
  | { type: 'abort' }
  | { type: 'cancel-queue' }
  | { type: 'get-messages' }
  | { type: 'get-context' }
  | { type: 'get-executing' }
  | { type: 'get-pending' };

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
      data?: Record<string, unknown>;
    }
  | { type: 'messages'; messages: unknown[] }
  | { type: 'context'; state: unknown }
  | { type: 'executing'; executing: boolean }
  | { type: 'pending'; pending: string | null }
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
  const { session, send } = options;

  // Subscribe to InteractiveSession events and push to client
  const onTextDelta = (delta: string): void => send({ type: 'text_delta', delta });
  const onToolStart = (state: IToolState): void => send({ type: 'tool_start', state });
  const onToolEnd = (state: IToolState): void => send({ type: 'tool_end', state });
  const onThinking = (isThinking: boolean): void => send({ type: 'thinking', isThinking });
  const onComplete = (result: IExecutionResult): void => send({ type: 'complete', result });
  const onInterrupted = (result: IExecutionResult): void => send({ type: 'interrupted', result });
  const onError = (error: Error): void => send({ type: 'error', message: error.message });

  session.on('text_delta', onTextDelta);
  session.on('tool_start', onToolStart);
  session.on('tool_end', onToolEnd);
  session.on('thinking', onThinking);
  session.on('complete', onComplete);
  session.on('interrupted', onInterrupted);
  session.on('error', onError);

  const onMessage = (data: string): void => {
    let msg: TClientMessage;
    try {
      msg = JSON.parse(data) as TClientMessage;
    } catch {
      send({ type: 'protocol_error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'submit':
        if (!msg.prompt) {
          send({ type: 'protocol_error', message: 'prompt is required' });
          return;
        }
        session.submit(msg.prompt);
        break;

      case 'command':
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
        break;

      case 'abort':
        session.abort();
        break;

      case 'cancel-queue':
        session.cancelQueue();
        break;

      case 'get-messages':
        send({ type: 'messages', messages: session.getMessages() });
        break;

      case 'get-context':
        send({ type: 'context', state: session.getContextState() });
        break;

      case 'get-executing':
        send({ type: 'executing', executing: session.isExecuting() });
        break;

      case 'get-pending':
        send({ type: 'pending', pending: session.getPendingPrompt() });
        break;

      default:
        send({
          type: 'protocol_error',
          message: `Unknown message type: ${(msg as Record<string, string>).type}`,
        });
    }
  };

  const cleanup = (): void => {
    session.off('text_delta', onTextDelta);
    session.off('tool_start', onToolStart);
    session.off('tool_end', onToolEnd);
    session.off('thinking', onThinking);
    session.off('complete', onComplete);
    session.off('interrupted', onInterrupted);
    session.off('error', onError);
  };

  return { onMessage, cleanup };
}
