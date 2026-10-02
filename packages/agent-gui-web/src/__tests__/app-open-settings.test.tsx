// @vitest-environment jsdom
/**
 * #3282 §4a — the desktop app's ⌘,/Ctrl+, menu item reaches the same `openSettings` the sidebar's
 * gear button calls. `App`/`SessionView`'s only job here is the subscription: `SessionSurface`
 * itself (tested in `agent-ui-web`) owns the Settings screen and its gear button.
 */

import { testProduct } from './product-fixture.js';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';

import type { IGuiHost } from '../gui-host.js';

const openSettings = vi.fn();

vi.mock('@robota-sdk/agent-ui-web/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-ui-web/client')>();
  return {
    ...actual,
    useWsSession: () => ({ status: 'connected', connectionLost: false, openSettings }),
    SessionSurface: () => <div>session surface</div>,
  };
});

afterEach(() => {
  cleanup();
  openSettings.mockClear();
});

function hostWithMenu(): {
  host: IGuiHost;
  triggerMenu: () => void;
  subscribed: () => boolean;
} {
  let listener: (() => void) | null = null;
  const host: IGuiHost = {
    kind: 'desktop',
    getEndpoint: async () => 'ws://127.0.0.1:1?token=t',
    signalReady: () => {},
    onState: () => () => {},
    onOpenSettings: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
  };
  return { host, triggerMenu: () => listener?.(), subscribed: () => listener !== null };
}

describe('#3282 §4a — the App menu opens Settings through the same handle as the gear', () => {
  it('the menu item calls openSettings once the session is live', async () => {
    const { host, triggerMenu, subscribed } = hostWithMenu();
    render(<App product={testProduct} host={host} />);
    await screen.findByText('session surface');
    // The surface can be on screen before the effect that subscribes to the menu has run.
    await waitFor(() => expect(subscribed()).toBe(true));

    act(() => triggerMenu());

    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('a browser host (no menu) never calls openSettings on its own', async () => {
    const host: IGuiHost = {
      kind: 'browser',
      getEndpoint: async () => 'ws://127.0.0.1:1?token=t',
      signalReady: () => {},
      onState: () => () => {},
      onOpenSettings: () => () => {},
    };
    render(<App product={testProduct} host={host} />);
    await screen.findByText('session surface');
    expect(openSettings).not.toHaveBeenCalled();
  });
});
