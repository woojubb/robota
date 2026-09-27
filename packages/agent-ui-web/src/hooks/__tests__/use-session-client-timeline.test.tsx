// @vitest-environment jsdom
/**
 * #3186 — command output and tool calls belong to the conversation timeline, as the TUI renders
 * them, not to banners stacked above it.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TClientMessage } from '../../client/ws-session-client.js';
import type { TServerMessage } from '@robota-sdk/agent-transport';

function setup(): {
  result: { current: ReturnType<typeof useSessionClient> };
  deliver: (msg: TServerMessage) => void;
} {
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    return { connect: () => {}, disconnect: () => {}, send: () => {} };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  return { result, deliver: (msg) => act(() => onMessage?.(msg)) };
}

describe('#3186 — the GUI conversation timeline', () => {
  it('a command result becomes a command entry in the conversation, not a notice', () => {
    const { result, deliver } = setup();
    deliver({ type: 'command_result', name: 'help', message: 'line 1\nline 2', success: true });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'command', name: 'help', content: 'line 1\nline 2', tone: 'success' }),
    ]);
    expect(result.current.sessionNotices).toEqual([]);
  });

  it('a failed command result is an error-toned entry', () => {
    const { result, deliver } = setup();
    deliver({ type: 'command_result', name: 'cd', message: 'missing capability', success: false });
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'command', tone: 'error' }),
    );
  });

  it('a command result with no text (a skill that starts a turn) adds nothing', () => {
    const { result, deliver } = setup();
    deliver({ type: 'command_result', name: 'parity-demo', message: '', success: true });
    expect(result.current.messages).toEqual([]);
  });

  it('#3282 §4 part b-2: a ui_intent for the plugin manager opens Settings on Plugins, not an info entry', () => {
    const { result, deliver } = setup();
    act(() => result.current.send({ type: 'command', name: 'plugin' }));
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-plugin-manager' } } } as TServerMessage);
    deliver({ type: 'command_result', name: 'plugin', message: 'Opening plugin manager...', success: true });

    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.settingsInitialSectionId).toBe('plugins');
    // The screen opening is the answer — no info line, exactly like `show-settings`.
    expect(result.current.messages).toEqual([]);
  });

  it('#3282 §4a: a ui_intent for settings opens the Settings screen instead of an info entry', () => {
    const { result, deliver } = setup();
    act(() => result.current.send({ type: 'command', name: 'settings' }));
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-settings' } } } as TServerMessage);
    deliver({ type: 'command_result', name: 'settings', message: 'Opening settings...', success: true });

    expect(result.current.settingsOpen).toBe(true);
    // The screen opening is the answer — no info line, exactly like `show-session-picker`.
    expect(result.current.messages).toEqual([]);
  });

  it('#3282 §4 part b-3: a ui_intent for show-agent-switcher opens the sheet instead of an info entry', () => {
    const { result, deliver } = setup();
    act(() => result.current.send({ type: 'command', name: 'agent' }));
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-agent-switcher' } } } as TServerMessage);
    deliver({ type: 'command_result', name: 'agent', message: '', success: true });

    expect(result.current.agentSwitcherOpen).toBe(true);
    // The screen opening is the answer — no info line, exactly like `show-session-picker`/`show-settings`.
    expect(result.current.messages).toEqual([]);
  });

  it('#3186 review: a screen request with no command of ours in flight shows at once', () => {
    const { result, deliver } = setup();
    // A still-genuinely-unsupported intent: every intent with a real GUI screen (session picker,
    // settings, plugin manager, agent switcher) now suppresses the reply's conversation card by
    // design (#3282 §4), so this generic no-command-in-flight test needs one that still does not.
    // A model-run `/theme` asks for the theme picker; no command_result follows on this surface.
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-theme-picker' } } } as TServerMessage);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'command', name: 'theme', tone: 'info' }),
    ]);
    // …and it never replaces the reply of a later, unrelated command.
    act(() => result.current.send({ type: 'command', name: 'help' }));
    deliver({ type: 'command_result', name: 'help', message: 'Available commands', success: true });
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({ name: 'help', content: 'Available commands', tone: 'success' }),
    );
  });

  it('#3186 review: a protocol error in place of the reply still shows the screen request', () => {
    const { result, deliver } = setup();
    act(() => result.current.send({ type: 'command', name: 'agent' }));
    // A still-genuinely-unsupported intent: every intent with a real GUI screen (session picker,
    // settings, plugin manager, agent switcher) now suppresses the reply's conversation card by
    // design (#3282 §4), so this generic in-flight-pairing test needs one that still does not.
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-theme-picker' } } } as TServerMessage);
    deliver({ type: 'protocol_error', message: 'boom' });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'command', name: 'theme', tone: 'info' }),
    ]);
    deliver({ type: 'command_result', name: 'help', message: 'Available commands', success: true });
    expect(result.current.messages.at(-1)).toEqual(expect.objectContaining({ tone: 'success' }));
  });

  it('#3189: a reply that completes before a render is kept, not lost', () => {
    let onMessage: ((msg: TServerMessage) => void) | null = null;
    const makeClient: TMakeSessionClient = (callbacks) => {
      onMessage = callbacks.onMessage;
      return { connect: () => {}, disconnect: () => {}, send: () => {} };
    };
    const { result } = renderHook(() => useSessionClient(makeClient));
    // Both frames in one batch: React has not rendered between them.
    act(() => {
      onMessage?.({ type: 'text_delta', delta: 'Hel' });
      onMessage?.({ type: 'text_delta', delta: 'lo' });
      onMessage?.({ type: 'complete', result: { response: 'Hello' } } as TServerMessage);
    });
    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'Hello' }),
    );
  });

  it('#3280 §2: an interrupted (stopped) turn keeps its partial reply, not just a completed one', () => {
    const { result, deliver } = setup();
    deliver({ type: 'text_delta', delta: 'partial resu' });
    deliver({ type: 'interrupted', result: { response: 'partial resu' } } as TServerMessage);

    expect(result.current.messages.at(-1)).toEqual(
      expect.objectContaining({ role: 'assistant', content: 'partial resu' }),
    );
    expect(result.current.streamingText).toBe('');
    expect(result.current.isThinking).toBe(false);
  });

  it("a finished turn keeps its tool calls in the conversation, before the agent's reply", () => {
    const { result, deliver } = setup();
    deliver({ type: 'user_message', content: 'read it' });
    deliver({ type: 'tool_start', state: { toolName: 'Read', isRunning: true, firstArg: 'a.ts' } } as TServerMessage);
    deliver({ type: 'tool_end', state: { toolName: 'Read', isRunning: false } } as TServerMessage);
    deliver({ type: 'text_delta', delta: 'done' });
    deliver({ type: 'complete', result: { response: 'done' } } as TServerMessage);

    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'tools', 'assistant']);
    expect(result.current.messages[1]).toEqual(
      expect.objectContaining({
        tools: [expect.objectContaining({ name: 'Read', input: 'a.ts', status: 'done' })],
      }),
    );
    expect(result.current.activeTools).toEqual([]);
  });

  it('#3288: two parallel same-named calls are attributed by executionId, not the first running one', () => {
    const { result, deliver } = setup();
    deliver({
      type: 'tool_start',
      state: { toolName: 'Read', isRunning: true, firstArg: 'a.ts', executionId: 'exec-a' },
    } as TServerMessage);
    deliver({
      type: 'tool_start',
      state: { toolName: 'Read', isRunning: true, firstArg: 'b.ts', executionId: 'exec-b' },
    } as TServerMessage);
    // exec-a (started FIRST) finishes first, while exec-b is still running. Matching by
    // "first running entry with this name" would wrongly close exec-b's entry instead.
    deliver({
      type: 'tool_end',
      state: {
        toolName: 'Read',
        isRunning: false,
        firstArg: 'a.ts',
        result: 'success',
        executionId: 'exec-a',
      },
    } as TServerMessage);

    const a = result.current.activeTools.find((t) => t.executionId === 'exec-a');
    const b = result.current.activeTools.find((t) => t.executionId === 'exec-b');
    expect(a?.status).toBe('done');
    expect(b?.status).toBe('running');
  });

  it('#3288: tool_end carries the diff, output, and executionId onto the conversation entry', () => {
    const { result, deliver } = setup();
    deliver({ type: 'user_message', content: 'edit it' });
    deliver({
      type: 'tool_start',
      state: { toolName: 'Edit', isRunning: true, firstArg: 'a.ts', executionId: 'exec-1' },
    } as TServerMessage);
    deliver({
      type: 'tool_end',
      state: {
        toolName: 'Edit',
        isRunning: false,
        firstArg: 'a.ts',
        result: 'success',
        executionId: 'exec-1',
        toolResultData: 'wrote 3 lines',
        diffFile: 'src/a.ts',
        diffLines: [{ type: 'add', text: 'x', lineNumber: 1 }],
      },
    } as TServerMessage);
    deliver({ type: 'complete', result: { response: '' } } as TServerMessage);

    const toolsEntry = result.current.messages.find((m) => m.role === 'tools');
    expect(toolsEntry).toEqual(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            executionId: 'exec-1',
            toolResultData: 'wrote 3 lines',
            diffFile: 'src/a.ts',
            diffLines: [{ type: 'add', text: 'x', lineNumber: 1 }],
          }),
        ],
      }),
    );
  });

  it("#3288: a finished turn keeps tool calls where they happened relative to the text, not grouped before all of it", () => {
    const { result, deliver } = setup();
    deliver({ type: 'user_message', content: 'go' });
    deliver({ type: 'text_delta', delta: 'checking first' });
    deliver({
      type: 'tool_start',
      state: { toolName: 'Read', isRunning: true, firstArg: 'a.ts' },
    } as TServerMessage);
    deliver({
      type: 'tool_end',
      state: { toolName: 'Read', isRunning: false, firstArg: 'a.ts', result: 'success' },
    } as TServerMessage);
    deliver({ type: 'text_delta', delta: 'done now' });
    deliver({ type: 'complete', result: { response: 'checking firstdone now' } } as TServerMessage);

    expect(result.current.messages.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tools',
      'assistant',
    ]);
    expect(result.current.messages[1]).toEqual(
      expect.objectContaining({ content: 'checking first' }),
    );
    expect(result.current.messages[3]).toEqual(expect.objectContaining({ content: 'done now' }));
  });

  it('#3288: a turn that changed files ends with a Changed files summary row', () => {
    const { result, deliver } = setup();
    deliver({ type: 'user_message', content: 'fix it' });
    deliver({
      type: 'tool_start',
      state: { toolName: 'Edit', isRunning: true, firstArg: 'a.ts' },
    } as TServerMessage);
    deliver({
      type: 'tool_end',
      state: {
        toolName: 'Edit',
        isRunning: false,
        firstArg: 'a.ts',
        result: 'success',
        diffFile: 'src/a.ts',
        diffLines: [
          { type: 'add', text: 'x', lineNumber: 1 },
          { type: 'add', text: 'y', lineNumber: 2 },
          { type: 'remove', text: 'z', lineNumber: 1 },
        ],
      },
    } as TServerMessage);
    deliver({ type: 'complete', result: { response: '' } } as TServerMessage);

    expect(result.current.messages.map((m) => m.role)).toEqual(['user', 'tools', 'changed-files']);
    expect(result.current.messages[2]).toEqual(
      expect.objectContaining({
        files: [{ path: 'src/a.ts', added: 2, removed: 1, diffLines: expect.any(Array) }],
      }),
    );
  });

  it('#3288: a turn with no file changes has no Changed files row', () => {
    const { result, deliver } = setup();
    deliver({ type: 'user_message', content: 'read it' });
    deliver({
      type: 'tool_start',
      state: { toolName: 'Read', isRunning: true, firstArg: 'a.ts' },
    } as TServerMessage);
    deliver({
      type: 'tool_end',
      state: { toolName: 'Read', isRunning: false, firstArg: 'a.ts', result: 'success' },
    } as TServerMessage);
    deliver({ type: 'complete', result: { response: '' } } as TServerMessage);

    expect(result.current.messages.some((m) => m.role === 'changed-files')).toBe(false);
  });
});

describe('#3186 — commands and status for the composer', () => {
  function connectedSetup(): {
    result: { current: ReturnType<typeof useSessionClient> };
    deliver: (msg: TServerMessage) => void;
    wire: unknown[];
    connect: () => void;
  } {
    let onMessage: ((msg: TServerMessage) => void) | null = null;
    let onStatus: ((status: 'connected') => void) | null = null;
    const wire: unknown[] = [];
    const makeClient: TMakeSessionClient = (callbacks) => {
      onMessage = callbacks.onMessage;
      onStatus = callbacks.onStatusChange as (status: 'connected') => void;
      return { connect: () => {}, disconnect: () => {}, send: (m) => wire.push(m) };
    };
    const { result } = renderHook(() => useSessionClient(makeClient));
    return {
      result,
      wire,
      deliver: (msg) => act(() => onMessage?.(msg)),
      connect: () => act(() => onStatus?.('connected')),
    };
  }

  it('asks for the commands and the status once connected, and holds what arrives', () => {
    const { result, wire, deliver, connect } = connectedSetup();
    connect();
    expect(wire).toEqual(
      expect.arrayContaining([{ type: 'get-commands' }, { type: 'get-status' }]),
    );
    deliver({
      type: 'commands',
      commands: [{ name: 'help', description: 'Show commands', modelInvocable: false, runner: 'runtime' }],
      skills: [
        { name: 'demo', description: 'Demo', source: 'project', modelInvocable: true, userInvocable: true },
      ],
    });
    const status = {
      sessionId: 's',
      model: 'm',
      permissionMode: 'default',
      effort: 'auto',
      context: { usedPercentage: 3, usedTokens: 3, maxTokens: 100, remainingPercentage: 97 },
      goal: null,
    } as const;
    deliver({ type: 'session_status', status });
    expect(result.current.commandCatalog?.commands.map((c) => c.name)).toEqual(['help']);
    expect(result.current.commandCatalog?.skills.map((s) => s.name)).toEqual(['demo']);
    expect(result.current.sessionStatus).toEqual(status);
  });

  it('#3280 §2: a (re)connect also asks for the queue, so a reconnect to the same session refreshes it', () => {
    const { wire, connect } = connectedSetup();
    connect();
    expect(wire.filter((m) => (m as { type: string }).type === 'get-pending')).toHaveLength(1);
    // A drop and reconnect to the SAME session fires no `session_switched` — the connect handler's
    // own `get-pending` is the only thing that refreshes a `queuedPrompt` left over from before it.
    connect();
    expect(wire.filter((m) => (m as { type: string }).type === 'get-pending')).toHaveLength(2);
  });

  it('#3186 review: a reconnect forgets a command whose reply was lost with the connection', () => {
    const { result, deliver, connect } = connectedSetup();
    act(() => result.current.send({ type: 'command', name: 'settings' }));
    connect();
    // A still-genuinely-unsupported intent: every intent with a real GUI screen (session picker,
    // settings, plugin manager, agent switcher) now suppresses the reply's conversation card by
    // design (#3282 §4), so this generic no-command-in-flight (post-reconnect) test needs one that
    // still does not.
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-theme-picker' } } } as TServerMessage);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'command', name: 'theme', tone: 'info' }),
    ]);
  });

  it('refreshes the status after a command or a turn changes it', () => {
    const { wire, deliver } = connectedSetup();
    deliver({ type: 'command_result', name: 'mode', message: 'Mode set.', success: true });
    deliver({ type: 'complete', result: { response: '' } } as TServerMessage);
    expect(wire.filter((m) => (m as { type: string }).type === 'get-status')).toHaveLength(2);
    expect(wire).toContainEqual({ type: 'get-commands' });
  });

  it('#3280 §2: a finished turn (complete or interrupted) re-asks for the queue', () => {
    const { wire, deliver } = connectedSetup();
    deliver({ type: 'complete', result: { response: '' } } as TServerMessage);
    deliver({ type: 'interrupted', result: { response: '' } } as TServerMessage);
    expect(wire.filter((m) => (m as { type: string }).type === 'get-pending')).toHaveLength(2);
  });

  it('#3282 §4 part b-3: fetches the schedule roster once connected', () => {
    const { wire, connect } = connectedSetup();
    connect();
    expect(wire).toContainEqual({
      type: 'get-background-tasks',
      filter: { kind: 'scheduled' },
    });
  });
});

describe('#3282 §4 part b-3 — the agent switcher sheet', () => {
  function setupWithWire(): {
    result: { current: ReturnType<typeof useSessionClient> };
    deliver: (msg: TServerMessage) => void;
    wire: TClientMessage[];
  } {
    let onMessage: ((msg: TServerMessage) => void) | null = null;
    const wire: TClientMessage[] = [];
    const makeClient: TMakeSessionClient = (callbacks) => {
      onMessage = callbacks.onMessage;
      return { connect: () => {}, disconnect: () => {}, send: (m) => wire.push(m) };
    };
    const { result } = renderHook(() => useSessionClient(makeClient));
    return { result, wire, deliver: (msg) => act(() => onMessage?.(msg)) };
  }

  function lastAgentDefinitionsRequestId(wire: readonly TClientMessage[]): string {
    const request = [...wire]
      .reverse()
      .find((m): m is Extract<TClientMessage, { type: 'get-agent-definitions' }> =>
        m.type === 'get-agent-definitions',
      );
    if (!request) throw new Error('no get-agent-definitions request was sent');
    return request.requestId;
  }

  it('opening fetches the roster, and the reply fills the sheet', () => {
    const { result, deliver, wire } = setupWithWire();
    act(() => result.current.openAgentSwitcher());
    expect(result.current.agentSwitcherOpen).toBe(true);
    expect(result.current.agentSwitcherStatus).toBe('loading');

    const agents = [
      { name: 'general-purpose', description: 'General-purpose agent.', definedIn: 'Built-in' },
      { name: 'Explore', description: 'Read-only exploration agent.', definedIn: 'Built-in' },
    ];
    deliver({
      type: 'agent_definitions',
      requestId: lastAgentDefinitionsRequestId(wire),
      agents,
      current: 'Explore',
    } as TServerMessage);

    expect(result.current.agentDefinitions).toEqual(agents);
    expect(result.current.currentAgentType).toBe('Explore');
    expect(result.current.agentSwitcherStatus).toBe('ready');
  });

  it('closing hides the sheet without losing the roster', () => {
    const { result, deliver, wire } = setupWithWire();
    act(() => result.current.openAgentSwitcher());
    deliver({
      type: 'agent_definitions',
      requestId: lastAgentDefinitionsRequestId(wire),
      agents: [],
      current: 'general-purpose',
    } as TServerMessage);
    act(() => result.current.closeAgentSwitcher());
    expect(result.current.agentSwitcherOpen).toBe(false);
    expect(result.current.currentAgentType).toBe('general-purpose');
  });

  it('choosing an agent sends the same command `/agent <name>` runs, and its reply is a plain confirmation — never a conversation card', () => {
    const { result, deliver, wire } = setupWithWire();

    act(() => result.current.selectAgent('Explore'));
    const sentCommand = wire.find(
      (m): m is Extract<TClientMessage, { type: 'command' }> =>
        m.type === 'command' && m.name === 'agent',
    );
    expect(sentCommand).toEqual(
      expect.objectContaining({ type: 'command', name: 'agent', args: 'Explore' }),
    );

    deliver({
      type: 'command_result',
      name: 'agent',
      message: 'Default agent: Explore',
      success: true,
      data: { agentType: 'Explore' },
      requestId: sentCommand!.requestId,
    } as TServerMessage);

    // The sheet's own state carries the confirmation…
    expect(result.current.agentSwitchMessage).toBe('Default agent: Explore');
    // …and no conversation card was added for it.
    expect(result.current.messages.filter((m) => m.role === 'command' && m.name === 'agent')).toEqual(
      [],
    );
  });
});

describe('#3282 §4 part b-3 — schedules in the Agents panel', () => {
  const schedule = {
    id: 'sched_1',
    kind: 'scheduled' as const,
    label: 'Scheduled: check the build',
    status: 'sleeping' as const,
    mode: 'background' as const,
    parentSessionId: 'session-1',
    depth: 0,
    cwd: '/repo',
    updatedAt: '2026-05-01T00:00:00.000Z',
    unread: false,
    nextFireAt: '2026-05-02T09:00:00.000Z',
    schedule: { cronExpression: '0 9 * * *', agentInstruction: 'check the build' },
  };

  function setupWithWire(): {
    result: { current: ReturnType<typeof useSessionClient> };
    deliver: (msg: TServerMessage) => void;
    wire: TClientMessage[];
  } {
    let onMessage: ((msg: TServerMessage) => void) | null = null;
    const wire: TClientMessage[] = [];
    const makeClient: TMakeSessionClient = (callbacks) => {
      onMessage = callbacks.onMessage;
      return { connect: () => {}, disconnect: () => {}, send: (m) => wire.push(m) };
    };
    const { result } = renderHook(() => useSessionClient(makeClient));
    return { result, wire, deliver: (msg) => act(() => onMessage?.(msg)) };
  }

  it('a `background_tasks` reply fills the Scheduled roster', () => {
    const { result, deliver } = setup();
    deliver({ type: 'background_tasks', tasks: [schedule] } as TServerMessage);
    expect(result.current.scheduledTasks).toEqual([schedule]);
  });

  it('pause/resume run the same command `/schedule pause|resume <id>` runs', () => {
    const { result, wire } = setupWithWire();

    act(() => result.current.pauseSchedule('sched_1'));
    expect(wire).toContainEqual({ type: 'command', name: 'schedule', args: 'pause sched_1' });

    act(() => result.current.resumeSchedule('sched_1'));
    expect(wire).toContainEqual({ type: 'command', name: 'schedule', args: 'resume sched_1' });
  });

  it('delete sends the same `cancel-background-task` write Stop already uses', () => {
    const { result, wire } = setupWithWire();

    act(() => result.current.deleteSchedule('sched_1'));
    expect(wire).toContainEqual({ type: 'cancel-background-task', taskId: 'sched_1' });
  });

  it('a successful schedule pause/resume command result refreshes the roster', () => {
    const { deliver, wire } = setupWithWire();

    wire.length = 0;
    deliver({
      type: 'command_result',
      name: 'schedule',
      message: 'Schedule paused: sched_1',
      success: true,
    });
    expect(wire).toContainEqual({ type: 'get-background-tasks', filter: { kind: 'scheduled' } });
  });

  it('a successful schedule delete (cancel) refreshes the roster', () => {
    const { deliver, wire } = setupWithWire();

    wire.length = 0;
    deliver({
      type: 'background_task_control_result',
      action: 'cancel',
      taskId: 'sched_1',
      success: true,
    });
    expect(wire).toContainEqual({ type: 'get-background-tasks', filter: { kind: 'scheduled' } });
  });

  it("a failed schedule delete carries its plain message as a session notice — Delete has no conversation card", () => {
    // #3288 §1's `background-task-control-failed` notice already covers every failed
    // `cancel-background-task`, including a schedule's Delete — no separate error state here.
    const { result, deliver } = setup();
    deliver({
      type: 'background_task_control_result',
      action: 'cancel',
      taskId: 'sched_1',
      success: false,
      message: 'Unknown background task: sched_1',
    });
    expect(result.current.sessionNotices).toContainEqual(
      expect.objectContaining({
        kind: 'background-task-control-failed',
        message: 'Unknown background task: sched_1',
      }),
    );
  });
});
