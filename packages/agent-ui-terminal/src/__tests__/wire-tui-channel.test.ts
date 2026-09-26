import { describe, expect, it, vi } from 'vitest';

import { WireTuiChannel } from '../wire-tui-channel.js';

import type { IAttachedSessionConnection } from '../attached-session-connection.js';
import type { ITuiClientCommand, ITuiClientCommands } from '../wire-tui-client-commands.js';
import type { TAttachedSessionEnd } from '../attached-session-connection.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { ISessionStatusSnapshot, IUiIntentEvent } from '@robota-sdk/agent-interface-session';
import type {
  IWireHistoryEntry,
  TClientMessage,
  TServerMessage,
} from '@robota-sdk/agent-transport/client';

interface IScriptedConnection extends IAttachedSessionConnection {
  readonly sent: TClientMessage[];
  push(message: TServerMessage): void;
  close(): void;
  readonly listenerCount: () => number;
  /** From now on `send` throws, as a connection that broke does. */
  failSends(): void;
}

function scriptedConnection(): IScriptedConnection {
  const listeners = new Set<(message: TServerMessage) => void>();
  const closers = new Set<() => void>();
  const sent: TClientMessage[] = [];
  let failing = false;
  return {
    sent,
    send: (message) => {
      if (failing) throw new Error('socket closed');
      sent.push(message);
    },
    failSends: () => {
      failing = true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onClose: (listener) => {
      closers.add(listener);
      return () => closers.delete(listener);
    },
    push: (message) => {
      for (const listener of [...listeners]) listener(message);
    },
    close: () => {
      for (const closer of [...closers]) closer();
    },
    listenerCount: () => listeners.size,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const SNAPSHOT_TYPES = [
  'get-history',
  'get-context',
  'get-commands',
  'get-status',
  'get-executing',
  'get-pending',
  'get-execution-workspace',
  'get-prompts',
  'list-sessions',
];

async function attached(options: { onEnd?: (reason: TAttachedSessionEnd) => void } = {}): Promise<{
  channel: WireTuiChannel;
  link: IScriptedConnection;
}> {
  const link = scriptedConnection();
  const channel = new WireTuiChannel({
    connection: link,
    driverId: 'attach:1',
    sessionName: 'daemon',
    ...(options.onEnd ? { onEnd: options.onEnd } : {}),
  });
  await channel.start();
  return { channel, link };
}

/** A page of the host's history: `entries` from `startIndex`, of `total` entries in all. */
function page(
  entries: IWireHistoryEntry[],
  startIndex = 0,
  total = startIndex + entries.length,
): Extract<TServerMessage, { type: 'history' }> {
  return { type: 'history', startIndex, total, entries };
}

/** Answer the attach-time history request so the next one is sent, not queued behind it. */
function answerHistory(link: IScriptedConnection): void {
  link.push(page([]));
}

const LATER = (): string => new Date(Date.now() + 60_000).toISOString();

function chat(id: string, role: 'user' | 'assistant', content: string): IWireHistoryEntry {
  return {
    id,
    timestamp: LATER(),
    category: 'chat',
    type: role,
    data: { id: `m-${id}`, role, content, state: 'complete', timestamp: LATER() },
  };
}

function contents(history: readonly IHistoryEntry[]): unknown[] {
  return history.map((entry) => (entry.data as { content?: unknown } | undefined)?.content);
}

/**
 * What the terminal prints: the transcript is committed once, and only the items past the count
 * already printed are printed on each render (Ink `<Static>`); a new generation prints from the start.
 */
function printer(channel: WireTuiChannel): { render: () => void; printed: unknown[] } {
  const printed: unknown[] = [];
  let count = 0;
  let generation: number | undefined;
  return {
    printed,
    render: () => {
      const snapshot = channel.getSnapshot();
      if (snapshot.transcriptGeneration !== generation) {
        generation = snapshot.transcriptGeneration;
        count = 0;
      }
      printed.push(...contents(snapshot.history.slice(count)));
      count = snapshot.history.length;
    },
  };
}

/** A turn's result as the host sends it. */
function completed(response: string): TServerMessage {
  return {
    type: 'complete',
    result: {
      response,
      toolSummaries: [],
      contextState: { usedTokens: 1, maxTokens: 10, usedPercentage: 10 } as never,
    },
  };
}

function historyRequests(sent: readonly TClientMessage[]): TClientMessage[] {
  return sent.filter((message) => message.type === 'get-history');
}

function lastCommandRequestId(sent: readonly TClientMessage[]): string {
  const commands = sent.filter(
    (message): message is Extract<TClientMessage, { type: 'command' }> =>
      message.type === 'command',
  );
  return commands.at(-1)?.requestId ?? '';
}

function status(overrides: Partial<ISessionStatusSnapshot> = {}): ISessionStatusSnapshot {
  return {
    sessionId: 'session_0123456789ab',
    model: 'claude-test',
    permissionMode: 'acceptEdits',
    effort: 'high',
    context: { usedTokens: 10, maxTokens: 100, usedPercentage: 10 } as never,
    goal: null,
    ...overrides,
  };
}

function types(sent: readonly TClientMessage[]): string[] {
  return sent.map((message) => message.type);
}

function lastListRequestId(sent: readonly TClientMessage[]): string {
  const requests = sent.filter(
    (message): message is Extract<TClientMessage, { type: 'list-sessions' }> =>
      message.type === 'list-sessions',
  );
  return requests.at(-1)?.requestId ?? '';
}

describe('WireTuiChannel', () => {
  it('asks the host for everything the full TUI shows when it starts', async () => {
    const { link } = await attached();
    expect(types(link.sent)).toEqual(SNAPSHOT_TYPES);
    const list = link.sent.find((message) => message.type === 'list-sessions');
    expect(list).toMatchObject({ type: 'list-sessions', requestId: expect.any(String) });
  });

  it('projects streamed turn frames into the snapshot and re-reads history on complete', async () => {
    const { channel, link } = await attached();
    answerHistory(link);
    link.sent.length = 0;

    link.push({ type: 'thinking', isThinking: true });
    link.push({ type: 'text_delta', delta: 'Hello ' });
    link.push({ type: 'text_delta', delta: 'there' });
    link.push({
      type: 'tool_start',
      state: { toolName: 'Bash', firstArg: 'ls', isRunning: true },
    });
    let snapshot = channel.getSnapshot();
    expect(snapshot.isThinking).toBe(true);
    expect(snapshot.streamingText).toBe('Hello there');
    expect(snapshot.activeTools).toEqual([{ toolName: 'Bash', firstArg: 'ls', isRunning: true }]);

    link.push({
      type: 'complete',
      result: {
        response: 'Hello there',
        history: [],
        toolSummaries: [],
        contextState: { usedTokens: 50, maxTokens: 200, usedPercentage: 25 },
      } as never,
    });
    snapshot = channel.getSnapshot();
    expect(snapshot.streamingText).toBe('');
    expect(snapshot.activeTools).toEqual([]);
    expect(snapshot.contextState).toEqual({ percentage: 25, usedTokens: 50, maxTokens: 200 });
    // Only what came after the entries known is read: none are known yet.
    expect(historyRequests(link.sent)).toEqual([{ type: 'get-history' }]);
    await channel.stop();
  });

  it('keeps one history request in flight and one queued behind it', async () => {
    const { channel, link } = await attached();
    link.sent.length = 0;
    link.push({ type: 'history_changed' });
    link.push({ type: 'history_changed' });
    link.push({ type: 'history_changed' });
    // The attach-time request is still unanswered: the rest wait behind it as one.
    expect(types(link.sent)).toEqual([]);
    answerHistory(link);
    expect(types(link.sent)).toEqual(['get-history']);
    answerHistory(link);
    expect(types(link.sent)).toEqual(['get-history']);
    await channel.stop();
  });

  it('syncs history frames with Date timestamps, inside chat entries too', async () => {
    const { channel, link } = await attached();
    const at = LATER();
    const prompt = (id: string, content: string, driverId: string, timestamp = at) => ({
      id,
      timestamp,
      category: 'chat',
      type: 'user',
      data: {
        id: `m-${id}`,
        role: 'user',
        content,
        state: 'complete',
        timestamp,
        metadata: { driverId },
      },
    });
    const before = '2026-01-01T00:00:00.000Z';
    link.push(
      page([
        prompt('e1', 'mine', 'attach:1'),
        prompt('e2', 'theirs', 'attach:2'),
        // The host numbered another terminal attach:1 before it last started.
        prompt('e3', 'older', 'attach:1', before),
        {
          id: 'e4',
          timestamp: at,
          category: 'event',
          type: 'skill-activation',
          data: { name: 'review', timestamp: at },
        },
      ]),
    );
    const [mine, theirs, older, event] = channel.getSnapshot().history;
    expect(mine?.timestamp).toBeInstanceOf(Date);
    expect(mine?.timestamp.toISOString()).toBe(at);
    const mineData = mine?.data as { timestamp: unknown; metadata: { driverId: string } };
    expect(mineData.timestamp).toBeInstanceOf(Date);
    // This terminal's own prompts read as the user's; another client's keep their driver.
    expect(mineData.metadata.driverId).toBe('owner');
    expect((theirs?.data as { metadata: { driverId: string } }).metadata.driverId).toBe('attach:2');
    // A prompt from before this terminal attached is not this terminal's, whatever its driver id.
    expect((older?.data as { metadata: { driverId: string } }).metadata.driverId).toBe('attach:1');
    // An event entry's data is the event as recorded: its timestamp stays the string it was.
    expect(event?.timestamp).toBeInstanceOf(Date);
    expect(event?.data).toEqual({ name: 'review', timestamp: at });
    await channel.stop();
  });

  it('shows a permission request and sends the answer as permission-response', async () => {
    const { channel, link } = await attached();
    link.sent.length = 0;
    link.push({
      type: 'permission_request',
      event: { id: 'p1', toolName: 'Bash', toolArgs: { command: 'ls' } },
    });
    const request = channel.getSnapshot().permissionRequest;
    expect(request).toMatchObject({ toolName: 'Bash', toolArgs: { command: 'ls' } });
    request?.resolve('allow-session');
    await flush();
    expect(link.sent).toEqual([{ type: 'permission-response', id: 'p1', result: 'allow-session' }]);
    expect(channel.getSnapshot().permissionRequest).toBeNull();
    await channel.stop();
  });

  it('answers an ask through resolveUserAction as ask-response', async () => {
    const { channel, link } = await attached();
    link.sent.length = 0;
    link.push({
      type: 'ask_request',
      event: { id: 'a1', request: { kind: 'text', title: 'Name?' } as never },
    });
    const pending = channel.getSnapshot().pendingUserAction;
    expect(pending).toMatchObject({ title: 'Name?' });
    channel.resolveUserAction(pending!, { type: 'answer', values: [], text: 'Robota' });
    await flush();
    expect(link.sent).toEqual([
      {
        type: 'ask-response',
        id: 'a1',
        response: { type: 'answer', values: [], text: 'Robota' },
      },
    ]);
    await channel.stop();
  });

  it('takes a question another client answered off the screen without answering it', async () => {
    const { channel, link } = await attached();
    link.sent.length = 0;
    link.push({
      type: 'permission_request',
      event: { id: 'p1', toolName: 'Bash', toolArgs: {} },
    });
    link.push({ type: 'prompt_resolved', event: { id: 'p1', answererDriverId: 'attach:2' } });
    await flush();
    expect(channel.getSnapshot().permissionRequest).toBeNull();
    expect(link.sent).toEqual([]);
    await channel.stop();
  });

  it('sends plain input as submit and a slash command as command', async () => {
    const { channel, link } = await attached();
    link.sent.length = 0;
    await channel.handleInput('hello');
    // The host answers a submit with its queue once it has taken the prompt.
    expect(link.sent).toEqual([{ type: 'submit', prompt: 'hello' }]);

    link.sent.length = 0;
    let settled = false;
    const command = channel.handleInput('/Help me').then(() => {
      settled = true;
    });
    expect(link.sent).toEqual([
      { type: 'command', name: 'help', args: 'me', requestId: expect.any(String) },
    ]);
    await flush();
    // The command is on screen only once the host answers.
    expect(settled).toBe(false);
    link.push({
      type: 'command_result',
      name: 'help',
      message: 'Available commands',
      success: true,
      requestId: lastCommandRequestId(link.sent),
    });
    await command;
    const last = channel.getSnapshot().history.at(-1);
    expect(last?.data).toMatchObject({ role: 'system', content: 'Available commands' });
    // The host may have changed the status, context or catalog.
    expect(types(link.sent)).toEqual(
      expect.arrayContaining(['get-context', 'get-status', 'get-commands']),
    );
    await channel.stop();
  });

  it('offers the host commands and user-invocable skills to the / menu', async () => {
    const { channel, link } = await attached();
    link.push({
      type: 'commands',
      commands: [{ name: 'help', description: 'Help', modelInvocable: false, runner: 'runtime' }],
      skills: [
        {
          name: 'hello',
          description: 'Greets',
          source: 'skill',
          modelInvocable: true,
          userInvocable: true,
        },
        {
          name: 'hidden',
          description: 'Model only',
          source: 'skill',
          modelInvocable: true,
          userInvocable: false,
        },
      ],
    });
    const port = channel.getCommandQueryPort();
    expect(port.getCommands().map((command) => command.name)).toEqual(['help', 'hello']);
    expect(port.getCommands('he').map((command) => command.name)).toEqual(['help', 'hello']);
    expect(port.getSubcommands('help')).toEqual([]);
    await channel.stop();
  });

  it("completes a host command's subcommands and argument hint from the catalog", async () => {
    const { channel, link } = await attached();
    link.push({
      type: 'commands',
      commands: [
        {
          name: 'loop',
          description: 'Loops',
          modelInvocable: false,
          runner: 'runtime',
          argumentHint: '<interval> <prompt>',
          subcommands: [
            { name: 'list', description: 'List loops' },
            { name: 'stop', description: 'Stop a loop', argumentHint: '<id>', displayName: 'Stop' },
          ],
        },
      ],
      skills: [],
    });
    const port = channel.getCommandQueryPort();
    expect(port.getCommands()[0]).toMatchObject({ argumentHint: '<interval> <prompt>' });
    expect(port.getSubcommands('LOOP')).toEqual([
      { name: 'list', description: 'List loops', source: 'builtin' },
      {
        name: 'stop',
        description: 'Stop a loop',
        source: 'builtin',
        displayName: 'Stop',
        argumentHint: '<id>',
      },
    ]);
    await channel.stop();
  });

  it('leaves on /exit without sending anything to the session', async () => {
    const onEnd = vi.fn();
    const { channel, link } = await attached({ onEnd });
    link.sent.length = 0;
    await channel.handleInput('/exit');
    expect(link.sent).toEqual([]);
    expect(onEnd).toHaveBeenCalledWith('user');
    await channel.stop();
  });

  it('stop() and shutdown() only detach: nothing is sent and an open question is left open', async () => {
    const { channel, link } = await attached();
    link.push({
      type: 'permission_request',
      event: { id: 'p1', toolName: 'Bash', toolArgs: {} },
    });
    link.sent.length = 0;
    await channel.shutdown({ reason: 'prompt_input_exit' });
    await channel.stop();
    await flush();
    expect(link.sent).toEqual([]);
    expect(link.listenerCount()).toBe(0);
    link.push({ type: 'text_delta', delta: 'ignored' });
    expect(channel.getSnapshot().streamingText).toBe('');
  });

  it('resets and asks again for everything when the host switches sessions', async () => {
    const { channel, link } = await attached();
    answerHistory(link);
    link.push({ type: 'history_changed' });
    link.push(
      page([
        {
          id: 'old',
          timestamp: '2026-09-26T10:00:00.000Z',
          category: 'chat',
          type: 'user',
          data: { id: 'm', role: 'user', content: 'old session', state: 'complete' },
        },
      ]),
    );
    link.push({ type: 'text_delta', delta: 'streaming' });
    link.push({
      type: 'permission_request',
      event: { id: 'p1', toolName: 'Bash', toolArgs: {} },
    });
    link.sent.length = 0;

    link.push({ type: 'session_switched', event: { sessionId: 'session-2' } });
    await flush();
    const snapshot = channel.getSnapshot();
    expect(snapshot.history.some((entry) => entry.id === 'old')).toBe(false);
    expect(snapshot.streamingText).toBe('');
    expect(snapshot.permissionRequest).toBeNull();
    // The old session's question is not answered from here; the new session is read from scratch.
    expect(link.sent.some((message) => message.type === 'permission-response')).toBe(false);
    expect(types(link.sent)).toEqual(SNAPSHOT_TYPES);
    // The switch is announced at the top of the new session's transcript.
    link.push(page([]));
    expect(channel.getSnapshot().history.map((entry) => entry.data)).toEqual([
      expect.objectContaining({ content: 'Switched to session session-2.' }),
    ]);
    await channel.stop();
  });

  it('asks the host to switch sessions and lists its sessions for the picker', async () => {
    const { channel, link } = await attached();
    const list = link.sent.find((message) => message.type === 'list-sessions');
    const requestId = list?.type === 'list-sessions' ? list.requestId : '';
    link.push({
      type: 'sessions',
      requestId,
      listing: {
        currentSessionId: 's1',
        sessions: [
          {
            id: 's2',
            cwd: '/w',
            updatedAt: '2026-09-26T10:00:00.000Z',
            messageCount: 2,
            preview: 'hi',
          },
        ],
        unreadableSessionIds: [],
      },
    });
    expect(channel.getSnapshot().hostSessions?.map((session) => session.id)).toEqual(['s2']);
    link.sent.length = 0;
    const switched = channel.requestSessionSwitch('s2');
    expect(link.sent).toEqual([
      { type: 'switch-session', sessionId: 's2', requestId: expect.any(String) },
    ]);
    // The picker's switch settles on the host's answer.
    link.push({ type: 'session_switched', event: { sessionId: 's2' } });
    await switched;
    await channel.stop();
  });

  it("opens the session picker on the host's answer to the listing it asked for", async () => {
    const { channel, link } = await attached();
    const intents: IUiIntentEvent[] = [];
    channel.getSessionUiEventPort().on('ui_intent', (event) => intents.push(event));
    link.push({
      type: 'sessions',
      requestId: lastListRequestId(link.sent),
      listing: { currentSessionId: 's1', sessions: [], unreadableSessionIds: [] },
    });
    link.sent.length = 0;

    link.push({
      type: 'ui_intent',
      event: { intent: { type: 'show-session-picker' }, requesterDriverId: 'attach:1' },
    });
    // What the terminal held since it attached is not what the host has now.
    expect(intents).toEqual([]);
    link.push({
      type: 'sessions',
      requestId: lastListRequestId(link.sent),
      listing: {
        currentSessionId: 's1',
        sessions: [
          {
            id: 's1',
            cwd: '/w',
            updatedAt: '2026-09-26T10:00:00.000Z',
            messageCount: 0,
            preview: '',
          },
          {
            id: 's2',
            cwd: '/w',
            updatedAt: '2026-09-26T09:00:00.000Z',
            messageCount: 2,
            preview: 'hi',
          },
        ],
        unreadableSessionIds: [],
      },
    });
    expect(channel.getSnapshot().hostSessions?.map((session) => session.id)).toEqual(['s1', 's2']);
    expect(intents).toEqual([
      { intent: { type: 'show-session-picker' }, requesterDriverId: 'owner' },
    ]);
    await channel.stop();
  });

  it('opens no session picker when the host cannot list its sessions, and says why', async () => {
    const { channel, link } = await attached();
    const intents: IUiIntentEvent[] = [];
    channel.getSessionUiEventPort().on('ui_intent', (event) => intents.push(event));
    link.sent.length = 0;

    link.push({
      type: 'ui_intent',
      event: { intent: { type: 'show-session-picker' }, requesterDriverId: 'attach:1' },
    });
    link.push({
      type: 'sessions_error',
      requestId: lastListRequestId(link.sent),
      code: 'not_available',
      message: 'Session listing is not available on this host.',
    });
    expect(intents).toEqual([]);
    expect(channel.getSnapshot().hostSessions).toBeUndefined();
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: 'Session listing is not available on this host.',
    });
    await channel.stop();
  });

  it('hands this terminal its own UI intents and names the screens it cannot show', async () => {
    const { channel, link } = await attached();
    const intents: IUiIntentEvent[] = [];
    channel.getSessionUiEventPort().on('ui_intent', (event) => intents.push(event));
    link.push({
      type: 'ui_intent',
      event: { intent: { type: 'show-theme-picker' }, requesterDriverId: 'attach:1' },
    });
    link.push({
      type: 'ui_intent',
      event: { intent: { type: 'show-plugin-manager' }, requesterDriverId: 'attach:1' },
    });
    expect(intents).toEqual([
      { intent: { type: 'show-theme-picker' }, requesterDriverId: 'owner' },
    ]);
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: expect.stringContaining('not available while attached'),
    });
    await channel.stop();
  });

  it('shows a protocol error as a notice, not a failure', async () => {
    const { channel, link } = await attached();
    link.push({ type: 'protocol_error', message: 'A turn is running.' });
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: 'A turn is running.',
    });
    await channel.stop();
  });

  it('ends with a notice when the connection closes, and stops listening', async () => {
    const onEnd = vi.fn();
    const { channel, link } = await attached({ onEnd });
    link.sent.length = 0;
    link.close();
    expect(onEnd).toHaveBeenCalledWith('closed');
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: expect.stringContaining('connection to the session closed'),
    });
    await channel.handleInput('hello');
    expect(link.sent).toEqual([]);
    expect(link.listenerCount()).toBe(0);
    await channel.stop();
  });
});

