/**
 * The host side of the MCP Apps dialect for one app view. The view is untrusted, so what these pin
 * is what it can and cannot make the host do: it is heard only from its own frame's window, it gets
 * a fixed set of answers, it reaches only the tools its own server declared (one at a time), and
 * nothing is sent to it before it says it is ready.
 */
import { describe, expect, it, vi } from 'vitest';

import { createAppViewBridge } from '../bridge.js';

import type { IAppViewBridgeOptions, IAppViewMessage } from '../bridge.js';
import type { TAppToolOutcome, TAppView } from '../types.js';

/** Stand-ins for windows: the bridge only ever compares them by identity. */
const frame = { name: 'the view frame' };
const stranger = { name: 'some other window' };

const view: TAppView = {
  sourceId: 'files',
  resourceUri: 'ui://files/list',
  mimeType: 'text/html;profile=mcp-app',
  html: '<main>rows</main>',
  callableTools: { list_files: 'mcp__files__list_files', save_file: 'mcp__files__save_file' },
  toolInput: { path: 'src' },
};

const hostContext: IAppViewBridgeOptions['hostContext'] = {
  theme: 'dark',
  displayMode: 'inline',
  availableDisplayModes: ['inline'],
  containerDimensions: { maxHeight: 640 },
  platform: 'web',
  locale: 'en-US',
  timeZone: 'UTC',
};

const toolResult: IAppViewBridgeOptions['toolResult'] = {
  content: [{ type: 'text', text: 'three rows' }],
  structuredContent: { rows: 3 },
  isError: false,
};

function setup(overrides: Partial<IAppViewBridgeOptions> = {}) {
  const posted: IAppViewMessage[] = [];
  const callAppTool = vi.fn<IAppViewBridgeOptions['callAppTool']>();
  const onHeight = vi.fn<(px: number) => void>();
  const bridge = createAppViewBridge({
    view,
    toolResult,
    hostInfo: { name: 'Test Host', version: '1.2.3' },
    hostContext,
    post: (message) => posted.push(message),
    source: () => frame as unknown as MessageEventSource,
    callAppTool,
    onHeight,
    ...overrides,
  });
  const from = (source: unknown, data: unknown): void =>
    bridge.handleMessage({ source, data } as unknown as MessageEvent);
  const fromFrame = (data: unknown): void => from(frame, data);
  const request = (id: number, method: string, params?: unknown): void =>
    fromFrame({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
  const notify = (method: string, params?: unknown): void =>
    fromFrame({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  return { bridge, posted, callAppTool, onHeight, from, fromFrame, request, notify };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('app view bridge: the handshake', () => {
  it('sends the document once, when the sandbox page says it is ready', () => {
    const { posted, notify } = setup();
    expect(posted).toEqual([]);

    notify('ui/notifications/sandbox-proxy-ready', {});
    notify('ui/notifications/sandbox-proxy-ready', {});

    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/sandbox-resource-ready',
        params: { html: '<main>rows</main>' },
      },
    ]);
  });

  it('answers ui/initialize with the protocol version, capabilities, host info and context', () => {
    const { posted, request } = setup();

    request(1, 'ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'x' } });

    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2026-01-26',
          hostCapabilities: { serverTools: {} },
          hostInfo: { name: 'Test Host', version: '1.2.3' },
          hostContext,
        },
      },
    ]);
  });

  it('sends nothing to the view before it has said it is initialized', () => {
    const { posted, request, notify } = setup();

    notify('ui/notifications/sandbox-proxy-ready', {});
    request(1, 'ui/initialize', {});
    request(2, 'ping');

    const methods = posted.map((message) => message.method).filter(Boolean);
    expect(methods).toEqual(['ui/notifications/sandbox-resource-ready']);
  });

  it('sends tool-input and then tool-result once it is initialized, and only once', () => {
    const { posted, notify, request } = setup();
    request(0, 'ui/initialize');
    posted.length = 0;

    notify('ui/notifications/initialized', {});
    notify('ui/notifications/initialized', {});

    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-input',
        params: { arguments: { path: 'src' } },
      },
      { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: toolResult },
    ]);
  });

  it('hands the view empty arguments when the call had none to report', () => {
    const { posted, notify, request } = setup({ view: { ...view, toolInput: undefined } });
    request(0, 'ui/initialize');
    posted.length = 0;

    notify('ui/notifications/initialized', {});

    expect(posted[0]).toEqual({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-input',
      params: { arguments: {} },
    });
  });
});

