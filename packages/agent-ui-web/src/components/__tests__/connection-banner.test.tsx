// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectionBanner } from '../SessionSurfaceChrome.js';

/**
 * #3280 §5 — the connection banner shown directly above the conversation, in place of the silent
 * period a lost connection used to leave: nothing while the first connect is still in progress
 * (nothing has been lost yet), "reconnecting" once a working connection drops, and once retries give
 * up either a working Reconnect (a host that can restart the runtime) or the browser's restart
 * instructions — never a full-screen replacement.
 */

afterEach(cleanup);

describe('ConnectionBanner', () => {
  it('shows nothing during the very first connect: nothing has been lost yet', () => {
    render(<ConnectionBanner status="connecting" connectionLost={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows nothing while connected', () => {
    render(<ConnectionBanner status="connected" connectionLost={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says "Reconnecting…" once a working connection drops', () => {
    const { rerender } = render(<ConnectionBanner status="connected" connectionLost={false} />);
    rerender(<ConnectionBanner status="connecting" connectionLost={false} />);

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Connection lost. Reconnecting…');
  });

  it('clears the banner again once reconnected', () => {
    const { rerender } = render(<ConnectionBanner status="connected" connectionLost={false} />);
    rerender(<ConnectionBanner status="disconnected" connectionLost={false} />);
    expect(screen.getByRole('status')).toBeTruthy();

    rerender(<ConnectionBanner status="connected" connectionLost={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('once retries give up, a desktop host (onReconnect present) gets "Robota stopped." and a working Reconnect', async () => {
    const onReconnect = vi.fn(() => Promise.resolve());
    render(
      <ConnectionBanner status="disconnected" connectionLost onReconnect={onReconnect} />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Robota stopped.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Reconnect' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('disables Reconnect while it is pending, and re-enables on failure with the reason shown', async () => {
    let reject!: (error: Error) => void;
    const onReconnect = vi.fn(
      () =>
        new Promise<void>((_resolve, rej) => {
          reject = rej;
        }),
    );
    render(<ConnectionBanner status="disconnected" connectionLost onReconnect={onReconnect} />);
    const alert = screen.getByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Reconnect' }));

    const pending = within(alert).getByRole('button', { name: 'Reconnecting…' });
    expect(pending.hasAttribute('disabled')).toBe(true);

    reject(new Error('the shell did not answer'));
    await waitFor(() => expect(alert.textContent).toContain('the shell did not answer'));
    expect(within(alert).getByRole('button', { name: 'Reconnect' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('once retries give up, a browser host (no onReconnect) shows how to reopen it, with no button', () => {
    render(<ConnectionBanner status="disconnected" connectionLost />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Robota stopped.');
    expect(alert.textContent).toContain('robota --serve --open');
    expect(within(alert).queryByRole('button')).toBeNull();
  });

  it('give-up wins even on a first connect that never succeeded', () => {
    render(<ConnectionBanner status="disconnected" connectionLost />);
    expect(screen.getByRole('alert').textContent).toContain('Robota stopped.');
  });
});
