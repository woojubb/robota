// @vitest-environment jsdom
import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderHook } from '../../testing/product-provider.js';
import { useSessionClient } from '../useSessionClient.js';

import type { TSessionStatus } from '../session-client-types.js';
import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

const FORGOTTEN = '[forgotten]';

function status(sessionName?: string): TSessionStatus {
  return {
    sessionId: 'a',
    ...(sessionName === undefined ? {} : { sessionName }),
    model: 'fixture',
    permissionMode: 'default',
    effort: 'auto',
    context: {
      usedTokens: 10,
      maxTokens: 1000,
      usedPercentage: 1,
      remainingPercentage: 99,
    },
    goal: null,
  };
}

function snapshot(...lines: Array<['user' | 'assistant', string]>): TServerMessage {
  return {
    type: 'messages',
    messages: lines.map(([role, content], index) => ({
      id: `m${index}`,
      role,
      content,
      timestamp: new Date('2026-09-01T00:00:00.000Z'),
      state: 'complete' as const,
    })),
  } as unknown as TServerMessage;
}

function done(): TServerMessage {
  return {
    type: 'complete',
    result: { response: 'ok', toolSummaries: [], contextState: status().context },
  } as TServerMessage;
}

function setup() {
  let onMessage: ((message: TServerMessage) => void) | undefined;
  let onStatusChange: ((value: 'connected' | 'disconnected') => void) | undefined;
  const sent: TClientMessage[] = [];
  const makeClient: TMakeSessionClient = (callbacks) => {
    onMessage = callbacks.onMessage;
    onStatusChange = callbacks.onStatusChange;
    return { connect: () => {}, disconnect: () => {}, send: (message) => sent.push(message) };
  };
  const { result } = renderHook(() => useSessionClient(makeClient));
  const count = (type: TClientMessage['type']): number =>
    sent.filter((message) => message.type === type).length;
  return {
    result,
    count,
    deliver: (message: TServerMessage) => act(() => onMessage?.(message)),
    connection: (value: 'connected' | 'disconnected') => act(() => onStatusChange?.(value)),
    contents: () =>
      result.current.messages.flatMap((entry) =>
        'content' in entry && typeof entry.content === 'string' ? [entry.content] : [],
      ),
  };
}

afterEach(() => cleanup());

describe('a rewritten history', () => {
  it('re-reads the transcript and the status, and replaces what is shown', () => {
    const { result, deliver, count, contents } = setup();
    deliver(snapshot(['user', 'the vault code is 4471'], ['assistant', 'Noted.']));
    expect(contents()).toEqual(['the vault code is 4471', 'Noted.']);
    const before = { messages: count('get-messages'), status: count('get-status') };

    deliver({ type: 'history_changed', rewritten: true });
    expect(count('get-messages')).toBe(before.messages + 1);
    expect(count('get-status')).toBe(before.status + 1);

    deliver(snapshot(['user', `the vault code is ${FORGOTTEN}`], ['assistant', 'Noted.']));
    expect(contents()).toEqual([`the vault code is ${FORGOTTEN}`, 'Noted.']);
    expect(result.current.messages).toHaveLength(2);
  });

  it('shows the redacted session name from the status that answers', () => {
    const { result, deliver } = setup();
    deliver({ type: 'session_status', status: status('About 4471') });
    expect(result.current.sessionName).toBe('About 4471');
    deliver({ type: 'history_changed', rewritten: true });
    deliver({ type: 'session_status', status: status(`About ${FORGOTTEN}`) });
    expect(result.current.sessionName).toBe(`About ${FORGOTTEN}`);
    expect(result.current.sessionStatus?.sessionName).toBe(`About ${FORGOTTEN}`);
  });

  it('leaves an ordinary history change alone', () => {
    const { deliver, count } = setup();
    const before = { messages: count('get-messages'), status: count('get-status') };
    deliver({ type: 'history_changed' });
    deliver({ type: 'history_changed', rewritten: false });
    expect(count('get-messages')).toBe(before.messages);
    expect(count('get-status')).toBe(before.status);
  });

  it('keeps a streaming turn and reads the transcript once it ends, with no repeated rows', () => {
    const { result, deliver, count, contents } = setup();
    deliver(snapshot(['user', 'the vault code is 4471'], ['assistant', 'Noted.']));
    deliver({ type: 'user_message', content: 'and another thing' });
    deliver({ type: 'text_delta', delta: 'Working on ' });
    const readsBefore = count('get-messages');
    const statusBefore = count('get-status');

    deliver({ type: 'history_changed', rewritten: true });
    // The status refreshes now; the transcript waits for the turn.
    expect(count('get-messages')).toBe(readsBefore);
    expect(count('get-status')).toBe(statusBefore + 1);
    expect(result.current.streamingText).toBe('Working on ');

    deliver({ type: 'text_delta', delta: 'it.' });
    deliver(done());
    expect(result.current.streamingText).toBe('');
    expect(count('get-messages')).toBe(readsBefore + 1);

    // The snapshot taken after the turn replaces the transcript, holding every row exactly once.
    deliver(
      snapshot(
        ['user', `the vault code is ${FORGOTTEN}`],
        ['assistant', 'Noted.'],
        ['user', 'and another thing'],
        ['assistant', 'Working on it.'],
      ),
    );
    expect(contents()).toEqual([
      `the vault code is ${FORGOTTEN}`,
      'Noted.',
      'and another thing',
      'Working on it.',
    ]);

    // One read per rewrite: a later turn's end does not read again.
    deliver({ type: 'user_message', content: 'next' });
    deliver(done());
    expect(count('get-messages')).toBe(readsBefore + 1);
  });

  it('does not take a blocking command for a running turn', () => {
    const { deliver, count } = setup();
    // `/compact` is thinking, then not, with no turn frame at all.
    deliver({ type: 'thinking', isThinking: true });
    deliver({ type: 'thinking', isThinking: false });
    const reads = count('get-messages');
    deliver({ type: 'history_changed', rewritten: true });
    expect(count('get-messages')).toBe(reads + 1);
  });

  it('forgets an open turn and a waiting read when the connection drops', () => {
    const { deliver, count, connection } = setup();
    deliver({ type: 'user_message', content: 'work' });
    deliver({ type: 'history_changed', rewritten: true });
    const reads = count('get-messages');
    // The turn ends while the page is away; the reconnect reads the transcript itself.
    connection('disconnected');
    connection('connected');
    deliver({ type: 'history_changed', rewritten: true });
    expect(count('get-messages')).toBeGreaterThan(reads);
    const afterIdle = count('get-messages');
    // The old waiting read is gone: a later turn's end adds none.
    deliver({ type: 'user_message', content: 'next' });
    deliver(done());
    expect(count('get-messages')).toBe(afterIdle);
  });

  it('reads after an interrupted turn and drops the wait when the session changes', () => {
    const { deliver, count } = setup();
    deliver({ type: 'user_message', content: 'work' });
    deliver({ type: 'history_changed', rewritten: true });
    const reads = count('get-messages');
    deliver({ type: 'interrupted' } as TServerMessage);
    expect(count('get-messages')).toBe(reads + 1);

    deliver({ type: 'user_message', content: 'again' });
    deliver({ type: 'history_changed', rewritten: true });
    const afterSecond = count('get-messages');
    deliver({ type: 'session_switched', event: { sessionId: 'b' } });
    // The switch reads the new session's transcript itself; the old wait must not add a second read.
    expect(count('get-messages')).toBe(afterSecond + 1);
    deliver({ type: 'user_message', content: 'in b' });
    deliver(done());
    expect(count('get-messages')).toBe(afterSecond + 1);
  });
});