describe('WireTuiChannel history, read in pages (#3189)', () => {
  it('asks for the next page after each one, and shows the history once all of it arrived', async () => {
    const { channel, link } = await attached();
    link.sent.length = 0;

    link.push(page([chat('e0', 'user', 'first'), chat('e1', 'assistant', 'second')], 0, 3));
    expect(historyRequests(link.sent)).toEqual([{ type: 'get-history', fromIndex: 2 }]);
    // Half a history is never shown: the transcript is printed once, from its start.
    expect(channel.getSnapshot().history).toEqual([]);

    link.push(page([chat('e2', 'user', 'third')], 2, 3));
    expect(contents(channel.getSnapshot().history)).toEqual(['first', 'second', 'third']);
    expect(historyRequests(link.sent)).toHaveLength(1);
    await channel.stop();
  });

  it('reads only what came after the entries it knows when a turn completes, fails or stops', async () => {
    const { channel, link } = await attached();
    link.push(page([chat('e0', 'user', 'hello'), chat('e1', 'assistant', 'hi')]));
    link.sent.length = 0;

    link.push(completed('ok'));
    expect(historyRequests(link.sent)).toEqual([{ type: 'get-history', fromIndex: 2 }]);
    link.push(page([chat('e2', 'user', 'again'), chat('e3', 'assistant', 'ok')], 2));
    expect(contents(channel.getSnapshot().history)).toEqual(['hello', 'hi', 'again', 'ok']);

    link.sent.length = 0;
    link.push({ type: 'error', message: 'provider down' });
    expect(historyRequests(link.sent)).toEqual([{ type: 'get-history', fromIndex: 4 }]);
    link.push(page([chat('e4', 'assistant', 'partial')], 4));

    link.sent.length = 0;
    link.push({ type: 'interrupted', result: { response: 'partial' } as never });
    expect(historyRequests(link.sent)).toEqual([{ type: 'get-history', fromIndex: 5 }]);
    await channel.stop();
  });

  it('reads everything again when the host holds fewer entries than it knows', async () => {
    const { channel, link } = await attached();
    link.push(page([chat('e0', 'user', 'hello'), chat('e1', 'assistant', 'hi')]));
    link.sent.length = 0;

    link.push(completed('ok'));
    // The host's answer to the read from 2: its history now ends at 1.
    link.push(page([], 1, 1));
    expect(historyRequests(link.sent)).toEqual([
      { type: 'get-history', fromIndex: 2 },
      { type: 'get-history' },
    ]);
    link.push(page([chat('x0', 'user', 'replaced')]));
    expect(contents(channel.getSnapshot().history)).toEqual(['replaced']);
    await channel.stop();
  });

  it('reads everything again on history_changed and history_cleared', async () => {
    const { channel, link } = await attached();
    link.push(page([chat('e0', 'user', 'hello')]));
    link.sent.length = 0;

    link.push({ type: 'history_changed' });
    expect(historyRequests(link.sent)).toEqual([{ type: 'get-history' }]);
    link.push(page([chat('e0', 'user', 'hello'), chat('c1', 'assistant', 'compacted')]));
    expect(contents(channel.getSnapshot().history)).toEqual(['hello', 'compacted']);

    link.sent.length = 0;
    link.push({ type: 'history_cleared' });
    expect(channel.getSnapshot().history).toEqual([]);
    expect(historyRequests(link.sent)).toEqual([{ type: 'get-history' }]);
    link.push(page([]));
    expect(channel.getSnapshot().history).toEqual([]);
    await channel.stop();
  });

  it('never waits forever on a reply: a switch or a resume gap reads again at once', async () => {
    const { channel, link } = await attached();
    link.sent.length = 0;
    // The attach-time read is still unanswered.
    link.push({ type: 'resume_gap' });
    expect(historyRequests(link.sent)).toEqual([{ type: 'get-history' }]);
    expect(types(link.sent)).toEqual(SNAPSHOT_TYPES);

    link.sent.length = 0;
    link.push({ type: 'session_switched', event: { sessionId: 'session-2' } });
    expect(historyRequests(link.sent)).toEqual([{ type: 'get-history' }]);

    // A reply to a read given up on that starts elsewhere is not taken for this one.
    link.push(page([chat('s0', 'user', 'stale')], 5, 6));
    link.push(page([chat('n0', 'user', 'new session')]));
    expect(contents(channel.getSnapshot().history)).toEqual([
      'Switched to session session-2.',
      'new session',
    ]);
    await channel.stop();
  });

  it("prints a finished turn's answer when the next turn starts before the history arrives", async () => {
    const { channel, link } = await attached();
    const screen = printer(channel);
    const push = (frame: TServerMessage): void => {
      link.push(frame);
      screen.render();
    };
    push(page([chat('e0', 'user', 'earlier')]));
    push({ type: 'user_message', content: 'prompt 1', driverId: 'attach:1' });
    push({ type: 'thinking', isThinking: true });
    push({ type: 'text_delta', delta: 'answer 1' });
    push(completed('answer 1'));
    // A queued prompt starts on the host before this terminal read the finished turn.
    push({ type: 'user_message', content: 'prompt 2', driverId: 'attach:1' });
    push(
      page(
        [
          chat('e1', 'user', 'prompt 1'),
          chat('e2', 'assistant', 'answer 1'),
          chat('e3', 'user', 'prompt 2'),
        ],
        1,
      ),
    );
    expect(screen.printed).toEqual(['earlier', 'prompt 1', 'answer 1', 'prompt 2']);
    await channel.stop();
  });

  it('shows a held echo after the history it waited for, and replaces it with the host entry', async () => {
    const { channel, link } = await attached();
    const screen = printer(channel);
    const push = (frame: TServerMessage): void => {
      link.push(frame);
      screen.render();
    };
    push(page([chat('e0', 'user', 'prompt 1')]));
    push(completed('answer 1'));
    push({ type: 'user_message', content: 'prompt 2' });
    // The host has not recorded the second prompt yet.
    push(page([chat('e1', 'assistant', 'answer 1')], 1));
    push(completed('answer 2'));
    push(page([chat('e2', 'user', 'prompt 2'), chat('e3', 'assistant', 'answer 2')], 2));
    expect(screen.printed).toEqual(['prompt 1', 'answer 1', 'prompt 2', 'answer 2']);
    expect(contents(channel.getSnapshot().history)).toEqual([
      'prompt 1',
      'answer 1',
      'prompt 2',
      'answer 2',
    ]);
    await channel.stop();
  });

  it('prints the new session from its start when a switch and its history arrive together', async () => {
    const { channel, link } = await attached();
    const screen = printer(channel);
    link.push(page([chat('o0', 'user', 'old 1'), chat('o1', 'assistant', 'old 2')]));
    link.push({ type: 'user_message', content: 'old 3' });
    screen.render();
    const generation = channel.getSnapshot().transcriptGeneration;

    link.push({ type: 'session_switched', event: { sessionId: 'session-2' } });
    link.push(page([chat('n0', 'user', 'new 1')]));
    screen.render();

    expect(channel.getSnapshot().transcriptGeneration).not.toBe(generation);
    expect(screen.printed).toEqual([
      'old 1',
      'old 2',
      'old 3',
      'Switched to session session-2.',
      'new 1',
    ]);
    await channel.stop();
  });
});

