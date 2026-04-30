/**
 * Tests for WebSocket transport handler.
 */

import { describe, it, expect, vi } from 'vitest';
import { createWsHandler } from '../ws-handler.js';
import type { TServerMessage } from '../ws-handler.js';
import type {
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  InteractiveSession,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-sdk';

const backgroundTask: IBackgroundTaskState = {
  id: 'task_1',
  kind: 'agent',
  label: 'Explore',
  agentType: 'Explore',
  status: 'running',
  mode: 'background',
  parentSessionId: 'session_1',
  depth: 0,
  cwd: '/repo',
  updatedAt: '2026-05-01T00:00:00.000Z',
  unread: false,
  promptPreview: 'inspect code',
};

const backgroundTaskLogPage: IBackgroundTaskLogPage = {
  taskId: 'task_1',
  cursor: { offset: 0 },
  lines: ['line one'],
};

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
    listBackgroundTasks: vi.fn().mockReturnValue([backgroundTask]),
    getBackgroundTask: vi.fn().mockReturnValue(backgroundTask),
    cancelBackgroundTask: vi.fn().mockResolvedValue(undefined),
    closeBackgroundTask: vi.fn().mockResolvedValue(undefined),
    sendBackgroundTask: vi.fn().mockResolvedValue(undefined),
    readBackgroundTaskLog: vi.fn().mockResolvedValue(backgroundTaskLogPage),
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

  it('get-background-tasks sends current background task list', () => {
    const { onMessage, sent, session } = setup();
    onMessage(JSON.stringify({ type: 'get-background-tasks', filter: { kind: 'agent' } }));

    expect(sent[0]).toEqual({ type: 'background_tasks', tasks: [backgroundTask] });
    expect(
      (session as unknown as { listBackgroundTasks: ReturnType<typeof vi.fn> }).listBackgroundTasks,
    ).toHaveBeenCalledWith({ kind: 'agent' });
  });

  it('get-background-task sends one background task snapshot', () => {
    const { onMessage, sent, session } = setup();
    onMessage(JSON.stringify({ type: 'get-background-task', taskId: 'task_1' }));

    expect(sent[0]).toEqual({
      type: 'background_task',
      taskId: 'task_1',
      task: backgroundTask,
    });
    expect(
      (session as unknown as { getBackgroundTask: ReturnType<typeof vi.fn> }).getBackgroundTask,
    ).toHaveBeenCalledWith('task_1');
  });

  it('cancel-background-task maps to session control and emits control result', async () => {
    const { onMessage, sent, session } = setup();
    onMessage(JSON.stringify({ type: 'cancel-background-task', taskId: 'task_1', reason: 'stop' }));

    await new Promise((r) => setTimeout(r, 10));

    expect(
      (session as unknown as { cancelBackgroundTask: ReturnType<typeof vi.fn> })
        .cancelBackgroundTask,
    ).toHaveBeenCalledWith('task_1', 'stop');
    expect(sent[0]).toEqual({
      type: 'background_task_control_result',
      action: 'cancel',
      taskId: 'task_1',
      success: true,
    });
  });

  it('send-background-task maps prompt input to session control', async () => {
    const { onMessage, sent, session } = setup();
    onMessage(
      JSON.stringify({
        type: 'send-background-task',
        taskId: 'task_1',
        input: { prompt: 'continue' },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(
      (session as unknown as { sendBackgroundTask: ReturnType<typeof vi.fn> }).sendBackgroundTask,
    ).toHaveBeenCalledWith('task_1', { prompt: 'continue' });
    expect(sent[0]).toEqual({
      type: 'background_task_control_result',
      action: 'send',
      taskId: 'task_1',
      success: true,
    });
  });

  it('read-background-task-log sends log page', async () => {
    const { onMessage, sent, session } = setup();
    onMessage(
      JSON.stringify({
        type: 'read-background-task-log',
        taskId: 'task_1',
        cursor: { offset: 0 },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(
      (session as unknown as { readBackgroundTaskLog: ReturnType<typeof vi.fn> })
        .readBackgroundTaskLog,
    ).toHaveBeenCalledWith('task_1', { offset: 0 });
    expect(sent[0]).toEqual({
      type: 'background_task_log',
      taskId: 'task_1',
      page: backgroundTaskLogPage,
    });
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

  it('forwards background task events to the client', () => {
    const { session, sent } = setup();
    const event: TBackgroundTaskEvent = {
      type: 'background_task_text_delta',
      taskId: 'task_1',
      delta: 'partial',
    };
    (session as unknown as { _emit: (e: string, ...args: unknown[]) => void })._emit(
      'background_task_event',
      event,
    );

    expect(sent[0]).toEqual({ type: 'background_task_event', event });
  });

  it('cleanup unsubscribes from all events', () => {
    const { session, cleanup } = setup();
    cleanup();
    expect((session as unknown as { off: ReturnType<typeof vi.fn> }).off).toHaveBeenCalledTimes(8);
  });
});
