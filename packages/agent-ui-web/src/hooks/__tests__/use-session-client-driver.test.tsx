// @vitest-environment jsdom
/**
 * #3289 §3 — `useSessionClient` learns this connection's own driver id from the first `messages`
 * frame the server sends (the only frame carrying it), and exposes it as `ownDriverId` so the GUI can
 * tell its own turns from a different kind of surface's.
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
  return {
    result,
    deliver: (msg) => {
      act(() => onMessage?.(msg));
    },
  };
}

describe('#3289 §3 — useSessionClient learns its own driver id from the first messages frame', () => {
  it('starts with no own driver id known', () => {
    const { result } = setup();
    expect(result.current.ownDriverId).toBeNull();
  });

  it('a messages frame carrying driverId sets ownDriverId', () => {
    const { result, deliver } = setup();
    deliver({ type: 'messages', messages: [], driverId: 'browser' });
    expect(result.current.ownDriverId).toBe('browser');
  });

  it('a messages frame with no driverId (an older host) leaves it unknown', () => {
    const { result, deliver } = setup();
    deliver({ type: 'messages', messages: [] });
    expect(result.current.ownDriverId).toBeNull();
  });

  it('a later messages frame does not un-learn an id already learned', () => {
    const { result, deliver } = setup();
    deliver({ type: 'messages', messages: [], driverId: 'app' });
    deliver({ type: 'messages', messages: [] });
    expect(result.current.ownDriverId).toBe('app');
  });
});
