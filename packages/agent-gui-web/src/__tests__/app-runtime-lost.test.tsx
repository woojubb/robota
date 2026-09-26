// @vitest-environment jsdom
/**
 * #3189 — the daemon can stop while the window is open (`robota daemon stop`, a crash). Once the page's
 * connection runs out of retries, a desktop host says the runtime stopped and offers to reconnect; a
 * browser host, which cannot restart it, keeps the session surface with its disconnected status.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';

import type { IGuiHost } from '../gui-host.js';

const connection = vi.hoisted(() => ({ lose: (): void => {} }));

vi.mock('@robota-sdk/agent-ui-web/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-ui-web/client')>();
  return {
    ...actual,
    useWsSession: (_url: string, options: { onConnectionLost?: () => void } = {}) => {
      connection.lose = () => options.onConnectionLost?.();
      return { status: 'disconnected' };
    },
    SessionSurface: () => <div>session surface</div>,
  };
});

afterEach(cleanup);

function host(kind: IGuiHost['kind'], restartRuntime?: () => Promise<void>): IGuiHost {
  return {
    kind,
    getEndpoint: async () => 'ws://127.0.0.1:1?token=t',
    signalReady: () => {},
    onState: () => () => {},
    ...(restartRuntime ? { restartRuntime } : {}),
  };
}

describe('a runtime lost while attached', () => {
  it('desktop: shows that the runtime stopped, and Reconnect asks the host to restart it', async () => {
    const restartRuntime = vi.fn(() => new Promise<void>(() => {}));
    render(<App host={host('desktop', restartRuntime)} />);
    await screen.findByText('session surface');

    act(() => connection.lose());

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The agent process stopped');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(restartRuntime).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Reconnecting…' }).hasAttribute('disabled')).toBe(true);
  });

  it('desktop: a restart the host could not ask for lets the owner try again', async () => {
    const restartRuntime = vi.fn(async () => {
      throw new Error('the shell did not answer');
    });
    render(<App host={host('desktop', restartRuntime)} />);
    await screen.findByText('session surface');
    act(() => connection.lose());

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('the shell did not answer'));
    expect(screen.getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(false);
  });

  it('browser: keeps the session surface, with no reconnect action', async () => {
    render(<App host={host('browser')} />);
    await screen.findByText('session surface');

    act(() => connection.lose());

    expect(screen.getByText('session surface')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
  });
});
