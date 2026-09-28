// @vitest-environment jsdom
/**
 * #3189 — the GUI reducer keeps the host's session list beside the conversation: it asks for it on
 * connect and whenever it may have changed, keeps only the latest answer, starts and switches
 * sessions through their wire messages, and re-reads everything the session shows after a switch.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { rememberSessionForRestore } from '../use-session-directory.js';
import { useSessionClient } from '../useSessionClient.js';

import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

afterEach(() => window.sessionStorage.clear());

function setup(): {
  result: { current: ReturnType<typeof useSessionClient> };
  deliver: (msg: TServerMessage) => void;
  connect: () => void;
  wire: TClientMessage[];
} {
  let onMessage: ((msg: TServerMessage) => void) | null = null;
  let onStatusChange: ((status: 'connected') => void) | null = null;
  const wire: TClientMessage[] = [];
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    onStatusChange = callbacks.onStatusChange;
    return { connect: () => {}, disconnect: () => {}, send: (message) => wire.push(message) };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  return {
    result,
    wire,
    deliver: (msg) => act(() => onMessage?.(msg)),
    connect: () => act(() => onStatusChange?.('connected')),
  };
}

function lastListRequest(wire: readonly TClientMessage[]): string {
  const request = wire.filter((m) => m.type === 'list-sessions').at(-1);
  if (request?.type !== 'list-sessions') throw new Error('expected a list-sessions request');
  return request.requestId;
}

/** The request id of the `index`th session change (switch or new) sent on the wire. */
function changeRequestId(wire: readonly TClientMessage[], index: number): string {
  const change = wire.filter((m) => m.type === 'switch-session' || m.type === 'new-session')[index];
  if (change?.type !== 'switch-session' && change?.type !== 'new-session') {
    throw new Error('expected a session change');
  }
  if (change.requestId === undefined) throw new Error('the session change carries no request id');
  return change.requestId;
}

const listing = (currentSessionId: string) => ({
  currentSessionId,
  sessions: [
    { id: 'a', cwd: '/w', updatedAt: '2026-09-26T00:00:00.000Z', messageCount: 2, preview: 'first' },
    { id: 'b', cwd: '/w', updatedAt: '2026-09-25T00:00:00.000Z', messageCount: 4, preview: 'second' },
  ],
  unreadableSessionIds: ['broken'],
});

