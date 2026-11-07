// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { createDesktopSessionClient } from '../../../agent-ui-web/src/client/desktop-session-client.js';
import { App } from '../App.js';
import { testProduct } from './product-fixture.js';

import type { IGuiHost } from '../gui-host.js';

afterEach(cleanup);

it('renders session history on the real conversation surface from an admitted desktop port', async () => {
  let receive = (_frame: string): void => {};
  const sent: string[] = [];
  const bridge = {
    subscribe: (frame: (value: string) => void, _close: () => void, ready: () => void) => {
      receive = frame;
      ready();
      return () => { bridge.close(); };
    },
    send: (frame: string) => { sent.push(frame); return true; },
    close: vi.fn(),
  };
  const host: IGuiHost = {
    kind: 'desktop', getEndpoint: vi.fn(async () => null), signalReady: vi.fn(),
    onState: () => () => {}, onOpenSettings: () => () => {},
    makeSessionClient: (callbacks) => createDesktopSessionClient(bridge, callbacks),
  };
  const view = render(<App host={host} product={testProduct} />);
  await waitFor(() => expect(host.signalReady).toHaveBeenCalled());
  expect(sent).toContain('{"type":"get-messages"}');
  act(() => receive(JSON.stringify({ type: 'messages', messages: [], display: [
    { type: 'text', role: 'assistant', content: 'Secure session history' },
  ] })));
  expect(await screen.findByText('Secure session history')).toBeTruthy();
  expect(host.getEndpoint).not.toHaveBeenCalled();
  view.unmount();
  expect(bridge.close).toHaveBeenCalledOnce();
});
