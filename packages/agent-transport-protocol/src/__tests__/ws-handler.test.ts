/**
 * Tests for WebSocket transport handler.
 */

import { describe, it, expect, vi } from 'vitest';
import { createWsHandler } from '../ws-handler.js';
import type { TServerMessage } from '../ws-protocol.js';
import type {
  IBackgroundJobGroupState,
  IExecutionWorkspaceEvent,
  IExecutionWorkspaceSnapshot,
  IInteractiveSession,
  TBackgroundJobGroupEvent,
  TExecutionWorkspaceUpdateCause,
} from '@robota-sdk/agent-interface-transport';
import type {
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-transport';

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

const executionWorkspaceSnapshot: IExecutionWorkspaceSnapshot = {
  sessionId: 'session_1',
  entries: [],
  updatedAt: '2026-05-01T00:00:00.000Z',
};

const backgroundJobGroup: IBackgroundJobGroupState = {
  id: 'group_1',
  parentSessionId: 'session_1',
  waitPolicy: 'wait_all',
  taskIds: ['task_1'],
  status: 'running',
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
  results: [],
};

function createMockSession() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    submit: vi.fn().mockResolvedValue(undefined),
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
    listBackgroundJobGroups: vi.fn().mockReturnValue([backgroundJobGroup]),
    getBackgroundJobGroup: vi.fn().mockReturnValue(backgroundJobGroup),
    waitBackgroundJobGroup: vi.fn().mockResolvedValue({
      ...backgroundJobGroup,
      status: 'completed',
      completedAt: '2026-05-01T00:00:01.000Z',
      results: [{ taskId: 'task_1', label: 'Explore', status: 'completed', summary: 'done' }],
    }),
    cancelBackgroundTask: vi.fn().mockResolvedValue(undefined),
    closeBackgroundTask: vi.fn().mockResolvedValue(undefined),
    sendBackgroundTask: vi.fn().mockResolvedValue(undefined),
    readBackgroundTaskLog: vi.fn().mockResolvedValue(backgroundTaskLogPage),
    getExecutionWorkspaceSnapshot: vi.fn().mockReturnValue(executionWorkspaceSnapshot),
    executeCommand: vi.fn().mockResolvedValue({ message: 'done', success: true, data: {} }),
    resolvePermission: vi.fn(),
    resolveAsk: vi.fn(),
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
  } as unknown as IInteractiveSession & { _emit: (event: string, ...args: unknown[]) => void };
}