describe('#3189 — session list, start and switch in the GUI reducer', () => {
  it('asks for the session list on connect, beside the commands and status', () => {
    const { wire, connect } = setup();
    connect();
    // #3280 §2: also asks for the queue — a reconnect to the same session gets no `session_switched`
    // to trigger that ask otherwise, so a stale `queuedPrompt` from before a drop would linger.
    expect(wire.map((m) => m.type)).toEqual([
      'get-commands',
      'get-status',
      'get-pending',
      'list-sessions',
      // #3282 §4 part b-3: the Agents panel's Scheduled group also loads on connect.
      'get-background-tasks',
    ]);
  });

  it('keeps the latest listing answer and ignores a stale one', () => {
    const { result, wire, connect, deliver } = setup();
    expect(result.current.sessionListing).toBeNull();
    connect();
    const stale = lastListRequest(wire);
    act(() => result.current.requestSessions());
    const latest = lastListRequest(wire);

    deliver({ type: 'sessions', requestId: latest, listing: listing('a') });
    deliver({ type: 'sessions', requestId: stale, listing: listing('b') });

    expect(result.current.sessionListing?.currentSessionId).toBe('a');
    expect(result.current.sessionListing?.unreadableSessionIds).toEqual(['broken']);
  });

  it('records a host that cannot list sessions', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({
      type: 'sessions_error',
      requestId: lastListRequest(wire),
      code: 'not_available',
      message: 'This host does not list sessions.',
    });
    expect(result.current.sessionsError).toEqual({
      code: 'not_available',
      message: 'This host does not list sessions.',
    });
    expect(result.current.sessionListing).toBeNull();
  });

  it('sends switch-session and new-session as wire messages, not slash commands', () => {
    const { result, wire } = setup();
    act(() => result.current.switchSession('b'));
    act(() => result.current.newSession());
    expect(wire).toEqual([
      { type: 'switch-session', sessionId: 'b', requestId: expect.any(String) },
      { type: 'new-session', requestId: expect.any(String) },
    ]);
    expect(changeRequestId(wire, 0)).not.toBe(changeRequestId(wire, 1));
  });

  it('a switch clears what the old session showed and re-reads the new one', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: listing('a') });
    deliver({ type: 'user_message', content: 'old turn' });
    deliver({ type: 'tool_start', state: { toolName: 'Read', isRunning: true } as never });
    deliver({ type: 'text_delta', delta: 'streaming' });
    deliver({
      type: 'permission_request',
      event: { id: 'p1', toolName: 'Write', toolArgs: {} },
    } as TServerMessage);
    expect(result.current.pendingPrompts).toHaveLength(1);
    wire.length = 0;

    deliver({ type: 'session_switched', event: { sessionId: 'b' } });

    expect(result.current.messages).toEqual([]);
    expect(result.current.streamingText).toBe('');
    expect(result.current.activeTools).toEqual([]);
    expect(result.current.pendingPrompts).toEqual([]);
    expect(result.current.sessionListing?.currentSessionId).toBe('b');
    expect(wire.map((m) => m.type)).toEqual([
      'get-messages',
      'get-status',
      'get-commands',
      'get-execution-workspace',
      // #3280 §2: the queued-message row is per-session state too — a switch re-reads it.
      'get-pending',
      'list-sessions',
      // #3282 §4 part b-3: schedules are per-session state too — a switch re-reads it.
      'get-background-tasks',
    ]);
  });

  it('refreshes the list after a rename and after a turn completes', () => {
    const { wire, deliver } = setup();
    deliver({ type: 'session_renamed', event: { name: 'Renamed' } });
    expect(wire.filter((m) => m.type === 'list-sessions')).toHaveLength(1);
    deliver({ type: 'complete', result: { response: 'done' } } as TServerMessage);
    expect(wire.filter((m) => m.type === 'list-sessions')).toHaveLength(2);
  });

  it('/resume opens the session sidebar instead of the "not available" line', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: listing('a') });
    act(() => result.current.setSessionSidebarOpen(false));
    act(() => result.current.send({ type: 'command', name: 'resume' }));

    deliver({ type: 'ui_intent', event: { intent: { type: 'show-session-picker' } } });
    deliver({ type: 'command_result', name: 'resume', message: 'Opening session picker...', success: true });

    expect(result.current.sessionSidebarOpen).toBe(true);
    expect(result.current.messages).toEqual([]);
  });

  it('/resume on a host that cannot list sessions still says so in the conversation', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({
      type: 'sessions_error',
      requestId: lastListRequest(wire),
      code: 'not_available',
      message: 'no directory',
    });
    act(() => result.current.send({ type: 'command', name: 'resume' }));
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-session-picker' } } });
    deliver({ type: 'command_result', name: 'resume', message: 'Opening session picker...', success: true });

    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'command',
      tone: 'info',
      content: expect.stringMatching(/cannot list sessions/),
    });
    // Never the generic "not available on this surface" line (#3282 §4e).
    const content = (result.current.messages.at(-1) as { content?: string }).content ?? '';
    expect(content).not.toMatch(/not available on this surface/i);
  });

  it('a refused switch surfaces its reason as a notice', () => {
    const { result, deliver } = setup();
    act(() => result.current.switchSession('b'));
    deliver({ type: 'protocol_error', message: 'Stop the running turn first.' });
    expect(result.current.sessionNotices.at(-1)).toMatchObject({
      kind: 'protocol-error',
      message: 'Stop the running turn first.',
    });
  });

  it('a refused switch is its own answer: it leaves a command in flight paired with its screen', () => {
    const { result, deliver } = setup();
    act(() => result.current.send({ type: 'command', name: 'agent' }));
    // A still-genuinely-unsupported intent: every intent with a real GUI screen (session picker,
    // settings, plugin manager, agent switcher) now suppresses the reply's conversation card by
    // design (#3282 §4), so this generic in-flight-pairing test needs one that still does not.
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-theme-picker' } } } as TServerMessage);
    act(() => result.current.switchSession('b'));
    deliver({ type: 'protocol_error', message: 'Stop the running turn first.' });
    // The refusal is a toast; the agent command still awaits its own reply.
    expect(result.current.sessionNotices.at(-1)).toMatchObject({ message: 'Stop the running turn first.' });
    expect(result.current.messages).toEqual([]);
    deliver({ type: 'command_result', name: 'agent', message: 'Opening agent switcher...', success: true });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'command', name: 'agent', tone: 'info' }),
    ]);
  });

  it("a switch drops the old session's status until the new one's arrives", () => {
    const { result, deliver } = setup();
    deliver({
      type: 'session_status',
      status: {
        sessionId: 'a',
        model: 'm',
        permissionMode: 'default',
        effort: 'auto',
        context: { usedPercentage: 1, usedTokens: 1, maxTokens: 100, remainingPercentage: 99 },
        goal: null,
      },
    } as TServerMessage);
    expect(result.current.sessionStatus).not.toBeNull();
    deliver({ type: 'session_switched', event: { sessionId: 'b' } });
    expect(result.current.sessionStatus).toBeNull();
  });

  it('does not ask to switch to the session that is already current', () => {
    const { result, deliver, connect, wire } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: listing('a') });
    act(() => result.current.switchSession('a'));
    expect(wire.some((m) => m.type === 'switch-session')).toBe(false);
  });
});

