// @vitest-environment jsdom
/**
 * #3289 §3 review — every screen `App` can show before (or instead of) `SessionView` renders exactly
 * one `main` landmark: nothing above `App` (agent-gui-web's `main.tsx`, or the desktop app) supplies
 * one. `CenteredChrome` (`@robota-sdk/agent-ui-web`) owns it for the starting, fatal and trust
 * screens — a `main` inside `CenteredChrome`'s content area, never inside the `role="alert"` /
 * `role="dialog"` wrappers `App`/`TrustQuestion` add around it (neither is itself a landmark, so
 * nesting a `main` in one is not the same class of bug as nesting `main` in `main`).
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';

import type { IGuiHost, IGuiTrustQuestion, TGuiHostState } from '../gui-host.js';

afterEach(cleanup);

function hostThatStops(): { host: IGuiHost; stop: () => void } {
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
  };
  return { host, stop: () => listener?.('fatal') };
}

function desktopHostAwaitingEndpoint(): IGuiHost {
  return {
    kind: 'desktop',
    getEndpoint: vi.fn(() => new Promise<string | null>(() => {})),
    signalReady: () => {},
    onState: () => () => {},
    onOpenSettings: () => () => {},
  };
}

const QUESTION: IGuiTrustQuestion = { folder: '/work/repo', loads: [] };

function desktopHostWithTrustQuestion(): IGuiHost {
  return {
    kind: 'desktop',
    getEndpoint: vi.fn(() => new Promise<string | null>(() => {})),
    signalReady: () => {},
    onState: () => () => {},
    trustQuestion: vi.fn(async () => QUESTION),
    answerTrust: vi.fn(async () => ({})),
    onOpenSettings: () => () => {},
  };
}

describe('App renders exactly one main landmark on every pre-session screen (#3289 §3 review)', () => {
  it('while starting (no endpoint yet)', async () => {
    const host = desktopHostAwaitingEndpoint();
    const { container } = render(<App host={host} />);
    await screen.findByText('Starting the agent…');
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });

  it('the fatal screen', () => {
    const { host, stop } = hostThatStops();
    const { container } = render(<App host={host} />);
    act(() => stop());
    expect(screen.getByRole('alert').textContent).toContain('The agent process stopped');
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });

  it('the trust question', async () => {
    const host = desktopHostWithTrustQuestion();
    const { container } = render(<App host={host} />);
    await screen.findByRole('dialog', { name: 'Do you trust this folder?' });
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});
