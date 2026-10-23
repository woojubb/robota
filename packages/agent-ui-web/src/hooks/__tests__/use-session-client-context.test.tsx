// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionNotices } from '../../components/SessionSurfaceChrome.js';
import { render, renderHook } from '../../testing/product-provider.js';
import { useSessionClient } from '../useSessionClient.js';

import type { TSessionStatus } from '../session-client-types.js';
import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

function context(usedPercentage: number): TSessionStatus['context'] {
  return {
    usedTokens: usedPercentage * 10,
    maxTokens: 1000,
    usedPercentage,
    remainingPercentage: 100 - usedPercentage,
  };
}

function status(usedPercentage: number, sessionId = 'a'): TSessionStatus {
  return {
    sessionId,
    model: 'fixture',
    permissionMode: 'default',
    effort: 'auto',
    context: context(usedPercentage),
    goal: null,
  };
}

const compacted = {
  type: 'history_changed',
  compact: { trigger: 'auto', beforeUsedPercentage: 91.2, afterUsedPercentage: 20.4 },
} as const;

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
  return {
    result,
    sent,
    deliver: (message: TServerMessage) => act(() => onMessage?.(message)),
    connection: (value: 'connected' | 'disconnected') => act(() => onStatusChange?.(value)),
  };
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('live context and successful automatic compaction', () => {
  it('updates context before the turn completes without losing streamed text or tool cards', () => {
    const { result, deliver, sent } = setup();
    deliver({ type: 'session_status', status: status(80) });
    deliver({ type: 'user_message', content: 'continue working' });
    deliver({ type: 'text_delta', delta: 'Before compact. ' });
    deliver({
      type: 'tool_start',
      state: { toolName: 'Read', firstArg: 'file.ts', executionId: 'read-1', isRunning: true },
    });
    deliver({
      type: 'tool_end',
      state: {
        toolName: 'Read',
        firstArg: 'file.ts',
        executionId: 'read-1',
        isRunning: false,
        result: 'success',
      },
    });
    deliver({ type: 'context', state: context(91.2) });
    expect(result.current.sessionStatus?.context).toEqual(context(91.2));
    deliver(compacted);
    deliver({ type: 'context', state: context(20.4) });
    expect(result.current.sessionStatus?.context).toEqual(context(20.4));
    expect(result.current.streamingText).toBe('Before compact. ');
    expect(result.current.activeTools).toEqual([
      expect.objectContaining({ executionId: 'read-1', status: 'done' }),
    ]);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'continue working' }),
    ]);
    expect(result.current.sessionNotices).toEqual([
      expect.objectContaining({
        kind: 'context-compacted',
        message: 'Auto compacted context: 91% → 20%',
      }),
    ]);
    expect(sent.some((message) => message.type === 'get-messages')).toBe(false);
    deliver({ type: 'text_delta', delta: 'After compact.' });
    deliver({
      type: 'complete',
      result: {
        response: 'Before compact. After compact.',
        toolSummaries: [],
        contextState: context(20.4),
      },
    });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({ role: 'assistant', content: 'Before compact. ' }),
      expect.objectContaining({
        role: 'tools',
        tools: [expect.objectContaining({ executionId: 'read-1', status: 'done' })],
      }),
      expect.objectContaining({ role: 'assistant', content: 'After compact.' }),
    ]);
  });

  it('honors later status snapshots and never assigns the old context to a switched session', () => {
    const { result, deliver } = setup();
    deliver({ type: 'context', state: context(90) });
    expect(result.current.sessionStatus).toBeNull();
    deliver({ type: 'session_status', status: status(30) });
    expect(result.current.sessionStatus?.context).toEqual(context(30));
    deliver({ type: 'context', state: context(60) });
    deliver({ type: 'session_status', status: { ...status(15), model: 'larger-window' } });
    expect(result.current.sessionStatus).toMatchObject({
      model: 'larger-window',
      context: context(15),
    });
    deliver({ type: 'session_switched', event: { sessionId: 'b' } });
    deliver({ type: 'context', state: context(50) });
    expect(result.current.sessionStatus).toBeNull();
    deliver({ type: 'session_status', status: status(5, 'b') });
    expect(result.current.sessionStatus).toMatchObject({ sessionId: 'b', context: context(5) });
    deliver({ type: 'context', state: context(6) });
    expect(result.current.sessionStatus?.context).toEqual(context(6));
  });

  it('announces only an actual automatic completion, without treating it as an error', () => {
    const { result, deliver } = setup();
    deliver({ type: 'history_changed' });
    deliver({ ...compacted, compact: { ...compacted.compact, trigger: 'manual' } });
    deliver({ type: 'context', state: context(10) });
    expect(result.current.sessionNotices).toEqual([]);
    deliver(compacted);
    render(<SessionNotices state={result.current} />);
    expect(screen.getByRole('status').textContent).toContain('Auto compacted context: 91% → 20%');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').querySelector('.bg-destructive')).toBeNull();
    act(() => result.current.dismissSessionNotice(result.current.sessionNotices[0]!.id));
    expect(result.current.sessionNotices).toEqual([]);
  });

  it.each(['switch', 'clear', 'disconnect'] as const)(
    'drops an old completion notice on %s',
    (transition) => {
      const { result, deliver, connection } = setup();
      deliver(compacted);
      expect(result.current.sessionNotices).toHaveLength(1);
      if (transition === 'switch') deliver({ type: 'session_switched', event: { sessionId: 'b' } });
      else if (transition === 'clear') deliver({ type: 'history_cleared' });
      else connection('disconnected');
      expect(result.current.sessionNotices).toEqual([]);
    },
  );
});
