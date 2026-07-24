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
});