describe('#3189 step 5 — a refused session change and a pool-capable host', () => {
  it('session_change_failed shows the reason and answers the change, not a command', () => {
    const { result, wire, deliver } = setup();
    act(() => result.current.send({ type: 'command', name: 'agent' }));
    // A still-genuinely-unsupported intent: every intent with a real GUI screen (session picker,
    // settings, plugin manager, agent switcher) now suppresses the reply's conversation card by
    // design (#3282 §4), so this generic in-flight-pairing test needs one that still does not.
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-theme-picker' } } } as TServerMessage);
    act(() => result.current.switchSession('b'));
    deliver({
      type: 'session_change_failed',
      code: 'limit',
      message: 'Four sessions are live; close one first.',
      requestId: changeRequestId(wire, 0),
    });
    expect(result.current.sessionNotices.at(-1)).toMatchObject({
      message: 'Four sessions are live; close one first.',
    });
    // The in-flight change is answered: a later protocol error belongs to the command again.
    deliver({ type: 'protocol_error', message: 'agent failed' });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'command', name: 'theme', tone: 'info' }),
    ]);
  });

  it('ignores a session_change_failed answering a request it did not send', () => {
    const { result, wire, deliver } = setup();
    act(() => result.current.switchSession('b'));
    deliver({
      type: 'session_change_failed',
      code: 'limit',
      message: 'not mine',
      requestId: 'someone-else',
    });
    expect(result.current.sessionNotices).toEqual([]);
    deliver({
      type: 'session_change_failed',
      code: 'unknown_session',
      message: 'No such session.',
      requestId: changeRequestId(wire, 0),
    });
    expect(result.current.sessionNotices.map((n) => n.message)).toEqual(['No such session.']);
  });

  const liveListing = (currentSessionId: string) => ({
    ...listing(currentSessionId),
    sessions: listing(currentSessionId).sessions.map((row) => ({
      ...row,
      live: row.id === currentSessionId,
      clients: row.id === currentSessionId ? 1 : 0,
    })),
  });

  it('after a reconnect, returns to the session it switched to when the host keeps sessions live', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('a') });
    act(() => result.current.switchSession('b'));
    deliver({ type: 'session_switched', event: { sessionId: 'b' } });
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('b') });
    wire.length = 0;

    // The connection drops and comes back: the host puts a new connection on its primary session.
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('a') });

    expect(wire.filter((m) => m.type === 'switch-session')).toEqual([
      { type: 'switch-session', sessionId: 'b', requestId: expect.any(String) },
    ]);
    // Only once per reconnect: a later listing does not switch again.
    act(() => result.current.requestSessions());
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('a') });
    expect(wire.filter((m) => m.type === 'switch-session')).toHaveLength(1);
  });

  it('after a reconnect, stays where an older host puts it: its rows do not say live', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: listing('a') });
    act(() => result.current.switchSession('b'));
    deliver({ type: 'session_switched', event: { sessionId: 'b' } });
    wire.length = 0;

    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: listing('a') });

    expect(wire.some((m) => m.type === 'switch-session')).toBe(false);
  });

  it('a first connect switches nowhere', () => {
    const { wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('a') });
    expect(wire.some((m) => m.type === 'switch-session')).toBe(false);
  });
});

