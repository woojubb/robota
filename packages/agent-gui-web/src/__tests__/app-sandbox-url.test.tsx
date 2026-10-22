// @vitest-environment jsdom

import { testProduct } from './product-fixture.js';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../App.js';

import type { IGuiHost } from '../gui-host.js';

const surfaceProps = vi.fn();

vi.mock('@robota-sdk/agent-ui-web/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-ui-web/client')>();
  return {
    ...actual,
    useWsSession: () => ({ status: 'connected', connectionLost: false, openSettings: vi.fn() }),
    SessionSurface: (props: Record<string, unknown>) => {
      surfaceProps(props);
      return <div>session surface</div>;
    },
  };
});

afterEach(() => {
  cleanup();
  surfaceProps.mockClear();
  window.history.replaceState({}, '', '/');
});

const host: IGuiHost = {
  kind: 'browser',
  getEndpoint: async () => 'ws://127.0.0.1:1?token=t',
  signalReady: () => {},
  onState: () => () => {},
  onOpenSettings: () => () => {},
};

describe('App tells the session surface where the app sandbox page is', () => {
  it('passes the sandbox page that sits beside the app page', async () => {
    render(<App product={testProduct} host={host} />);
    await screen.findByText('session surface');

    expect(surfaceProps).toHaveBeenCalled();
    expect(surfaceProps.mock.calls.at(-1)?.[0]).toMatchObject({
      appViewSandboxUrl: new URL('app-sandbox.html', document.baseURI).href,
    });
    expect(surfaceProps.mock.calls.at(-1)?.[0].appViewSandboxUrl).toMatch(/\/app-sandbox\.html$/u);
  });

  it('never carries the page’s own query (the launch token) into the frame’s address', async () => {
    window.history.replaceState({}, '', '/?ws=ws%3A%2F%2F127.0.0.1%3A9&token=secret#frag');
    render(<App product={testProduct} host={host} />);
    await screen.findByText('session surface');

    const { appViewSandboxUrl } = surfaceProps.mock.calls.at(-1)?.[0] as {
      appViewSandboxUrl: string;
    };
    expect(appViewSandboxUrl).not.toContain('secret');
    expect(appViewSandboxUrl).not.toContain('?');
    expect(appViewSandboxUrl).not.toContain('#');
  });
});