describe('WireTuiChannel session state (#3189)', () => {
  it("shows the host's status, and labels the session by its name or else its id", async () => {
    const { channel, link } = await attached();
    const renames: string[] = [];
    channel.getSessionUiEventPort().on('session_renamed', (event) => renames.push(event.name));
    expect(channel.getRuntimeStatusSnapshot('default')).toEqual({
      permissionMode: 'default',
      sessionId: '',
    });

    link.push({ type: 'session_status', status: status() });
    expect(channel.getRuntimeStatusSnapshot('default')).toEqual({
      permissionMode: 'acceptEdits',
      sessionId: 'session_0123456789ab',
      effort: 'high',
      modelId: 'claude-test',
    });
    // Not the host's own label ('daemon'): the session's id, without the prefix every id shares.
    expect(channel.sessionName).toBe('01234567');

    link.push({ type: 'session_status', status: status({ sessionName: 'auth work' }) });
    expect(channel.sessionName).toBe('auth work');

    link.push({ type: 'session_switched', event: { sessionId: 'session_fedcba987654' } });
    expect(channel.sessionName).toBe('fedcba98');
    expect(channel.getRuntimeStatusSnapshot('default').sessionId).toBe('');
    link.push({ type: 'session_status', status: status({ sessionId: 'session_fedcba987654' }) });
    expect(channel.sessionName).toBe('fedcba98');
    expect(renames).toEqual(['01234567', 'auth work', 'fedcba98']);
    await channel.stop();
  });

  it('shows the queued prompt and how many wait, as the host reports them', async () => {
    const { channel, link } = await attached();
    link.push({ type: 'pending', pending: 'follow-up', pendingCount: 2 });
    expect(channel.getSnapshot()).toMatchObject({ pendingPrompt: 'follow-up', pendingCount: 2 });
    link.push({ type: 'pending', pending: null, pendingCount: 0 });
    expect(channel.getSnapshot()).toMatchObject({ pendingPrompt: null, pendingCount: 0 });
    await channel.stop();
  });

  it('counts the one queued prompt it can see when an older host sends no count', async () => {
    // A daemon from before the count still reports the prompt; the footer must not lose the number.
    const { channel, link } = await attached();
    link.push({ type: 'pending', pending: 'follow-up' });
    expect(channel.getSnapshot()).toMatchObject({ pendingPrompt: 'follow-up', pendingCount: 1 });
    link.push({ type: 'pending', pending: null });
    expect(channel.getSnapshot()).toMatchObject({ pendingPrompt: null, pendingCount: 0 });
    await channel.stop();
  });

  it('asks for the pending queue when a turn starts or ends, and follows a turn running at attach', async () => {
    const { channel, link } = await attached();
    link.push({ type: 'executing', executing: true });
    expect(channel.getSnapshot().isThinking).toBe(true);
    link.sent.length = 0;
    link.push({ type: 'thinking', isThinking: false });
    expect(link.sent).toEqual([{ type: 'get-pending' }]);
    expect(channel.getSnapshot().isThinking).toBe(false);
    await channel.stop();
  });

  it("echoes this terminal's prompt as the user's and another client's under its driver", async () => {
    const { channel, link } = await attached();
    answerHistory(link);
    link.push({ type: 'user_message', content: 'mine', driverId: 'attach:1' });
    link.push({ type: 'user_message', content: 'theirs', driverId: 'attach:2' });
    const drivers = channel
      .getSnapshot()
      .history.map((entry) => (entry.data as { metadata?: { driverId?: string } }).metadata);
    expect(drivers).toEqual([{ driverId: 'owner' }, { driverId: 'attach:2' }]);
    await channel.stop();
  });

  it('hands an unattributed UI intent to the App as it came', async () => {
    const { channel, link } = await attached();
    const intents: IUiIntentEvent[] = [];
    channel.getSessionUiEventPort().on('ui_intent', (event) => intents.push(event));
    link.push({ type: 'ui_intent', event: { intent: { type: 'show-theme-picker' } } });
    expect(intents).toEqual([{ intent: { type: 'show-theme-picker' } }]);
    await channel.stop();
  });

  it('says nothing when the listing asked for at attach fails', async () => {
    const { channel, link } = await attached();
    const before = channel.getSnapshot().history.length;
    link.push({
      type: 'sessions_error',
      requestId: lastListRequestId(link.sent),
      code: 'not_available',
      message: 'Session listing is not available on this host.',
    });
    expect(channel.getSnapshot().history).toHaveLength(before);
    await channel.stop();
  });
});

