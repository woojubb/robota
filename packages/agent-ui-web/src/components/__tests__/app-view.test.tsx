// @vitest-environment jsdom
/**
 * The frame an MCP app view runs in. The document never runs in this page: the frame is the host's
 * own static sandbox page, scripts allowed and nothing else granted, and a view reaches the host only
 * through the bridge over `postMessage`. A host without a sandbox page shows one plain line.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppViewHostContext } from '../../app-view/host-context.js';
import { APP_VIEW_UNAVAILABLE_TEXT, AppView } from '../AppView.js';

import type { IAppViewHost } from '../../app-view/host-context.js';
import type { TAppView } from '../../app-view/types.js';
import type { IActiveTool } from '../../hooks/useSessionClient.js';

afterEach(() => cleanup());

const SANDBOX_URL = 'http://localhost/app-sandbox.html';

const view: TAppView = {
  sourceId: 'files',
  resourceUri: 'ui://files/list',
  mimeType: 'text/html;profile=mcp-app',
  html: '<main>rows</main>',
  callableTools: { list_files: 'mcp__files__list_files' },
  toolInput: { path: 'src' },
};

function appTool(overrides: Partial<IActiveTool> = {}): IActiveTool {
  return {
    id: 't1',
    name: 'mcp__files__browse',
    status: 'done',
    executionId: 'exec-1',
    appView: { viewId: 'view-1', sourceId: 'files', resourceUri: 'ui://files/list' },
    toolResultParts: [{ type: 'text', text: 'three rows' }],
    ...overrides,
  };
}

function host(overrides: Partial<IAppViewHost> = {}): IAppViewHost {
  return {
    sandboxUrl: SANDBOX_URL,
    readAppView: vi.fn().mockResolvedValue(view),
    callAppTool: vi.fn().mockResolvedValue({ success: true, data: 'done' }),
    hostInfo: { name: 'Test Host', version: '1.0.0' },
    platform: 'web',
    ...overrides,
  };
}

function renderAppView(tool: IActiveTool, value: IAppViewHost | null): void {
  render(
    <AppViewHostContext.Provider value={value}>
      <AppView tool={tool} />
    </AppViewHostContext.Provider>,
  );
}

async function frameOf(): Promise<HTMLIFrameElement> {
  return (await screen.findByTestId('app-view-frame')) as HTMLIFrameElement;
}

/** Delivers a message to the page as if the frame's window had posted it. */
function fromWindow(source: Window | null, data: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source }));
  });
}