describe('app view bridge: calling a tool', () => {
  const okOutcome: TAppToolOutcome = {
    success: true,
    data: { rows: 3 },
    parts: [
      { type: 'text', text: 'three rows' },
      { type: 'image_inline', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
      { type: 'audio_inline', mimeType: 'audio/wav', data: 'AA==' },
      { type: 'resource_link', uri: 'file:///etc/passwd', name: 'passwd' },
    ],
  };

  it('runs a tool the view’s server declared, by its runtime name, and returns the result', async () => {
    const { posted, callAppTool, request } = readySetup();
    callAppTool.mockResolvedValue(okOutcome);

    request(7, 'tools/call', { name: 'list_files', arguments: { path: 'src' } });
    await flush();

    expect(callAppTool).toHaveBeenCalledExactlyOnceWith('mcp__files__list_files', { path: 'src' });
    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        id: 7,
        result: {
          content: [
            { type: 'text', text: 'three rows' },
            { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
            { type: 'audio', data: 'AA==', mimeType: 'audio/wav' },
          ],
          structuredContent: { rows: 3 },
          isError: false,
        },
      },
    ]);
  });

  it('passes empty arguments when the view sends none', async () => {
    const { callAppTool, request } = readySetup();
    callAppTool.mockResolvedValue({ success: true, data: 'done' });

    request(1, 'tools/call', { name: 'list_files' });
    await flush();

    expect(callAppTool).toHaveBeenCalledExactlyOnceWith('mcp__files__list_files', {});
  });

  it('returns a denied or failed call as an error result the view can show', async () => {
    const { posted, callAppTool, request } = readySetup();
    callAppTool.mockResolvedValue({ success: false, error: 'Permission denied for save_file' });

    request(2, 'tools/call', { name: 'save_file', arguments: { path: 'a.txt' } });
    await flush();

    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [{ type: 'text', text: 'Permission denied for save_file' }],
          isError: true,
        },
      },
    ]);
  });

  it('uses a string result as the text when there are no observations', async () => {
    const { posted, callAppTool, request } = readySetup();
    callAppTool.mockResolvedValue({ success: true, data: 'plain words' });

    request(3, 'tools/call', { name: 'list_files' });
    await flush();

    expect(posted[0]?.result).toEqual({
      content: [{ type: 'text', text: 'plain words' }],
      isError: false,
    });
  });

  it('answers a refused call (a protocol error from the session) with a JSON-RPC error', async () => {
    const { posted, callAppTool, request } = readySetup();
    callAppTool.mockRejectedValue(new Error('The connection to the session closed.'));

    request(4, 'tools/call', { name: 'list_files' });
    await flush();

    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        id: 4,
        error: { code: -32000, message: 'The connection to the session closed.' },
      },
    ]);
  });

  it('answers a call that throws before it starts the same way, and can then run another', async () => {
    const { posted, callAppTool, request } = readySetup();
    callAppTool.mockImplementationOnce(() => {
      throw new Error('arguments are not serializable');
    });
    callAppTool.mockResolvedValueOnce({ success: true, data: 'fine' });

    request(5, 'tools/call', { name: 'list_files' });
    await flush();
    request(6, 'tools/call', { name: 'list_files' });
    await flush();

    expect(posted[0]).toEqual({
      jsonrpc: '2.0',
      id: 5,
      error: { code: -32000, message: 'arguments are not serializable' },
    });
    expect(posted[1]?.id).toBe(6);
    expect(posted[1]?.result).toBeDefined();
  });

  it.each([
    ['a runtime name the view was not given a source name for', 'mcp__files__list_files'],
    ['a tool of another source', 'mcp__other__delete_all'],
    ['an inherited property name', 'toString'],
    ['a prototype key', '__proto__'],
    ['an empty name', ''],
  ])('refuses %s and runs nothing', async (_label, name) => {
    const { posted, callAppTool, request } = readySetup();

    request(1, 'tools/call', { name, arguments: {} });
    await flush();

    expect(callAppTool).not.toHaveBeenCalled();
    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32602, message: 'This tool is not available to this view.' },
      },
    ]);
  });

  it.each([
    ['no name', { arguments: {} }],
    ['a non-string name', { name: 5 }],
    ['no params at all', undefined],
    ['array params', ['list_files']],
  ])('refuses a call with %s', async (_label, params) => {
    const { posted, callAppTool, request } = readySetup();

    request(1, 'tools/call', params);
    await flush();

    expect(callAppTool).not.toHaveBeenCalled();
    expect(posted[0]?.error?.code).toBe(-32602);
  });

  it.each([
    ['an array', ['a']],
    ['a string', 'path=src'],
    ['a number', 7],
    ['null', null],
  ])('refuses arguments that are %s and runs nothing', async (_label, args) => {
    const { posted, callAppTool, request } = readySetup();

    request(1, 'tools/call', { name: 'list_files', arguments: args });
    await flush();

    expect(callAppTool).not.toHaveBeenCalled();
    expect(posted[0]?.error).toEqual({
      code: -32602,
      message: 'Tool arguments must be an object.',
    });
  });

  it('allows one call in flight: a second is refused while the first runs, and a third is not', async () => {
    const { posted, callAppTool, request } = readySetup();
    let finish: (outcome: TAppToolOutcome) => void = () => {};
    callAppTool.mockImplementationOnce(
      () => new Promise<TAppToolOutcome>((resolve) => (finish = resolve)),
    );
    callAppTool.mockResolvedValue({ success: true, data: 'later' });

    request(1, 'tools/call', { name: 'list_files' });
    request(2, 'tools/call', { name: 'save_file' });
    await flush();

    expect(callAppTool).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32000, message: 'Another tool call from this view is still running.' },
      },
    ]);

    finish({ success: true, data: 'first' });
    await flush();
    request(3, 'tools/call', { name: 'list_files' });
    await flush();

    expect(callAppTool).toHaveBeenCalledTimes(2);
    expect(posted.map((message) => message.id)).toEqual([2, 1, 3]);
  });
});