describe('WireTuiChannel questions open at attach (#3189)', () => {
  it('shows a question the host sends again only once, and answers it once', async () => {
    const { channel, link } = await attached();
    expect(types(link.sent)).toContain('get-prompts');
    link.sent.length = 0;
    const question = { id: 'p1', toolName: 'Bash', toolArgs: { command: 'ls' } };
    // Asked live, then sent again in answer to `get-prompts`.
    link.push({ type: 'permission_request', event: question });
    link.push({ type: 'permission_request', event: question });

    channel.getSnapshot().permissionRequest?.resolve(true);
    await flush();
    await flush();
    expect(channel.getSnapshot().permissionRequest).toBeNull();
    expect(link.sent).toEqual([{ type: 'permission-response', id: 'p1', result: true }]);
    await channel.stop();
  });
});

describe('WireTuiChannel commands (#3189)', () => {
  it('settles a command only on its own answer; a failure without a request settles nothing', async () => {
    const { channel, link } = await attached();
    link.sent.length = 0;
    const settled: string[] = [];
    const first = channel.handleInput('/compact').then(() => settled.push('compact'));
    const firstId = lastCommandRequestId(link.sent);
    const second = channel.handleInput('/broken').then(() => settled.push('broken'));
    const secondId = lastCommandRequestId(link.sent);
    expect(firstId).not.toBe(secondId);

    // A refused switch, say: it answers no command.
    link.push({ type: 'protocol_error', message: 'Stop the running turn first.' });
    await flush();
    expect(settled).toEqual([]);
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: 'Stop the running turn first.',
    });

    link.push({ type: 'protocol_error', message: 'broken failed', requestId: secondId });
    await second;
    expect(settled).toEqual(['broken']);

    link.push({
      type: 'command_result',
      name: 'compact',
      message: 'Compacted.',
      success: true,
      requestId: firstId,
    });
    await first;
    expect(settled).toEqual(['broken', 'compact']);
    await channel.stop();
  });

  it('shows nothing for a command that started a turn, and asks for the queue instead', async () => {
    const { channel, link } = await attached();
    const before = channel.getSnapshot().history.length;
    link.sent.length = 0;
    const command = channel.handleInput('/hello');
    link.push({
      type: 'command_result',
      name: 'hello',
      message: 'Skill hello invoked.',
      success: true,
      data: { skill: 'hello', sessionExecution: true },
      requestId: lastCommandRequestId(link.sent),
    });
    await command;
    expect(channel.getSnapshot().history).toHaveLength(before);
    expect(types(link.sent)).toContain('get-pending');
    await channel.stop();
  });

  it('settles a command it could not send, with a notice', async () => {
    const { channel, link } = await attached();
    link.failSends();
    await channel.handleInput('/help');
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: 'Could not reach the session: socket closed',
    });
    await channel.stop();
  });
});

