// @vitest-environment jsdom
/**
 * #3189 — the GUI reducer keeps the host's session list beside the conversation: it asks for it on
 * connect and whenever it may have changed, keeps only the latest answer, starts and switches
 * sessions through their wire messages, and re-reads everything the session shows after a switch.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

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
    expect(wire.map((m) => m.type)).toEqual(['get-commands', 'get-status', 'list-sessions']);
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
    expect(wire).toEqual([{ type: 'switch-session', sessionId: 'b' }, { type: 'new-session' }]);
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
      'list-sessions',
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
      content: expect.stringMatching(/session picker is not available/),
    });
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
    act(() => result.current.send({ type: 'command', name: 'settings' }));
    deliver({ type: 'ui_intent', event: { intent: { type: 'show-settings' } } } as TServerMessage);
    act(() => result.current.switchSession('b'));
    deliver({ type: 'protocol_error', message: 'Stop the running turn first.' });
    // The refusal is a toast; the settings command still awaits its own reply.
    expect(result.current.sessionNotices.at(-1)).toMatchObject({ message: 'Stop the running turn first.' });
    expect(result.current.messages).toEqual([]);
    deliver({ type: 'command_result', name: 'settings', message: 'Opening settings...', success: true });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'command', name: 'settings', tone: 'info' }),
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
