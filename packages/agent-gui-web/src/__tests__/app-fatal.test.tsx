// @vitest-environment jsdom
/**
 * #3186 — a sidecar that stops says why. The desktop host passes the tail of the sidecar's error
 * output with the fatal state; an untrusted workspace, for one, names the command that fixes it.
 */

import { testProduct } from './product-fixture.js';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';

import type { IGuiHost, TGuiHostState } from '../gui-host.js';

afterEach(cleanup);

function hostThatStops(
  detail?: string,
  restartRuntime?: () => Promise<void>,
): { host: IGuiHost; stop: () => void } {
  let listener: ((state: TGuiHostState, detail?: string) => void) | null = null;
  const host: IGuiHost = {
    kind: 'desktop',
    getEndpoint: () => new Promise(() => {}),
    signalReady: () => {},
    onState: (next) => {
      listener = next;
      return () => {};
    },
    onOpenSettings: () => () => {},
    ...(restartRuntime ? { restartRuntime } : {}),
  };
  return { host, stop: () => listener?.('fatal', detail) };
}

describe('the fatal screen', () => {
  it("shows what the sidecar said before it stopped", () => {
    const { host, stop } = hostThatStops(
      'Workspace trust is required before headless startup (state: untrusted).\nGrant access with: fixture-agent trust --yes',
    );
    render(<App product={testProduct} host={host} />);
    act(() => stop());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The agent process stopped');
    expect(alert.textContent).toContain('fixture-agent trust --yes');
  });

  it('keeps the plain message when the sidecar said nothing', () => {
    const { host, stop } = hostThatStops();
    render(<App product={testProduct} host={host} />);
    act(() => stop());
    expect(screen.getByRole('alert').textContent).toContain('Restart the app to reconnect');
  });

  it('#3282 §3: a Try again button reuses the restart flow, and shows a failure if it does not take', async () => {
    const restartRuntime = vi.fn(async () => {
      throw new Error('the daemon refused to start');
    });
    const { host, stop } = hostThatStops('No provider configuration found.', restartRuntime);
    render(<App product={testProduct} host={host} />);
    act(() => stop());

    const button = screen.getByRole('button', { name: 'Try again' });
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Trying again…' }).hasAttribute('disabled')).toBe(true);
    expect(restartRuntime).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('the daemon refused to start'),
    );
    expect(screen.getByRole('button', { name: 'Try again' }).hasAttribute('disabled')).toBe(false);
  });
});