describe('WireTuiChannel abort and queue cancel (#3189)', () => {
  it('abort stops the host turn and turns down the questions it shows', async () => {
    const { channel, link } = await attached();
    link.push({ type: 'permission_request', event: { id: 'p1', toolName: 'Bash', toolArgs: {} } });
    link.push({
      type: 'ask_request',
      event: { id: 'a1', request: { kind: 'text', title: 'Name?' } as never },
    });
    link.sent.length = 0;

    channel.abort();
    await flush();

    expect(channel.getSnapshot()).toMatchObject({
      isAborting: true,
      permissionRequest: null,
      pendingUserAction: null,
    });
    expect(link.sent[0]).toEqual({ type: 'abort' });
    // The host drains its prompts on abort too; these answers find them settled.
    expect(link.sent.slice(1)).toEqual(
      expect.arrayContaining([
        { type: 'permission-response', id: 'p1', result: false },
        { type: 'ask-response', id: 'a1', response: { type: 'cancelled' } },
      ]),
    );
    expect(link.sent).toHaveLength(3);
    await channel.stop();
  });

  it('cancelQueue drops the queued prompt on the host and here', async () => {
    const { channel, link } = await attached();
    link.push({ type: 'pending', pending: 'follow-up', pendingCount: 1 });
    link.push({ type: 'permission_request', event: { id: 'p1', toolName: 'Bash', toolArgs: {} } });
    link.sent.length = 0;

    channel.cancelQueue();
    await flush();

    expect(channel.getSnapshot()).toMatchObject({
      pendingPrompt: null,
      pendingCount: 0,
      permissionRequest: null,
    });
    expect(link.sent).toEqual([
      { type: 'cancel-queue' },
      { type: 'permission-response', id: 'p1', result: false },
    ]);
    await channel.stop();
  });
});

