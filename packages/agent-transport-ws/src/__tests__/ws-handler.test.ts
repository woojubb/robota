/**
 * Tests for WebSocket transport handler.
 */

import { describe, it, expect, vi } from 'vitest';
import { createWsHandler } from '../ws-handler.js';
import type { TServerMessage } from '../ws-handler.js';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';

function createMockSession() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([{ role: 'user', content: 'hi' }]),
    getContextState: vi
      .fn()
      .mockReturnValue({ usedTokens: 500, maxTokens: 100000, usedPercentage: 0.5 }),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    executeCommand: vi.fn().mockResolvedValue({ message: 'done', success: true, data: {} }),
    listCommands: vi.fn().mockReturnValue([]),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    _emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((h) => h(...args));
    },
  } as unknown as InteractiveSession & { _emit: (event: string, ...args: unknown[]) => void };
}

describe('WebSocket Transport Handler', () => {
  function setup() {
    const session = createMockSession();
    const sent: TServerMessage[] = [];
    const { onMessage, cleanup } = createWsHandler({
      session: session as unknown as InteractiveSession,
      send: (msg) => sent.push(msg),
    });
    return { session, sent, onMessage, cleanup };
  }

  it('submit calls session.submit()', () => {
    const { onMessage, session } = setup();
    onMessage(JSON.stringify({ type: 'submit', prompt: 'hello' }));
    expect(
      (session as unknown as { submit: ReturnType<typeof vi.fn> }).submit,
    ).toHaveBeenCalledWith('hello');
  });

  it('abort calls session.abort()', () => {
    const { onMessage, session } = setup();
    onMessage(JSON.stringify({ type: 'abort' }));
    expect((session as unknown as { abort: ReturnType<typeof vi.fn> }).abort).toHaveBeenCalled();
  });

  it('cancel-queue calls session.cancelQueue()', () => {
    const { onMessage, session } = setup();
    onMessage(JSON.stringify({ type: 'cancel-queue' }));
    expect(
      (session as unknown as { cancelQueue: ReturnType<typeof vi.fn> }).cancelQueue,
    ).toHaveBeenCalled();
  });

  it('get-messages sends messages back', () => {
    const { onMessage, sent } = setup();
    onMessage(JSON.stringify({ type: 'get-messages' }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('messages');
  });

  it('get-context sends context state back', () => {
    const { onMessage, sent } = setup();
    onMessage(JSON.stringify({ type: 'get-context' }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('context');
  });

  it('get-executing sends executing status', () => {
    const { onMessage, sent } = setup();
    onMessage(JSON.stringify({ type: 'get-executing' }));
    expect(sent[0]).toEqual({ type: 'executing', executing: false });
  });

  it('get-pending sends pending prompt', () => {
    const { onMessage, sent } = setup();
    onMessage(JSON.stringify({ type: 'get-pending' }));
    expect(sent[0]).toEqual({ type: 'pending', pending: null });
  });

  it('command executes via session.executeCommand()', async () => {
    const { onMessage, sent, session } = setup();
    onMessage(JSON.stringify({ type: 'command', name: 'clear' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('command_result');
    expect(
      (session as unknown as { executeCommand: ReturnType<typeof vi.fn> }).executeCommand,
    ).toHaveBeenCalledWith('clear', '');
  });

  it('invalid JSON sends protocol_error', () => {
    const { onMessage, sent } = setup();
    onMessage('not json');
    expect(sent[0]).toEqual({ type: 'protocol_error', message: 'Invalid JSON' });
  });

  it('unknown type sends protocol_error', () => {
    const { onMessage, sent } = setup();
    onMessage(JSON.stringify({ type: 'unknown_type' }));
    expect(sent[0]!.type).toBe('protocol_error');
  });

  it('submit without prompt sends protocol_error', () => {
    const { onMessage, sent } = setup();
    onMessage(JSON.stringify({ type: 'submit' }));
    expect(sent[0]).toEqual({ type: 'protocol_error', message: 'prompt is required' });
  });

  it('forwards InteractiveSession events to client', () => {
    const { session, sent } = setup();
    (session as unknown as { _emit: (e: string, ...args: unknown[]) => void })._emit(
      'text_delta',
      'hello',
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({ type: 'text_delta', delta: 'hello' });
  });

  it('forwards thinking event', () => {
    const { session, sent } = setup();
    (session as unknown as { _emit: (e: string, ...args: unknown[]) => void })._emit(
      'thinking',
      true,
    );
    expect(sent[0]).toEqual({ type: 'thinking', isThinking: true });
  });

  it('cleanup unsubscribes from all events', () => {
    const { session, cleanup } = setup();
    cleanup();
    expect((session as unknown as { off: ReturnType<typeof vi.fn> }).off).toHaveBeenCalledTimes(7);
  });
});
