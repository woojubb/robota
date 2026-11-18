// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { usePageNotifications } from '../notifications.js';
import type { IPersonalApi } from '../api.js';

afterEach(() => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('a push notification opened on an existing page', () => {
  it('works when the browser exposes no service worker', () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined });
    const api = {
      notifications: async () => ({ latest: 0, messages: [] }),
      feed: async () => [],
    } as unknown as IPersonalApi;
    const hook = renderHook(() => usePageNotifications(api, vi.fn()));
    hook.unmount();
  });
  it('opens the feed on the worker message and stops listening on unmount', async () => {
    const serviceWorker = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
    const open = vi.fn();
    const api = {
      notifications: async () => ({ latest: 0, messages: [] }),
      feed: async () => [],
    } as unknown as IPersonalApi;
    const hook = renderHook(() => usePageNotifications(api, open));
    await act(async () => {
      serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'other' } }));
    });
    expect(open).not.toHaveBeenCalled();
    const reply = { postMessage: vi.fn(), close: vi.fn() } as unknown as MessagePort;
    await act(async () => {
      serviceWorker.dispatchEvent(
        new MessageEvent('message', { data: { type: 'open-feed' }, ports: [reply] }),
      );
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(reply.postMessage).toHaveBeenCalledWith('opened');
    expect(reply.close).toHaveBeenCalledTimes(1);
    hook.unmount();
    await act(async () => {
      serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open-feed' } }));
    });
    expect(open).toHaveBeenCalledTimes(1);
  });
});