describe('AppView: the frame', () => {
  it('is the sandbox page with scripts allowed and nothing else granted', async () => {
    renderAppView(appTool(), host());

    const frame = await frameOf();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.hasAttribute('allow')).toBe(false);
    expect(frame.getAttribute('src')).toBe(SANDBOX_URL);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('title')).toBe('App from files');
    expect(frame.style.width).toBe('100%');
    expect(frame.style.height).toBe('160px');
    // The document itself is never put in this page, nor in an attribute of the frame.
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(document.body.innerHTML).not.toContain('<main>rows</main>');
  });

  it('shows where the app comes from above the frame, so its boundary is visible', async () => {
    renderAppView(appTool(), host());

    const frame = await frameOf();
    const caption = screen.getByText('App from files');
    expect(caption.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('reads the view of the call once, by its minted view id', async () => {
    const value = host();
    renderAppView(appTool(), value);

    await frameOf();
    expect(value.readAppView).toHaveBeenCalledExactlyOnceWith('view-1', expect.any(AbortSignal));
  });

  it('says why when the view cannot be read, in one line and with no frame', async () => {
    const value = host({
      readAppView: vi.fn().mockRejectedValue(new Error('This app view is gone.')),
    });
    renderAppView(appTool(), value);

    await screen.findByText(/This app view is gone\./);
    expect(screen.queryByTestId('app-view-frame')).toBeNull();
    expect(screen.getByText(/could not be shown/).textContent).toContain('files');
  });

  it('shows one plain line, reads nothing and makes no frame without a sandbox page', () => {
    const value = host({ sandboxUrl: undefined });
    renderAppView(appTool(), value);

    expect(screen.getByText(APP_VIEW_UNAVAILABLE_TEXT)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(value.readAppView).not.toHaveBeenCalled();
  });

  it('shows the same plain line outside any provider', () => {
    renderAppView(appTool(), null);

    expect(screen.getByText(APP_VIEW_UNAVAILABLE_TEXT)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('reads by the view id even when the call has no execution id', async () => {
    const value = host();
    renderAppView(appTool({ executionId: undefined }), value);

    await frameOf();
    expect(value.readAppView).toHaveBeenCalledWith('view-1', expect.any(AbortSignal));
  });

  it('renders nothing for a tool with no app view', () => {
    renderAppView(appTool({ appView: undefined }), host());

    expect(document.body.textContent).toBe('');
  });
});

describe('AppView: the bridge to the frame', () => {
  async function mounted(value: IAppViewHost = host()) {
    renderAppView(appTool(), value);
    const frame = await frameOf();
    const frameWindow = frame.contentWindow as Window;
    const post = vi.spyOn(frameWindow, 'postMessage');
    return { frame, frameWindow, post, value };
  }

  it('hands the document to the sandbox page when it says it is ready, to nobody else', async () => {
    const { frameWindow, post } = await mounted();

    fromWindow(null, {
      jsonrpc: '2.0',
      method: 'ui/notifications/sandbox-proxy-ready',
      params: {},
    });
    fromWindow(window, {
      jsonrpc: '2.0',
      method: 'ui/notifications/sandbox-proxy-ready',
      params: {},
    });
    expect(post).not.toHaveBeenCalled();

    fromWindow(frameWindow, {
      jsonrpc: '2.0',
      method: 'ui/notifications/sandbox-proxy-ready',
      params: {},
    });
    expect(post).toHaveBeenCalledExactlyOnceWith(
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/sandbox-resource-ready',
        params: { html: '<main>rows</main>' },
      },
      '*',
    );
  });

  it('answers the view’s handshake and then hands it the call’s input and result', async () => {
    const { frameWindow, post } = await mounted();

    fromWindow(frameWindow, { jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2026-01-26',
        hostCapabilities: { serverTools: {} },
        hostInfo: { name: 'Test Host', version: '1.0.0' },
        hostContext: { displayMode: 'inline', platform: 'web' },
      },
    });

    fromWindow(frameWindow, { jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
    expect(
      post.mock.calls.slice(1).map(([message]) => (message as { method: string }).method),
    ).toEqual(['ui/notifications/tool-input', 'ui/notifications/tool-result']);
    expect(post.mock.calls[1]?.[0]).toMatchObject({ params: { arguments: { path: 'src' } } });
    expect(post.mock.calls[2]?.[0]).toMatchObject({
      params: { content: [{ type: 'text', text: 'three rows' }], isError: false },
    });
  });

  it('runs a tool the view asked for through the host and returns the result to the frame', async () => {
    const { frameWindow, post, value } = await mounted();
    fromWindow(frameWindow, { jsonrpc: '2.0', id: 0, method: 'ui/initialize' });
    fromWindow(frameWindow, { jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    post.mockClear();

    fromWindow(frameWindow, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'list_files', arguments: { path: 'src' } },
    });

    // The key the view was read by rides with every call it makes.
    expect(value.callAppTool).toHaveBeenCalledExactlyOnceWith(
      'view-1',
      'mcp__files__list_files',
      {
        path: 'src',
      },
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]?.[0]).toMatchObject({
      id: 5,
      result: { content: [{ type: 'text', text: 'done' }], isError: false },
    });
  });

  it('follows the height the view asks for, within bounds', async () => {
    const { frame, frameWindow } = await mounted();

    fromWindow(frameWindow, {
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: { width: 100, height: 321 },
    });
    expect(frame.style.height).toBe('321px');

    fromWindow(frameWindow, {
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: { height: 100000 },
    });
    expect(frame.style.height).toBe('640px');
  });

  it('asks an initialized view to tear down when it goes away, and listens no more', async () => {
    const { frame, frameWindow, post } = await mounted();
    fromWindow(frameWindow, { jsonrpc: '2.0', id: 0, method: 'ui/initialize' });
    fromWindow(frameWindow, { jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
    post.mockClear();

    cleanup();

    expect(post).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ method: 'ui/resource-teardown', params: { reason: 'closed' } }),
      '*',
    );
    fromWindow(frameWindow, { jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(frame.isConnected).toBe(false);
  });
});

describe('AppView: document ownership', () => {
  it('removes the old frame immediately when the same tool row receives another view id', async () => {
    const readAppView = vi
      .fn<IAppViewHost['readAppView']>()
      .mockResolvedValueOnce(view)
      .mockImplementationOnce(() => new Promise(() => {}));
    const value = host({ readAppView });
    const rendered = render(
      <AppViewHostContext.Provider value={value}>
        <AppView tool={appTool()} />
      </AppViewHostContext.Provider>,
    );
    const oldFrame = await frameOf();
    const oldSignal = readAppView.mock.calls[0]?.[1];
    rendered.rerender(
      <AppViewHostContext.Provider value={value}>
        <AppView
          tool={appTool({
            appView: { viewId: 'view-next', sourceId: 'files', resourceUri: 'ui://files/next' },
          })}
        />
      </AppViewHostContext.Provider>,
    );
    expect(oldFrame.isConnected).toBe(false);
    expect(screen.queryByTestId('app-view-frame')).toBeNull();
    expect(oldSignal?.aborted).toBe(true);
    expect(readAppView).toHaveBeenLastCalledWith('view-next', expect.any(AbortSignal));
  });

  it('aborts a never-answering document read when its row unmounts', () => {
    const readAppView = vi
      .fn<IAppViewHost['readAppView']>()
      .mockImplementation(() => new Promise(() => {}));
    const rendered = render(
      <AppViewHostContext.Provider value={host({ readAppView })}>
        <AppView tool={appTool()} />
      </AppViewHostContext.Provider>,
    );
    const signal = readAppView.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('does not bind a deferred old document to a replacement host', async () => {
    let finishOld: (value: TAppView) => void = () => {};
    let finishNext: (value: TAppView) => void = () => {};
    const oldHost = host({
      readAppView: vi.fn().mockImplementation(
        () =>
          new Promise<TAppView>((resolve) => {
            finishOld = resolve;
          }),
      ),
    });
    const nextHost = host({
      readAppView: vi.fn().mockImplementation(
        () =>
          new Promise<TAppView>((resolve) => {
            finishNext = resolve;
          }),
      ),
    });
    const rendered = render(
      <AppViewHostContext.Provider value={oldHost}>
        <AppView tool={appTool()} />
      </AppViewHostContext.Provider>,
    );
    rendered.rerender(
      <AppViewHostContext.Provider value={nextHost}>
        <AppView tool={appTool()} />
      </AppViewHostContext.Provider>,
    );
    await act(async () => finishOld(view));
    expect(screen.queryByTestId('app-view-frame')).toBeNull();
    await act(async () => finishNext({ ...view, html: '<main>next</main>' }));
    const frame = await frameOf();
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    fromWindow(frame.contentWindow, {
      jsonrpc: '2.0',
      method: 'ui/notifications/sandbox-proxy-ready',
    });
    expect(post.mock.calls[0]?.[0]).toMatchObject({ params: { html: '<main>next</main>' } });
    fromWindow(frame.contentWindow, { jsonrpc: '2.0', id: 1, method: 'ui/initialize' });
    fromWindow(frame.contentWindow, { jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    fromWindow(frame.contentWindow, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'list_files' },
    });
    expect(oldHost.callAppTool).not.toHaveBeenCalled();
    expect(nextHost.callAppTool).toHaveBeenCalledOnce();
  });
});