describe("#3280 §5 — remembering the session across a desktop Reconnect's reload", () => {
  const liveListing = (currentSessionId: string) => ({
    ...listing(currentSessionId),
    sessions: listing(currentSessionId).sessions.map((row) => ({
      ...row,
      live: row.id === currentSessionId,
      clients: row.id === currentSessionId ? 1 : 0,
    })),
  });
  const RESTORE_KEY = 'robota.restoreSessionId';

  it('a remembered id switches to it once the first listing lists it, then forgets it', () => {
    rememberSessionForRestore('b');
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('a') });

    expect(wire.filter((m) => m.type === 'switch-session')).toEqual([
      { type: 'switch-session', sessionId: 'b', requestId: expect.any(String) },
    ]);
    expect(window.sessionStorage.getItem(RESTORE_KEY)).toBeNull();

    // Spent on the first listing only: a later one does not switch again.
    act(() => result.current.requestSessions());
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('a') });
    expect(wire.filter((m) => m.type === 'switch-session')).toHaveLength(1);
  });

  it('a remembered id the listing does not include is not switched to, and is still forgotten', () => {
    rememberSessionForRestore('ghost');
    const { wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('a') });

    expect(wire.some((m) => m.type === 'switch-session')).toBe(false);
    expect(window.sessionStorage.getItem(RESTORE_KEY)).toBeNull();
  });

  it('a remembered id already current is not switched to, and is still forgotten', () => {
    rememberSessionForRestore('a');
    const { wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('a') });

    expect(wire.some((m) => m.type === 'switch-session')).toBe(false);
    expect(window.sessionStorage.getItem(RESTORE_KEY)).toBeNull();
  });

  it('a fresh launch with no remembered id switches nowhere', () => {
    const { wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: liveListing('a') });
    expect(wire.some((m) => m.type === 'switch-session')).toBe(false);
  });

  it('rememberSessionForRestore is best-effort: a storage failure does not throw', () => {
    const original = window.sessionStorage.setItem;
    window.sessionStorage.setItem = () => {
      throw new Error('storage disabled');
    };
    try {
      expect(() => rememberSessionForRestore('b')).not.toThrow();
    } finally {
      window.sessionStorage.setItem = original;
    }
  });
});

describe('#3289 §1 — renaming and deleting a row from the list', () => {
  it('sends rename-session on the wire and refreshes the listing once it lands', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: listing('a') });
    const before = wire.filter((m) => m.type === 'list-sessions').length;

    act(() => result.current.renameSessionInList('b', 'New name'));
    const rename = wire.filter((m) => m.type === 'rename-session').at(-1);
    if (rename?.type !== 'rename-session') throw new Error('expected a rename-session message');
    expect(rename).toEqual({ type: 'rename-session', sessionId: 'b', name: 'New name', requestId: rename.requestId });

    deliver({
      type: 'session_renamed_in_list',
      requestId: rename.requestId,
      sessionId: 'b',
      name: 'New name',
    });
    expect(wire.filter((m) => m.type === 'list-sessions').length).toBe(before + 1);
  });

  it('raises a notice when a rename is refused', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: listing('a') });
    act(() => result.current.renameSessionInList('nope', 'x'));
    const rename = wire.filter((m) => m.type === 'rename-session').at(-1);
    if (rename?.type !== 'rename-session') throw new Error('expected a rename-session message');

    deliver({
      type: 'session_rename_failed',
      requestId: rename.requestId,
      message: 'No session nope in this workspace.',
    });
    expect(result.current.sessionNotices.at(-1)).toMatchObject({
      message: 'No session nope in this workspace.',
    });
  });

  it('sends delete-session on the wire and refreshes the listing once it lands', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: listing('a') });
    const before = wire.filter((m) => m.type === 'list-sessions').length;

    act(() => result.current.deleteSession('b'));
    const del = wire.filter((m) => m.type === 'delete-session').at(-1);
    if (del?.type !== 'delete-session') throw new Error('expected a delete-session message');
    expect(del).toEqual({ type: 'delete-session', sessionId: 'b', requestId: del.requestId });

    deliver({ type: 'session_deleted', requestId: del.requestId, sessionId: 'b' });
    expect(wire.filter((m) => m.type === 'list-sessions').length).toBe(before + 1);
  });

  it('raises a notice with the refusal code’s reason when a delete is refused', () => {
    const { result, wire, connect, deliver } = setup();
    connect();
    deliver({ type: 'sessions', requestId: lastListRequest(wire), listing: listing('a') });
    act(() => result.current.deleteSession('b'));
    const del = wire.filter((m) => m.type === 'delete-session').at(-1);
    if (del?.type !== 'delete-session') throw new Error('expected a delete-session message');

    deliver({
      type: 'session_delete_failed',
      requestId: del.requestId,
      code: 'live_elsewhere',
      message: 'Another client is on this session.',
    });
    expect(result.current.sessionNotices.at(-1)).toMatchObject({
      message: 'Another client is on this session.',
    });
  });
});
