import { describe, expect, it, vi } from 'vitest';

import { WireTuiChannel } from '../wire-tui-channel.js';

import type { IAttachedSessionConnection } from '../attached-session-connection.js';
import type { TAttachedSessionEnd } from '../attached-session-connection.js';
import type { IUiIntentEvent } from '@robota-sdk/agent-interface-session';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport/client';

interface IScriptedConnection extends IAttachedSessionConnection {
  readonly sent: TClientMessage[];
  push(message: TServerMessage): void;
  close(): void;
  readonly listenerCount: () => number;
}

function scriptedConnection(): IScriptedConnection {
  const listeners = new Set<(message: TServerMessage) => void>();
  const closers = new Set<() => void>();
  const sent: TClientMessage[] = [];
  return {
    sent,
    send: (message) => {
      sent.push(message);
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

/** Answer the attach-time history request so the next one is sent, not queued behind it. */
function answerHistory(link: IScriptedConnection): void {
  link.push({ type: 'history', entries: [] });
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
    expect(types(link.sent)).toContain('get-history');
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
    link.push({
      type: 'history',
      entries: [
        {
          id: 'e1',
          timestamp: '2026-09-26T10:00:00.000Z',
          category: 'chat',
          type: 'user',
          data: {
            id: 'm1',
            role: 'user',
            content: 'mine',
            state: 'complete',
            timestamp: '2026-09-26T10:00:00.000Z',
            metadata: { driverId: 'attach:1' },
          },
        },
        {
          id: 'e2',
          timestamp: '2026-09-26T10:00:01.000Z',
          category: 'chat',
          type: 'user',
          data: {
            id: 'm2',
            role: 'user',
            content: 'theirs',
            state: 'complete',
            timestamp: '2026-09-26T10:00:01.000Z',
            metadata: { driverId: 'attach:2' },
          },
        },
      ],
    });
    const [mine, theirs] = channel.getSnapshot().history;
    expect(mine?.timestamp).toBeInstanceOf(Date);
    expect(mine?.timestamp.toISOString()).toBe('2026-09-26T10:00:00.000Z');
    const mineData = mine?.data as { timestamp: unknown; metadata: { driverId: string } };
    expect(mineData.timestamp).toBeInstanceOf(Date);
    // This terminal's own prompts read as the user's; another client's keep their driver.
    expect(mineData.metadata.driverId).toBe('owner');
    expect((theirs?.data as { metadata: { driverId: string } }).metadata.driverId).toBe('attach:2');
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
    expect(link.sent[0]).toEqual({ type: 'submit', prompt: 'hello' });

    link.sent.length = 0;
    let settled = false;
    const command = channel.handleInput('/Help me').then(() => {
      settled = true;
    });
    expect(link.sent).toEqual([{ type: 'command', name: 'help', args: 'me' }]);
    await flush();
    // The command is on screen only once the host answers.
    expect(settled).toBe(false);
    link.push({
      type: 'command_result',
      name: 'help',
      message: 'Available commands',
      success: true,
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
      commands: [{ name: 'help', description: 'Help', modelInvocable: false }],
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
    link.push({
      type: 'history',
      entries: [
        {
          id: 'old',
          timestamp: '2026-09-26T10:00:00.000Z',
          category: 'chat',
          type: 'user',
          data: { id: 'm', role: 'user', content: 'old session', state: 'complete' },
        },
      ],
    });
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
    link.push({ type: 'history', entries: [] });
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
    await channel.requestSessionSwitch('s2');
    expect(link.sent).toEqual([{ type: 'switch-session', sessionId: 's2' }]);
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

  it('shows a protocol error and a missing wire feature as notices, not failures', async () => {
    const { channel, link } = await attached();
    link.push({ type: 'protocol_error', message: 'A turn is running.' });
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: 'A turn is running.',
    });
    await expect(channel.readExecutionWorkspaceDetail('task-1')).rejects.toThrow(
      'not available while attached',
    );
    await channel.sendAgentJob('task-1', 'more');
    expect(channel.getSnapshot().history.at(-1)?.data).toMatchObject({
      content: expect.stringContaining('not available while attached'),
    });
    await expect(channel.stopWaitingSelfPacedLoop()).resolves.toBeUndefined();
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