describe('WireTuiChannel terminal-owned commands (#3189)', () => {
  /** Stands in for `/shell`: it runs where this terminal is. */
  const shell: ITuiClientCommand = {
    name: 'shell',
    execute: (host, args) => ({ success: true, message: `${args} ran in ${host.getCwd()}` }),
  };
  /** Stands in for `/theme`: bare opens the picker, a name asks for an appearance patch. */
  const theme: ITuiClientCommand = {
    name: 'theme',
    execute: (_host, args) =>
      args === ''
        ? {
            success: true,
            message: 'Opening the theme picker...',
            uiIntents: [{ type: 'show-theme-picker' }],
          }
        : {
            success: true,
            message: `Theme set to ${args}.`,
            hostActions: [{ type: 'appearance-settings-patch', patch: { theme: args } }],
          },
  };

  async function withClientCommands(
    writeAppearanceSettings: ITuiClientCommands['writeAppearanceSettings'] = () => undefined,
    extra: readonly ITuiClientCommand[] = [],
  ): Promise<{ channel: WireTuiChannel; link: IScriptedConnection }> {
    const link = scriptedConnection();
    const channel = new WireTuiChannel({
      connection: link,
      driverId: 'attach:1',
      sessionName: 'daemon',
      cwd: '/work/here',
      clientCommands: { commands: [shell, theme, ...extra], writeAppearanceSettings },
    });
    await channel.start();
    link.sent.length = 0;
    return { channel, link };
  }

  it('runs /shell in this terminal, in its working directory, and sends the daemon nothing', async () => {
    const { channel, link } = await withClientCommands();
    await channel.handleInput('/shell ls');
    expect(link.sent).toEqual([]);
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      role: 'system',
      content: 'ls ran in /work/here',
    });
    await channel.stop();
  });

  it('opens the theme picker for a bare /theme as this terminal owner’s screen', async () => {
    const { channel, link } = await withClientCommands();
    const intents: IUiIntentEvent[] = [];
    channel.getSessionUiEventPort().on('ui_intent', (event) => intents.push(event));
    await channel.handleInput('/theme');
    expect(intents).toEqual([
      { intent: { type: 'show-theme-picker' }, requesterDriverId: 'owner' },
    ]);
    expect(link.sent).toEqual([]);
    await channel.stop();
  });

  it('settles /theme light only after the appearance settings are written', async () => {
    let finishWrite: () => void = () => undefined;
    const write = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve;
        }),
    );
    const { channel, link } = await withClientCommands(write);
    let settled = false;
    const command = channel.handleInput('/theme light').then(() => {
      settled = true;
    });
    await flush();
    expect(write).toHaveBeenCalledWith({ theme: 'light' });
    expect(settled).toBe(false);
    finishWrite();
    await command;
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: 'Theme set to light.',
    });
    expect(link.sent).toEqual([]);
    await channel.stop();
  });

  it('shows a client command that throws as a failure notice', async () => {
    const broken: ITuiClientCommand = {
      name: 'editor',
      execute: () => {
        throw new Error('no editor');
      },
    };
    const { channel, link } = await withClientCommands(undefined, [broken]);
    await channel.handleInput('/editor');
    expect(link.sent).toEqual([]);
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: expect.stringContaining('no editor'),
    });
    await channel.stop();
  });

  it('still sends any other command to the daemon', async () => {
    const { channel, link } = await withClientCommands();
    const command = channel.handleInput('/mode plan');
    expect(link.sent).toEqual([
      { type: 'command', name: 'mode', args: 'plan', requestId: expect.any(String) },
    ]);
    link.push({
      type: 'command_result',
      name: 'mode',
      message: 'Mode: plan',
      success: true,
      requestId: lastCommandRequestId(link.sent),
    });
    await command;
    await channel.stop();
  });
});

