// @vitest-environment jsdom
/**
 * #3186 — a sidecar that stops says why. The desktop host passes the tail of the sidecar's error
 * output with the fatal state; an untrusted workspace, for one, names the command that fixes it.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../App.js';

import type { IGuiHost, TGuiHostState } from '../gui-host.js';

afterEach(cleanup);

function hostThatStops(detail?: string): { host: IGuiHost; stop: () => void } {
  let listener: ((state: TGuiHostState, detail?: string) => void) | null = null;
  const host: IGuiHost = {
    kind: 'desktop',
    getEndpoint: () => new Promise(() => {}),
    signalReady: () => {},
    onState: (next) => {
      listener = next;
      return () => {};
    },
  };
  return { host, stop: () => listener?.('fatal', detail) };
}

describe('the fatal screen', () => {
  it("shows what the sidecar said before it stopped", () => {
    const { host, stop } = hostThatStops(
      'Workspace trust is required before headless startup (state: untrusted).\nGrant access with: robota trust --yes',
    );
    render(<App host={host} />);
    act(() => stop());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('The agent process stopped');
    expect(alert.textContent).toContain('robota trust --yes');
  });

  it('keeps the plain message when the sidecar said nothing', () => {
    const { host, stop } = hostThatStops();
    render(<App host={host} />);
    act(() => stop());
    expect(screen.getByRole('alert').textContent).toContain('Restart the app to reconnect');
  });
});