describe('WebSocket Transport Handler', () => {
  function setup() {
    const session = createMockSession();
    const sent: TServerMessage[] = [];
    const { onMessage, cleanup } = createWsHandler({
      session: session as unknown as IInteractiveSession,
      send: (msg) => sent.push(msg),
    });
    return { session, sent, onMessage, cleanup };
  }

  it('submit calls session.submit()', () => {
    const { onMessage, session } = setup();
    onMessage(JSON.stringify({ type: 'submit', prompt: 'hello' }));
    expect(
      (session as unknown as { submit: ReturnType<typeof vi.fn> }).submit,
    ).toHaveBeenCalledWith('hello', undefined, undefined, undefined);
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

  it('get-background-job-groups sends group snapshots', () => {
    const { onMessage, sent, session } = setup();
    onMessage(JSON.stringify({ type: 'get-background-job-groups' }));

    expect(sent[0]).toEqual({ type: 'background_job_groups', groups: [backgroundJobGroup] });
    expect(
      (session as unknown as { listBackgroundJobGroups: ReturnType<typeof vi.fn> })
        .listBackgroundJobGroups,
    ).toHaveBeenCalled();
  });

  it('get-background-job-group sends one group snapshot', () => {
    const { onMessage, sent, session } = setup();
    onMessage(JSON.stringify({ type: 'get-background-job-group', groupId: 'group_1' }));

    expect(sent[0]).toEqual({
      type: 'background_job_group',
      groupId: 'group_1',
      group: backgroundJobGroup,
    });
    expect(
      (session as unknown as { getBackgroundJobGroup: ReturnType<typeof vi.fn> })
        .getBackgroundJobGroup,
    ).toHaveBeenCalledWith('group_1');
  });

  it('wait-background-job-group waits and sends the completed group', async () => {
    const { onMessage, sent, session } = setup();
    onMessage(JSON.stringify({ type: 'wait-background-job-group', groupId: 'group_1' }));

    await new Promise((r) => setTimeout(r, 10));

    expect(
      (session as unknown as { waitBackgroundJobGroup: ReturnType<typeof vi.fn> })
        .waitBackgroundJobGroup,
    ).toHaveBeenCalledWith('group_1');
    expect(sent[0]).toMatchObject({
      type: 'background_job_group',
      groupId: 'group_1',
      group: { id: 'group_1', status: 'completed' },
    });
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

  it('command executes via session.executeCommand() tagged as a remote origin (REMOTE-003)', async () => {
    const { onMessage, sent, session } = setup();
    onMessage(JSON.stringify({ type: 'command', name: 'clear' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('command_result');
    // A transport-origin command is an untrusted remote origin — the handler tags it `'remote'` so the session
    // applies its (optional, allow-by-default) remote-command policy.
    // CMD-004 Phase 2: the 4th arg is the command-origin driver id — undefined when the handler has
    // no server-assigned id (unattributed; a client-sent id is NEVER trusted).
    expect(
      (session as unknown as { executeCommand: ReturnType<typeof vi.fn> }).executeCommand,
    ).toHaveBeenCalledWith('clear', '', 'remote', undefined);
  });

  it('command carries the SERVER-ASSIGNED driver id as the command origin (CMD-004 Phase 2)', async () => {
    const session = createMockSession();
    const sent: TServerMessage[] = [];
    const { onMessage } = createWsHandler({
      session: session as unknown as IInteractiveSession,
      send: (msg) => sent.push(msg),
      driverId: 'device-7',
    });
    onMessage(JSON.stringify({ type: 'command', name: 'settings' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(
      (session as unknown as { executeCommand: ReturnType<typeof vi.fn> }).executeCommand,
    ).toHaveBeenCalledWith('settings', '', 'remote', 'device-7');
  });

  it('forwards ui_intent session events to the requesting client (CMD-004 Phase 2)', () => {
    const session = createMockSession();
    const sent: TServerMessage[] = [];
    createWsHandler({
      session: session as unknown as IInteractiveSession,
      send: (msg) => sent.push(msg),
      driverId: 'device-7',
    });
    session._emit('ui_intent', {
      intent: { type: 'show-settings' },
      requesterDriverId: 'device-7',
    });
    expect(sent).toEqual([
      {
        type: 'ui_intent',
        event: { intent: { type: 'show-settings' }, requesterDriverId: 'device-7' },
      },
    ]);
  });

  // CMD-004 Stage D — `ui_intent` is REQUESTER-ROUTED (the spec's Key mechanics): the surface that
  // issued the command renders the intent; other surfaces never see it. Only an UNATTRIBUTED intent
  // (no requester id — e.g. an idle model-invoked command) reaches every surface, because it cannot
  // be routed and a silent drop is banned.
  describe('ui_intent requester routing (CMD-004 Stage D)', () => {
    function twoSurfaces() {
      const session = createMockSession();
      const sentA: TServerMessage[] = [];
      const sentB: TServerMessage[] = [];
      createWsHandler({
        session: session as unknown as IInteractiveSession,
        send: (msg) => sentA.push(msg),
        driverId: 'device-A',
      });
      createWsHandler({
        session: session as unknown as IInteractiveSession,
        send: (msg) => sentB.push(msg),
        driverId: 'device-B',
      });
      return { session, sentA, sentB };
    }

    it('routes a requester-stamped intent ONLY to the invoking surface — not broadcast', () => {
      const { session, sentA, sentB } = twoSurfaces();
      session._emit('ui_intent', {
        intent: { type: 'show-session-picker' },
        requesterDriverId: 'device-A',
      });
      expect(sentA).toEqual([
        {
          type: 'ui_intent',
          event: { intent: { type: 'show-session-picker' }, requesterDriverId: 'device-A' },
        },
      ]);
      expect(sentB).toEqual([]);
    });

    it('an unattributed intent reaches every surface (unroutable — never silently dropped)', () => {
      const { session, sentA, sentB } = twoSurfaces();
      session._emit('ui_intent', { intent: { type: 'show-settings' } });
      expect(sentA).toEqual([{ type: 'ui_intent', event: { intent: { type: 'show-settings' } } }]);
      expect(sentB).toEqual(sentA);
    });

    it("a surface with NO server-assigned id never receives another surface's intent", () => {
      const { sent, session } = setup(); // setup() builds a handler without a driverId
      session._emit('ui_intent', {
        intent: { type: 'show-agent-switcher' },
        requesterDriverId: 'device-elsewhere',
      });
      expect(sent).toEqual([]);
    });
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

  it('submit rejection surfaces a protocol_error (WS-001)', async () => {
    const { onMessage, sent, session } = setup();
    (session as unknown as { submit: ReturnType<typeof vi.fn> }).submit.mockRejectedValueOnce(
      new Error('submit failed'),
    );
    onMessage(JSON.stringify({ type: 'submit', prompt: 'hello' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toEqual([{ type: 'protocol_error', message: 'submit failed' }]);
  });

  it('command rejection surfaces a protocol_error (WS-001)', async () => {
    const { onMessage, sent, session } = setup();
    (
      session as unknown as { executeCommand: ReturnType<typeof vi.fn> }
    ).executeCommand.mockRejectedValueOnce(new Error('command failed'));
    onMessage(JSON.stringify({ type: 'command', name: 'clear' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toEqual([{ type: 'protocol_error', message: 'command failed' }]);
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

  it('forwards background job group events to the client', () => {
    const { session, sent } = setup();
    const event: TBackgroundJobGroupEvent = {
      type: 'background_job_group_completed',
      group: { ...backgroundJobGroup, status: 'completed' },
    };
    (session as unknown as { _emit: (e: string, ...args: unknown[]) => void })._emit(
      'background_job_group_event',
      event,
    );

    expect(sent[0]).toEqual({ type: 'background_job_group_event', event });
  });

  it('forwards execution_workspace_event to the client', () => {
    const { session, sent } = setup();
    const event: IExecutionWorkspaceEvent = {
      type: 'execution_workspace_updated',
      cause: 'main_thread',
      snapshot: executionWorkspaceSnapshot,
    };
    (session as unknown as { _emit: (e: string, ...args: unknown[]) => void })._emit(
      'execution_workspace_event',
      event,
    );

    expect(sent[0]).toEqual({
      type: 'execution_workspace_event',
      snapshot: executionWorkspaceSnapshot,
    });
  });

  it('get-execution-workspace sends current snapshot', () => {
    const { onMessage, sent, session } = setup();
    onMessage(JSON.stringify({ type: 'get-execution-workspace' }));

    expect(sent[0]).toEqual({
      type: 'execution_workspace_event',
      snapshot: executionWorkspaceSnapshot,
    });
    expect(
      (
        session as unknown as {
          getExecutionWorkspaceSnapshot: ReturnType<typeof vi.fn>;
        }
      ).getExecutionWorkspaceSnapshot,
    ).toHaveBeenCalled();
  });

  // ── REMOTE-007: transport-neutral permission/ask over the wire (TC-06) ──

  it('forwards a permission_request session event to the client', () => {
    const { session, sent } = setup();
    session._emit('permission_request', {
      id: 'p1',
      toolName: 'Bash',
      toolArgs: { command: 'ls' },
    });
    const msg = sent.find((m) => m.type === 'permission_request');
    expect(msg).toEqual({
      type: 'permission_request',
      event: { id: 'p1', toolName: 'Bash', toolArgs: { command: 'ls' } },
    });
  });

  it('forwards ask_request and prompt_resolved session events to the client', () => {
    const { session, sent } = setup();
    session._emit('ask_request', { id: 'a1', request: { id: 'r', title: 'Pick' } });
    session._emit('prompt_resolved', { id: 'a1' });
    expect(sent.find((m) => m.type === 'ask_request')).toEqual({
      type: 'ask_request',
      event: { id: 'a1', request: { id: 'r', title: 'Pick' } },
    });
    expect(sent.find((m) => m.type === 'prompt_resolved')).toEqual({
      type: 'prompt_resolved',
      event: { id: 'a1' },
    });
  });

  it('a permission-response from the client resolves the pending permission by id', () => {
    const { onMessage, session } = setup();
    onMessage(JSON.stringify({ type: 'permission-response', id: 'p1', result: true }));
    expect(
      (session as unknown as { resolvePermission: ReturnType<typeof vi.fn> }).resolvePermission,
    ).toHaveBeenCalledWith('p1', true, undefined);
  });

  it('an ask-response from the client resolves the pending ask by id', () => {
    const { onMessage, session } = setup();
    const response = { type: 'answer', values: ['React'] };
    onMessage(JSON.stringify({ type: 'ask-response', id: 'a1', response }));
    expect(
      (session as unknown as { resolveAsk: ReturnType<typeof vi.fn> }).resolveAsk,
    ).toHaveBeenCalledWith('a1', response, undefined);
  });

  it('cleanup unsubscribes from all events', () => {
    const { session, cleanup } = setup();
    cleanup();
    // 11 base events + 3 REMOTE-007 prompt events (permission_request/ask_request/prompt_resolved)
    // + 3 CMD-004 Phase 2 events (ui_intent + the session_renamed/history_cleared broadcasts).
    expect((session as unknown as { off: ReturnType<typeof vi.fn> }).off).toHaveBeenCalledTimes(17);
  });
});