function lastSwitchRequestId(sent: readonly TClientMessage[]): string {
  const switches = sent.filter(
    (message): message is Extract<TClientMessage, { type: 'switch-session' }> =>
      message.type === 'switch-session',
  );
  return switches.at(-1)?.requestId ?? '';
}

describe('WireTuiChannel refused session changes (#3189 step 5)', () => {
  it('shows why a switch was refused and settles the switch, but no command', async () => {
    const { channel, link } = await attached();
    link.sent.length = 0;
    const settled: string[] = [];
    const command = channel.handleInput('/compact').then(() => settled.push('compact'));
    const commandId = lastCommandRequestId(link.sent);
    const switched = channel.requestSessionSwitch('s2').then(() => settled.push('switch'));
    const switchId = lastSwitchRequestId(link.sent);
    expect(switchId).not.toBe('');
    expect(switchId).not.toBe(commandId);

    link.push({
      type: 'session_change_failed',
      code: 'prompt_pending',
      message: 'Answer the open question first.',
      requestId: switchId,
    });
    await switched;
    expect(settled).toEqual(['switch']);
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: 'Answer the open question first.',
    });

    // Even one naming the command's request answers no command.
    link.push({
      type: 'session_change_failed',
      code: 'failed',
      message: 'not a command answer',
      requestId: commandId,
    });
    await flush();
    expect(settled).toEqual(['switch']);

    link.push({
      type: 'command_result',
      name: 'compact',
      message: 'Compacted.',
      success: true,
      requestId: commandId,
    });
    await command;
    expect(settled).toEqual(['switch', 'compact']);
    await channel.stop();
  });

  it("settles a switch an older host refuses with a protocol error that names no request", async () => {
    const { channel, link } = await attached();
    const switched = channel.requestSessionSwitch('s2');
    link.push({ type: 'protocol_error', message: 'Stop the running turn first.' });
    await switched;
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: 'Stop the running turn first.',
    });
    await channel.stop();
  });

  it('does not wait on a switch to the session it already shows', async () => {
    const { channel, link } = await attached();
    link.push({ type: 'session_status', status: status({ sessionId: 's1' }) });
    link.sent.length = 0;
    await channel.requestSessionSwitch('s1');
    expect(link.sent.some((message) => message.type === 'switch-session')).toBe(false);
    await channel.stop();
  });

  it('settles a pending switch when this terminal leaves', async () => {
    const { channel } = await attached();
    const switched = channel.requestSessionSwitch('s2');
    await channel.stop();
    await switched;
  });
});

function lastRequestId(sent: readonly TClientMessage[], type: TClientMessage['type']): string {
  const message = sent.filter((entry) => entry.type === type).at(-1);
  return message !== undefined && 'requestId' in message ? (message.requestId ?? '') : '';
}

function lastNotice(channel: WireTuiChannel): unknown {
  return (channel.getSnapshot().history.at(-1)?.data as { content?: unknown } | undefined)?.content;
}