describe('app view bridge: everything else a view can ask', () => {
  it('answers ping with an empty result and display-mode requests with inline', () => {
    const { posted, request } = setup();

    request(1, 'ping');
    request(2, 'ui/request-display-mode', { mode: 'fullscreen' });

    expect(posted).toEqual([
      { jsonrpc: '2.0', id: 1, result: {} },
      { jsonrpc: '2.0', id: 2, result: { mode: 'inline' } },
    ]);
  });

  it.each([
    'ui/open-link',
    'ui/message',
    'ui/update-model-context',
    'resources/read',
    'resources/list',
    'tools/list',
    'prompts/list',
    'prompts/get',
    'ui/notifications/sandbox-resource-ready',
    'made/up',
  ])('refuses the request %s', (method) => {
    const { posted, callAppTool, onHeight, request } = setup();

    request(9, method, { url: 'https://example.com' });

    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        id: 9,
        error: { code: -32601, message: `This host does not support ${method}.` },
      },
    ]);
    expect(callAppTool).not.toHaveBeenCalled();
    expect(onHeight).not.toHaveBeenCalled();
  });

  it('ignores a notification it has no use for', () => {
    const { posted, notify } = setup();

    notify('notifications/message', { level: 'info', data: 'hello' });
    notify('ui/notifications/sandbox-something-else', {});

    expect(posted).toEqual([]);
  });
});

describe('app view bridge: who is listened to', () => {
  it('ignores every message from a window other than the view’s frame', () => {
    const { posted, callAppTool, onHeight, from } = setup();

    from(stranger, { jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} });
    from(stranger, { jsonrpc: '2.0', id: 1, method: 'ui/initialize' });
    from(stranger, { jsonrpc: '2.0', method: 'ui/notifications/initialized' });
    from(stranger, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_files' } });
    from(stranger, {
      jsonrpc: '2.0',
      method: 'ui/notifications/size-changed',
      params: { height: 99 },
    });
    from(null, { jsonrpc: '2.0', id: 3, method: 'ping' });

    expect(posted).toEqual([]);
    expect(callAppTool).not.toHaveBeenCalled();
    expect(onHeight).not.toHaveBeenCalled();
  });

  it('ignores everything while the frame has no window', () => {
    const { posted, fromFrame } = setup({ source: () => null });

    fromFrame({ jsonrpc: '2.0', id: 1, method: 'ping' });

    expect(posted).toEqual([]);
  });

  it.each([
    ['a string', 'ping'],
    ['null', null],
    ['an array', [{ jsonrpc: '2.0', id: 1, method: 'ping' }]],
    ['an object without jsonrpc', { id: 1, method: 'ping' }],
    ['an object with another version', { jsonrpc: '1.0', id: 1, method: 'ping' }],
    ['a response, not a request', { jsonrpc: '2.0', id: 1, result: {} }],
    ['a request with an object id', { jsonrpc: '2.0', id: { a: 1 }, method: 'ping' }],
    ['a request with a null id', { jsonrpc: '2.0', id: null, method: 'ping' }],
    ['a request with a non-string method', { jsonrpc: '2.0', id: 1, method: 5 }],
    [
      'a class instance',
      new (class Fake {
        jsonrpc = '2.0';
        id = 1;
        method = 'ping';
      })(),
    ],
  ])('ignores %s from the frame', (_label, data) => {
    const { posted, fromFrame } = setup();

    fromFrame(data);

    expect(posted).toEqual([]);
  });
});

