// @vitest-environment jsdom
/**
 * #3280 §2 — a prompt the host queued behind a running turn is reducer state (`queuedPrompt`), not
 * `'intentionally-not-rendered'`: the composer shows it, and it clears once the server reports
 * `pending: null`.
 */

import { renderHook } from '../../testing/product-provider.js';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSessionClient } from '../useSessionClient.js';

import type { TMakeSessionClient } from '../useSessionClient.js';
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

describe('#3280 §2 — the queued-message reducer state', () => {
  it('starts with nothing queued', () => {
    const { result } = setup();
    expect(result.current.queuedPrompt).toBeNull();
  });

  it('a pending frame with text sets the queued prompt and its count', () => {
    const { result, deliver } = setup();
    deliver({ type: 'pending', pending: 'follow-up question', pendingCount: 1 });
    expect(result.current.queuedPrompt).toEqual({ text: 'follow-up question', count: 1 });
  });

  it('a missing pendingCount defaults to 1 (the shown prompt itself)', () => {
    const { result, deliver } = setup();
    deliver({ type: 'pending', pending: 'follow-up question' } as TServerMessage);
    expect(result.current.queuedPrompt).toEqual({ text: 'follow-up question', count: 1 });
  });

  it('pending: null clears the queued prompt', () => {
    const { result, deliver } = setup();
    deliver({ type: 'pending', pending: 'follow-up question', pendingCount: 2 });
    expect(result.current.queuedPrompt).not.toBeNull();
    deliver({ type: 'pending', pending: null });
    expect(result.current.queuedPrompt).toBeNull();
  });

  it('a session switch drops the previous session\'s queued prompt', () => {
    const { result, deliver } = setup();
    deliver({ type: 'pending', pending: 'follow-up question', pendingCount: 1 });
    deliver({
      type: 'session_switched',
      event: { sessionId: 'other' },
    } as unknown as TServerMessage);
    expect(result.current.queuedPrompt).toBeNull();
  });
});