describe('WireTuiChannel background work and loops (#3189 step 3b)', () => {
  it("reads a workspace entry's detail page from the host, and fails with the host's reason", async () => {
    const { channel, link } = await attached();
    const page = { entryId: 'task-1', items: [], nextCursor: undefined } as never;
    const read = channel.readExecutionWorkspaceDetail('task-1');
    expect(link.sent.at(-1)).toMatchObject({ type: 'read-execution-detail', entryId: 'task-1' });
    const requestId = lastRequestId(link.sent, 'read-execution-detail');
    // An answer to another request settles nothing.
    link.push({ type: 'execution_detail', requestId: 'other', page });
    link.push({ type: 'execution_detail', requestId, page });
    await expect(read).resolves.toBe(page);

    const failing = channel.readExecutionWorkspaceDetail('gone');
    link.push({
      type: 'execution_detail_error',
      requestId: lastRequestId(link.sent, 'read-execution-detail'),
      message: 'No entry gone.',
    });
    await expect(failing).rejects.toThrow('No entry gone.');
    await channel.stop();
  });

  it('fails a detail read still waiting when this terminal leaves', async () => {
    const { channel } = await attached();
    const read = channel.readExecutionWorkspaceDetail('task-1');
    await channel.stop();
    await expect(read).rejects.toThrow('Detached');
  });

  it("sends input to a background task and settles on the host's control result for it", async () => {
    const { channel, link } = await attached();
    let settled = false;
    const sending = channel.sendAgentJob('task-1', 'more please').then(() => {
      settled = true;
    });
    expect(link.sent.at(-1)).toEqual({
      type: 'send-background-task',
      taskId: 'task-1',
      input: { prompt: 'more please' },
    });
    link.push({ type: 'background_task_control_result', action: 'cancel', taskId: 'task-1', success: true });
    link.push({ type: 'background_task_control_result', action: 'send', taskId: 'task-2', success: true });
    await flush();
    expect(settled).toBe(false);
    link.push({ type: 'background_task_control_result', action: 'send', taskId: 'task-1', success: true });
    await sending;

    const refused = channel.sendAgentJob('task-1', 'again');
    link.push({
      type: 'background_task_control_result',
      action: 'send',
      taskId: 'task-1',
      success: false,
      message: 'Task task-1 is not running.',
    });
    await refused;
    expect(lastNotice(channel)).toBe(
      'Could not send to background task task-1: Task task-1 is not running.',
    );
    await channel.stop();
  });

  it("asks the host to stop its waiting loop and shows the session's answer", async () => {
    const { channel, link } = await attached();
    const stopping = channel.stopWaitingSelfPacedLoop();
    expect(link.sent.at(-1)).toMatchObject({ type: 'stop-waiting-loop' });
    link.push({
      type: 'waiting_loop_stop',
      requestId: lastRequestId(link.sent, 'stop-waiting-loop'),
      outcome: { kind: 'stopped', loopId: 'loop_one', message: 'Loop loop_one stopped.' },
    });
    await stopping;
    expect(lastNotice(channel)).toBe('Loop loop_one stopped by Esc.');

    const several = channel.stopWaitingSelfPacedLoop();
    link.push({
      type: 'waiting_loop_stop',
      requestId: lastRequestId(link.sent, 'stop-waiting-loop'),
      outcome: { kind: 'several', message: 'Use /loop stop <id> to choose one.' },
    });
    await several;
    expect(lastNotice(channel)).toBe('Use /loop stop <id> to choose one.');

    const count = channel.getSnapshot().history.length;
    const none = channel.stopWaitingSelfPacedLoop();
    link.push({
      type: 'waiting_loop_stop',
      requestId: lastRequestId(link.sent, 'stop-waiting-loop'),
      outcome: { kind: 'none' },
    });
    await none;
    expect(channel.getSnapshot().history).toHaveLength(count);
    await channel.stop();
  });
});

describe('WireTuiChannel observing (#3189 step 3b)', () => {
  async function observing(): Promise<{ channel: WireTuiChannel; link: IScriptedConnection }> {
    const link = scriptedConnection();
    const channel = new WireTuiChannel({
      connection: link,
      driverId: 'attach:1',
      sessionName: 'daemon',
      role: 'observe',
      cwd: '/work/here',
      clientCommands: {
        commands: [{ name: 'shell', execute: () => ({ success: true, message: 'ran here' }) }],
        writeAppearanceSettings: () => undefined,
      },
    });
    await channel.start();
    return { channel, link };
  }

  it('asks for no open questions, and says it is read only', async () => {
    const { channel, link } = await observing();
    expect(types(link.sent)).toEqual(SNAPSHOT_TYPES.filter((type) => type !== 'get-prompts'));
    expect(channel.getSnapshot().readOnly).toBe(true);
    await channel.stop();
  });

  it("refuses prompts and the host's commands with a notice, but runs /exit and its own commands", async () => {
    const onEnd = vi.fn();
    const link = scriptedConnection();
    const channel = new WireTuiChannel({
      connection: link,
      role: 'observe',
      cwd: '/work/here',
      clientCommands: {
        commands: [{ name: 'shell', execute: () => ({ success: true, message: 'ran here' }) }],
        writeAppearanceSettings: () => undefined,
      },
      onEnd,
    });
    await channel.start();
    link.sent.length = 0;
    await channel.handleInput('hello');
    expect(lastNotice(channel)).toEqual(expect.stringContaining('Read only'));
    await channel.handleInput('/mode plan');
    expect(lastNotice(channel)).toEqual(expect.stringContaining('Read only'));
    await channel.handleInput('/shell ls');
    expect(lastNotice(channel)).toBe('ran here');
    expect(link.sent).toEqual([]);
    await channel.handleInput('/exit');
    expect(onEnd).toHaveBeenCalledWith('user');
  });

  it('changes nothing on the session: no abort, queue cancel, loop stop, task input or switch', async () => {
    const { channel, link } = await observing();
    link.sent.length = 0;
    channel.abort();
    expect(channel.getSnapshot().isAborting).toBe(false);
    channel.cancelQueue();
    await channel.stopWaitingSelfPacedLoop();
    await channel.sendAgentJob('task-1', 'more');
    await channel.requestSessionSwitch('session_other');
    expect(link.sent).toEqual([]);
    expect(lastNotice(channel)).toEqual(expect.stringContaining('Read only'));
    await channel.stop();
  });

  it('sends only what an observer may send, detail reads included', async () => {
    const { channel, link } = await observing();
    link.sent.length = 0;
    const read = channel.readExecutionWorkspaceDetail('task-1');
    link.push({ type: 'thinking', isThinking: true });
    expect(types(link.sent)).toEqual(['read-execution-detail', 'get-pending']);
    await channel.stop();
    await expect(read).rejects.toThrow('Detached');
  });
});