describe('app view bridge: the frame’s height', () => {
  it.each([
    [10, 48],
    [48, 48],
    [200.4, 200],
    [200.5, 201],
    [640, 640],
    [5000, 640],
  ])('follows size-changed %s as %s px', (requested, expected) => {
    const { onHeight, notify } = setup();

    notify('ui/notifications/size-changed', { width: 9999, height: requested });

    expect(onHeight).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it.each([
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a string', '300'],
    ['nothing', undefined],
  ])('ignores a height that is %s', (_label, height) => {
    const { onHeight, notify } = setup();

    notify('ui/notifications/size-changed', { height });

    expect(onHeight).not.toHaveBeenCalled();
  });
});

describe('app view bridge: teardown', () => {
  it('asks an initialized view to tear down, without waiting, and then goes quiet', async () => {
    const { posted, bridge, callAppTool, request, notify, onHeight } = setup();
    request(0, 'ui/initialize');
    notify('ui/notifications/initialized', {});
    posted.length = 0;
    let finish: (outcome: TAppToolOutcome) => void = () => {};
    callAppTool.mockImplementationOnce(
      () => new Promise<TAppToolOutcome>((resolve) => (finish = resolve)),
    );
    request(1, 'tools/call', { name: 'list_files' });

    bridge.dispose();

    expect(posted).toEqual([
      {
        jsonrpc: '2.0',
        id: 'teardown',
        method: 'ui/resource-teardown',
        params: { reason: 'closed' },
      },
    ]);

    // Nothing the view says or any late result is answered afterwards.
    finish({ success: true, data: 'late' });
    await flush();
    request(2, 'ping');
    notify('ui/notifications/size-changed', { height: 200 });
    bridge.dispose();
    expect(posted).toHaveLength(1);
    expect(onHeight).not.toHaveBeenCalled();
  });

  it('says nothing to a view that never initialized', () => {
    const { posted, bridge, notify } = setup();
    notify('ui/notifications/sandbox-proxy-ready', {});
    posted.length = 0;

    bridge.dispose();

    expect(posted).toEqual([]);
  });
});

function readySetup() {
  const api = setup();
  api.request(0, 'ui/initialize');
  api.notify('ui/notifications/initialized');
  api.posted.length = 0;
  return api;
}

describe('app view bridge: initialization admission', () => {
  it('refuses tools until initialize and initialized have both completed', async () => {
    const { posted, request, notify, callAppTool } = setup();
    callAppTool.mockResolvedValue({ success: true });
    request(1, 'tools/call', { name: 'list_files' });
    notify('ui/notifications/initialized');
    expect(posted.some((message) => message.method === 'ui/notifications/tool-result')).toBe(false);
    request(2, 'ui/initialize');
    request(3, 'tools/call', { name: 'list_files' });
    expect(callAppTool).not.toHaveBeenCalled();
    expect(posted.filter((message) => message.error).map((message) => message.id)).toEqual([1, 3]);
    notify('ui/notifications/initialized');
    request(4, 'tools/call', { name: 'list_files' });
    await flush();
    expect(callAppTool).toHaveBeenCalledOnce();
    expect(posted.find((message) => message.id === 4)?.result).toBeDefined();
    request(5, 'ui/initialize');
    notify('ui/notifications/initialized');
    expect(
      posted.filter((message) => message.method === 'ui/notifications/tool-result'),
    ).toHaveLength(1);
  });
});
