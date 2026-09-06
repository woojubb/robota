// @vitest-environment jsdom
/**
 * CMD-004 Phase 2 Stage E — the GUI reducer folds the broadcast session events.
 *
 * `session_renamed` updates the surface's session name (co-driving titles follow the host rename);
 * `history_cleared` empties the reconstructed transcript (a clear performed by ANY surface refreshes
 * this one). Red-first: pre-Stage-E the reducer had no case for either message — the name never
 * existed and a cleared conversation stayed rendered.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TMakeSessionClient } from '../useSessionClient.js';
import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

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
  return {
    result,
    deliver: (msg) => {
      act(() => onMessage?.(msg));
    },
  };
}

describe('CMD-004 Stage E — GUI folds the broadcast session events', () => {
  it('session_renamed updates the exposed session name', () => {
    const { result, deliver } = setup();
    expect(result.current.sessionName).toBeNull();

    deliver({ type: 'session_renamed', event: { name: 'Renamed From Anywhere' } });

    expect(result.current.sessionName).toBe('Renamed From Anywhere');
  });

  it('history_cleared empties the transcript', () => {
    const { result, deliver } = setup();
    deliver({ type: 'user_message', content: 'hello' });
    deliver({ type: 'text_delta', delta: 'partial answer' });
    deliver({ type: 'complete', result: { response: 'partial answer' } } as TServerMessage);
    expect(result.current.messages.length).toBeGreaterThan(0);

    deliver({ type: 'history_cleared' });

    expect(result.current.messages).toEqual([]);
    expect(result.current.streamingText).toBe('');
  });

  it('ARCH-2164: a session error finalizes partial text, fails tools, and becomes visible', () => {
    const { result, deliver } = setup();
    deliver({
      type: 'tool_start',
      state: { toolName: 'Read', isRunning: true } as never,
    });
    deliver({ type: 'text_delta', delta: 'partial' });
    deliver({ type: 'error', message: 'provider failed' });

    expect(result.current.streamingText).toBe('');
    expect(result.current.messages.at(-1)?.content).toBe('partial');
    expect(result.current.activeTools[0]?.status).toBe('error');
    expect(result.current.sessionNotices.at(-1)).toMatchObject({
      kind: 'session-error',
      message: 'provider failed',
    });
  });

  it('ARCH-2164: requests and receives the existing current-session usage report', () => {
    let onMessage: ((msg: TServerMessage) => void) | null = null;
    const wire: import('@robota-sdk/agent-transport-protocol').TClientMessage[] = [];
    const makeClient: TMakeSessionClient = (callbacks) => {
      onMessage = callbacks.onMessage;
      return {
        connect: () => {},
        disconnect: () => {},
        send: (message) => wire.push(message),
      };
    };
    const { result } = renderHook(() => useSessionClient(makeClient));

    act(() => result.current.requestCurrentSessionUsage());
    expect(wire).toContainEqual({ type: 'get-usage-report' });
    act(() =>
      onMessage?.({
        type: 'usage_report',
        report: {
          sessionId: 'current',
          totalTokens: 7,
          promptTokens: 5,
          completionTokens: 2,
          costUsd: 0,
          costExact: false,
          bySource: [],
          timeline: [],
        },
      }),
    );
    expect(result.current.currentSessionUsageStatus).toBe('ready');
    expect(result.current.currentSessionUsageReport?.totalTokens).toBe(7);
  });
});

describe('SCREEN-2577 — personal usage request correlation', () => {
  it('keeps the latest request when replies arrive out of order', () => {
    let onMessage: ((msg: TServerMessage) => void) | null = null;
    const sent: Parameters<TMakeSessionClient>[0][] = [];
    const wire: import('@robota-sdk/agent-transport-protocol').TClientMessage[] = [];
    const makeClient: TMakeSessionClient = (callbacks) => {
      onMessage = callbacks.onMessage;
      sent.push(callbacks);
      return {
        connect: () => {},
        disconnect: () => {},
        send: (message) => wire.push(message),
      };
    };
    const { result } = renderHook(() => useSessionClient(makeClient));

    act(() => result.current.requestPersonalUsage('7d'));
    act(() => result.current.requestPersonalUsage('30d'));
    const first = wire[0];
    const second = wire[1];
    if (
      first?.type !== 'get-personal-usage-report' ||
      second?.type !== 'get-personal-usage-report'
    ) {
      throw new Error('expected personal usage requests');
    }
    const baseReport = {
      schemaVersion: 1 as const,
      generatedAt: '2026-09-06T03:00:00.000Z',
      timezone: 'UTC',
      interval: { startDate: '2026-08-08', endDate: '2026-09-06' },
      totals: {
        sessions: 0,
        turns: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        costStatus: 'exact' as const,
      },
      daily: [],
      byModel: [],
      byProvider: [],
      bySurface: [],
      bySource: [],
      byActivity: [],
      sessionIds: [],
      coverage: {
        validSessions: 0,
        corruptSessions: 0,
        unsupportedSessions: 0,
        duplicateObservations: 0,
        legacyObservations: 0,
        unknownModelObservations: 0,
        unknownProviderObservations: 0,
        unknownSurfaceObservations: 0,
        corruptSessionIds: [],
        unsupportedSessionIds: [],
      },
    };

    act(() =>
      onMessage?.({
        type: 'personal_usage_report',
        requestId: second.requestId,
        report: { ...baseReport, period: '30d' },
      }),
    );
    act(() =>
      onMessage?.({
        type: 'personal_usage_report',
        requestId: first.requestId,
        report: { ...baseReport, period: '7d' },
      }),
    );

    expect(sent).toHaveLength(1);
    expect(result.current.personalUsageStatus).toBe('ready');
    expect(result.current.personalUsageReport?.period).toBe('30d');
  });

  it('correlates a stored-session drill-down and exposes the existing trace report', () => {
    let onMessage: ((msg: TServerMessage) => void) | null = null;
    const wire: import('@robota-sdk/agent-transport-protocol').TClientMessage[] = [];
    const makeClient: TMakeSessionClient = (callbacks) => {
      onMessage = callbacks.onMessage;
      return {
        connect: () => {},
        disconnect: () => {},
        send: (message) => wire.push(message),
      };
    };
    const { result } = renderHook(() => useSessionClient(makeClient));

    act(() => result.current.requestStoredSessionUsage('session-1'));
    const request = wire[0];
    if (request?.type !== 'get-stored-session-usage-report') {
      throw new Error('expected a stored-session usage request');
    }
    act(() =>
      onMessage?.({
        type: 'stored_session_usage_report',
        requestId: request.requestId,
        sessionId: 'session-1',
        report: {
          sessionId: 'session-1',
          totalTokens: 25,
          promptTokens: 20,
          completionTokens: 5,
          costUsd: 0.01,
          costExact: true,
          bySource: [],
          timeline: [],
        },
      }),
    );

    expect(result.current.storedSessionUsageStatus).toBe('ready');
    expect(result.current.storedSessionUsageReport?.totalTokens).toBe(25);
  });
});
