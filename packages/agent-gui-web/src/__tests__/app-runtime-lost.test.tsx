// @vitest-environment jsdom
/**
 * #3280 §5 — a lost connection must not take the person out of their session. The banner and its
 * Reconnect button are `SessionSurface`'s own concern (tested in `agent-ui-web` and in
 * `session-surface.test.tsx`); this file tests only what `App`/`SessionView` are responsible for: the
 * conversation stays mounted through a connection loss (no full-screen replacement, no branch here),
 * a desktop host's `onReconnect` remembers the current session before restarting the runtime, and a
 * browser host (no `restartRuntime`) gets no `onReconnect` at all.
 */

import { testProduct } from './product-fixture.js';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';

import type { IGuiHost } from '../gui-host.js';

const connection = vi.hoisted(() => ({ giveUp: (): void => {} }));

vi.mock('@robota-sdk/agent-ui-web/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-ui-web/client')>();
  return {
    ...actual,
    // A stand-in reducer: it tracks its own `connectionLost` bit (as the real `useWsSession` does)
    // so a test can drive it, and reports a fixed current session for `onReconnect` to remember.
    useWsSession: (_url: string) => {
      const [connectionLost, setConnectionLost] = React.useState(false);
      connection.giveUp = () => setConnectionLost(true);
      return {
        status: connectionLost ? 'disconnected' : 'connected',
        connectionLost,
        sessionListing: { currentSessionId: 'sess-1', sessions: [{ id: 'sess-1' }] },
      };
    },
    // A stand-in surface: renders what App gave it, so a test can see + drive `onReconnect` without
    // depending on the real banner's markup (that markup is `agent-ui-web`'s own test surface).
    SessionSurface: ({ onReconnect }: { onReconnect?: () => Promise<void> }) => (
      <div>
        session surface
        {onReconnect ? (
          <button onClick={() => void onReconnect()}>Reconnect</button>
        ) : null}
      </div>
    ),
  };
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function host(kind: IGuiHost['kind'], restartRuntime?: () => Promise<void>): IGuiHost {
  return {
    kind,
    getEndpoint: async () => 'ws://127.0.0.1:1?token=t',
    signalReady: () => {},
    onState: () => () => {},
    onOpenSettings: () => () => {},
    ...(restartRuntime ? { restartRuntime } : {}),
  };
}

describe('#3280 §5 — a connection lost while attached', () => {
  it('the session surface stays mounted through a connection loss (no full-screen replacement)', async () => {
    render(<App product={testProduct} host={host('desktop', vi.fn())} />);
    await screen.findByText('session surface');

    act(() => connection.giveUp());

    expect(screen.getByText('session surface')).toBeTruthy();
  });

  it('desktop: passes a Reconnect action that remembers the current session, then restarts the runtime', async () => {
    const restartRuntime = vi.fn(() => new Promise<void>(() => {}));
    render(<App product={testProduct} host={host('desktop', restartRuntime)} />);
    await screen.findByText('session surface');
    act(() => connection.giveUp());

    expect(window.sessionStorage.getItem('test-product.restoreSessionId')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(window.sessionStorage.getItem('test-product.restoreSessionId')).toBe('sess-1');
    expect(restartRuntime).toHaveBeenCalledTimes(1);
  });

  it('browser: no restartRuntime means no Reconnect action at all', async () => {
    render(<App product={testProduct} host={host('browser')} />);
    await screen.findByText('session surface');

    act(() => connection.giveUp());

    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });
});
