// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { App } from '../App.js';
import { testProduct } from './product-fixture.js';
import type { IGuiHost, TGuiHostState } from '../gui-host.js';

const ws = vi.hoisted(() => vi.fn(() => ({ status: 'connected', connectionLost: false, openSettings: () => {} })));
vi.mock('@robota-sdk/agent-ui-web/client', async (load) => ({
  ...await load<typeof import('@robota-sdk/agent-ui-web/client')>(),
  useWsSession: ws,
  SessionSurface: () => <div>connected surface</div>,
}));
afterEach(() => { cleanup(); ws.mockClear(); });

function host(overrides: Partial<IGuiHost> = {}): IGuiHost {
  return { kind: 'desktop', getEndpoint: async () => 'ws://fixture', signalReady: () => {},
    onState: () => () => {}, onOpenSettings: () => () => {}, ...overrides };
}

it('does not reuse an old endpoint while the same host awaits a new trust decision', async () => {
  let checks = 0;
  const a = host({ trustQuestion: () => ++checks === 1 ? Promise.resolve(null) : new Promise(() => {}) });
  const b = host({ trustQuestion: () => new Promise(() => {}) });
  const view = render(<App host={a} product={testProduct} />);
  await screen.findByText('connected surface');
  expect(ws).toHaveBeenCalledTimes(1);
  view.rerender(<App host={b} product={testProduct} />);
  view.rerender(<App host={a} product={testProduct} />);
  expect(checks).toBe(2);
  expect(screen.queryByText('connected surface')).toBeNull();
  expect(ws).toHaveBeenCalledTimes(1);
});

it('does not reuse an old trust question when the same host is selected again', async () => {
  let checks = 0;
  const a = host({ trustQuestion: () => ++checks === 1 ? Promise.resolve({ folder: '/old', loads: [] }) : new Promise(() => {}), answerTrust: async () => ({}) });
  const b = host({ trustQuestion: () => new Promise(() => {}) });
  const view = render(<App host={a} product={testProduct} />);
  await screen.findByRole('dialog');
  view.rerender(<App host={b} product={testProduct} />);
  view.rerender(<App host={a} product={testProduct} />);
  expect(checks).toBe(2);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not reuse an old fatal state when the same host is selected again', async () => {
  let emit = (_state: TGuiHostState, _detail?: string): void => {};
  const a = host({ getEndpoint: () => new Promise(() => {}), onState: (listener) => { emit = listener; return () => {}; } });
  const b = host({ getEndpoint: () => new Promise(() => {}) });
  const view = render(<App host={a} product={testProduct} />);
  act(() => emit('fatal', 'Old failure'));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Old failure'));
  view.rerender(<App host={b} product={testProduct} />);
  view.rerender(<App host={a} product={testProduct} />);
  expect(screen.queryByRole('alert')).toBeNull();
});
