// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopSessionClient } from '../../../agent-ui-web/src/client/desktop-session-client.js';
import { App } from '../App.js';
import { testProduct } from './product-fixture.js';

import type { IGuiHost } from '../gui-host.js';
import type { IWsSessionState, TMakeSessionClient } from '@robota-sdk/agent-ui-web/client';

vi.mock('@robota-sdk/agent-ui-web/client', async (load) => {
  const actual = await load<typeof import('@robota-sdk/agent-ui-web/client')>();
  return {
    ...actual,
    SessionSurface: ({ state }: { state: IWsSessionState }) => (
      <div>
        <span>{state.status}</span>
        <span>{state.connectionLost ? 'connection lost' : 'connection available'}</span>
        {state.messages.map((message) => 'content' in message ? <p key={message.id}>{message.content}</p> : null)}
        <button onClick={() => state.send({ type: 'get-messages' })}>Refresh</button>
      </div>
    ),
  };
});

afterEach(cleanup);

describe('session-only desktop host', () => {
  it('uses the admitted port to drive the surface without requesting a URL or opening a socket', async () => {
    let receive = (_frame: string): void => {};
    let revoked = (): void => {};
    const sent: string[] = [];
    const bridge = {
      subscribe: (frame: (value: string) => void, close: () => void, ready: () => void) => {
        receive = frame;
        revoked = close;
        ready();
        return () => {};
      },
      send: (frame: string) => { sent.push(frame); return true; },
      close: vi.fn(),
    };
    const makeSessionClient: TMakeSessionClient = (callbacks) => createDesktopSessionClient(bridge, callbacks);
    const host: IGuiHost & { makeSessionClient: TMakeSessionClient } = {
      kind: 'desktop',
      getEndpoint: vi.fn(async () => 'ws://forbidden'),
      makeSessionClient,
      signalReady: vi.fn(),
      onState: () => () => {},
      onOpenSettings: () => () => {},
      trustQuestion: async () => null,
    };
    const socket = vi.spyOn(globalThis, 'WebSocket');
    const view = render(<App host={host} product={testProduct} />);
    await screen.findByText('connected');
    expect(host.getEndpoint).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    expect(sent).toContain('{"type":"get-messages"}');
    act(() => receive(JSON.stringify({ type: 'messages', messages: [], display: [{ type: 'text', role: 'assistant', content: 'From the secure session' }] })));
    expect(await screen.findByText('From the secure session')).toBeTruthy();
    fireEvent.click(screen.getByText('Refresh'));
    expect(sent.filter((frame) => frame === '{"type":"get-messages"}').length).toBeGreaterThan(1);
    act(() => revoked());
    await screen.findByText('disconnected');
    expect(screen.getByText('connection lost')).toBeTruthy();
    expect(socket).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(bridge.close).toHaveBeenCalled());
    socket.mockRestore();
  });
  it('waits for the new folder trust decision before connecting a replacement host', async () => {
    const connect = vi.fn();
    const make = (): ReturnType<TMakeSessionClient> => ({ connect, disconnect: () => {}, send: () => {} });
    const makeReplacement = vi.fn(make);
    const base: IGuiHost = {
      kind: 'desktop', getEndpoint: vi.fn(async () => null), signalReady: () => {},
      onState: () => () => {}, onOpenSettings: () => () => {}, makeSessionClient: make,
      trustQuestion: async () => null,
    };
    const view = render(<App host={base} product={testProduct} />);
    await waitFor(() => expect(connect).toHaveBeenCalled());
    const replacement: IGuiHost = {
      ...base, makeSessionClient: makeReplacement,
      trustQuestion: () => new Promise(() => {}),
    };
    view.rerender(<App host={replacement} product={testProduct} />);
    expect(makeReplacement).not.toHaveBeenCalled();
    expect(replacement.getEndpoint).not.toHaveBeenCalled();
  });

  it('does not report a lost connection while the admitted port is still arriving', async () => {
    let ready = (): void => {};
    const bridge = {
      subscribe: (_frame: (value: string) => void, _close: () => void, onReady: () => void) => {
        ready = onReady;
        return () => {};
      },
      send: () => true,
      close: () => {},
    };
    const host: IGuiHost = {
      kind: 'desktop', getEndpoint: async () => null, signalReady: () => {},
      onState: () => () => {}, onOpenSettings: () => () => {},
      makeSessionClient: (callbacks) => createDesktopSessionClient(bridge, callbacks),
    };
    render(<App host={host} product={testProduct} />);
    await screen.findByText('connecting');
    expect(screen.getByText('connection available')).toBeTruthy();
    act(() => ready());
    await screen.findByText('connected');
  });

  it('releases the first channel and uses a fresh admission under StrictMode', async () => {
    const channels: Array<{ close: ReturnType<typeof vi.fn> }> = [];
    const host: IGuiHost = {
      kind: 'desktop', getEndpoint: vi.fn(async () => null), signalReady: () => {},
      onState: () => () => {}, onOpenSettings: () => () => {},
      makeSessionClient: (callbacks) => {
        const bridge = {
          subscribe: (_frame: (value: string) => void, _close: () => void, ready: () => void) => {
            ready();
            return () => {};
          },
          send: () => true,
          close: vi.fn(),
        };
        channels.push(bridge);
        return createDesktopSessionClient(bridge, callbacks);
      },
    };
    const view = render(<React.StrictMode><App host={host} product={testProduct} /></React.StrictMode>);
    await screen.findByText('connected');
    expect(channels.length).toBe(2);
    expect(channels[0].close).toHaveBeenCalledOnce();
    expect(channels[1].close).not.toHaveBeenCalled();
    expect(host.getEndpoint).not.toHaveBeenCalled();
    view.unmount();
    expect(channels[1].close).toHaveBeenCalledOnce();
  });

  it('does not ask a new host to answer a stale trust question from the previous folder', async () => {
    const base: IGuiHost = {
      kind: 'desktop', getEndpoint: async () => null, signalReady: () => {},
      onState: () => () => {}, onOpenSettings: () => () => {},
      trustQuestion: async () => ({ folder: '/old-folder', loads: [] }),
      answerTrust: async () => ({}),
    };
    const view = render(<App host={base} product={testProduct} />);
    expect((await screen.findByRole('dialog')).textContent).toContain('/old-folder');
    const replacement: IGuiHost = {
      ...base,
      trustQuestion: () => new Promise(() => {}),
      answerTrust: vi.fn(async () => ({})),
    };
    view.rerender(<App host={replacement} product={testProduct} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(replacement.answerTrust).not.toHaveBeenCalled();
  });

  it('ignores a delayed fatal event from a replaced host', async () => {
    let oldState = (_state: 'starting' | 'ready' | 'fatal', _detail?: string): void => {};
    let newState = oldState;
    const old: IGuiHost = {
      kind: 'desktop', getEndpoint: async () => null, signalReady: () => {},
      onState: (listener) => { oldState = listener; return () => {}; },
      onOpenSettings: () => () => {},
    };
    const view = render(<App host={old} product={testProduct} />);
    const replacement: IGuiHost = {
      ...old, onState: (listener) => { newState = listener; return () => {}; },
    };
    view.rerender(<App host={replacement} product={testProduct} />);
    act(() => newState('fatal', 'Current runtime failed'));
    expect(screen.getByRole('alert').textContent).toContain('Current runtime failed');
    act(() => oldState('fatal', 'Old runtime failed'));
    expect(screen.getByRole('alert').textContent).toContain('Current runtime failed');
  });

  it('requires a fresh trust decision when returning to a previously used host', async () => {
    let checks = 0;
    const makeClient = vi.fn(() => ({ connect: () => {}, disconnect: () => {}, send: () => {} }));
    const hostA: IGuiHost = {
      kind: 'desktop', getEndpoint: vi.fn(async () => null), signalReady: () => {},
      onState: () => () => {}, onOpenSettings: () => () => {}, makeSessionClient: makeClient,
      trustQuestion: () => ++checks === 1 ? Promise.resolve(null) : new Promise(() => {}),
    };
    const hostB: IGuiHost = { ...hostA, trustQuestion: () => new Promise(() => {}) };
    const view = render(<App host={hostA} product={testProduct} />);
    await waitFor(() => expect(makeClient).toHaveBeenCalledTimes(1));
    view.rerender(<App host={hostB} product={testProduct} />);
    view.rerender(<App host={hostA} product={testProduct} />);
    expect(checks).toBe(2);
    expect(makeClient).toHaveBeenCalledTimes(1);
    expect(hostA.getEndpoint).not.toHaveBeenCalled();
  });

});
