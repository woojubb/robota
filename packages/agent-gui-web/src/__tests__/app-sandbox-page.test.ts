import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(
  fileURLToPath(new URL('../../public/app-sandbox.html', import.meta.url)),
  'utf8',
);

const POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gu)];
const script = scripts[0]?.[2] ?? '';

describe('app-sandbox.html: the file', () => {
  it('carries exactly the resource policy, in a meta tag ahead of the script', () => {
    const metas = [...html.matchAll(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*>/gu)];
    expect(metas).toHaveLength(1);
    const content = /content="([^"]*)"/u.exec(metas[0]![0])?.[1];
    expect(content).toBe(POLICY);
    expect(html.indexOf(metas[0]![0])).toBeLessThan(html.indexOf('<script'));
  });

  it('is self-contained: one inline script and no external resources', () => {
    expect(scripts).toHaveLength(1);
    expect(scripts[0]![1]).not.toMatch(/\bsrc\s*=/u);
    expect(html).not.toMatch(/<(link|img|iframe|object|embed|form|base)\b/iu);
    expect(html).not.toMatch(/@import|url\(/iu);
  });

  it('holds the document in a srcdoc frame, never one that would take the GUI page’s policy', () => {
    expect(script).toMatch(/\.srcdoc\s*=/u);
    expect(script).not.toMatch(/document\.write|createObjectURL|\bblob:|data:text|\.src\s*=/u);
  });
});

interface IFakeWindow {
  name: string;
  postMessage: ReturnType<typeof vi.fn>;
  document?: unknown;
}

interface IFakeInner {
  attributes: Record<string, string>;
  srcdoc?: string;
  contentWindow: IFakeWindow;
}

/**
 * The page's script, run once against stand-in windows. `framed` false is the page opened on its
 * own; `topReadable` / `parentReadable` stand for a host that forgot the `sandbox` attribute.
 */
function runPage(
  options: {
    framed?: boolean;
    topReadable?: boolean;
    parentReadable?: boolean;
    userAgent?: string;
    isolationEnabled?: boolean;
    rtcMissing?: boolean;
    rtcFailure?: 'construct' | 'configuration' | 'close';
  } = {},
) {
  const { framed = true, topReadable = false, parentReadable = false } = options;
  const unreadable = (name: string): IFakeWindow => {
    const other: IFakeWindow = { name, postMessage: vi.fn() };
    Object.defineProperty(other, 'document', {
      get() {
        throw new Error('SecurityError: blocked a frame from accessing a cross-origin frame');
      },
    });
    return other;
  };
  const host: IFakeWindow = parentReadable
    ? { name: 'host', postMessage: vi.fn(), document: {} }
    : unreadable('host');
  const top: IFakeWindow = topReadable
    ? { name: 'top', postMessage: vi.fn(), document: {} }
    : unreadable('top');
  const listeners: Array<(event: { source: unknown; data: unknown }) => void> = [];
  const own: { self?: unknown; top?: unknown; parent: unknown; addEventListener: unknown } = {
    parent: framed ? host : undefined,
    addEventListener: (type: string, listener: (typeof listeners)[number]) => {
      if (type === 'message') listeners.push(listener);
    },
  };
  own.self = own;
  own.top = framed ? top : own;
  if (!framed) own.parent = own;

  const inners: IFakeInner[] = [];
  const lines: string[] = [];
  const body = {
    appended: [] as unknown[],
    appendChild(child: unknown) {
      this.appended.push(child);
    },
  };
  const document = {
    body,
    createElement(tag: string) {
      if (tag === 'iframe') {
        const inner: IFakeInner = {
          attributes: {},
          contentWindow: { name: 'inner', postMessage: vi.fn() },
          setAttribute(name: string, value: string) {
            this.attributes[name] = value;
          },
        } as IFakeInner & { setAttribute(name: string, value: string): void };
        inners.push(inner);
        return inner;
      }
      const element = {
        tag,
        set textContent(value: string) {
          lines.push(value);
        },
      };
      return element;
    },
  };

  const construct = vi.fn();
  const close = vi.fn();
  class PeerConnection {
    constructor(configuration: unknown) {
      construct(configuration);
      if (options.rtcFailure === 'construct') throw new Error('RTC unavailable');
    }
    getConfiguration() {
      if (options.rtcFailure === 'configuration') throw new Error('RTC configuration unavailable');
      return {
        iceServers: options.isolationEnabled === false ? [{ urls: 'stun:127.0.0.1:9' }] : [],
      };
    }
    close() {
      close();
      if (options.rtcFailure === 'close') throw new Error('RTC close failed');
    }
  }
  Object.assign(own, { RTCPeerConnection: options.rtcMissing ? undefined : PeerConnection });
  const navigator = {
    userAgent: options.userAgent ?? 'Mozilla/5.0 Chrome/158.0.8104.0 Safari/537.36',
  };
  new Function('window', 'document', 'navigator', script)(own, document, navigator);

  const dispatch = (source: unknown, data: unknown): void => {
    for (const listener of listeners) listener({ source, data });
  };
  return { host, top, inners, lines, body, dispatch, listeners, own, construct, close };
}

const resourceReady = (params: unknown) => ({
  jsonrpc: '2.0',
  method: 'ui/notifications/sandbox-resource-ready',
  params,
});

describe('app-sandbox.html: refusing to run unsafely', () => {
  it('opened on its own, shows one line, installs no listener and posts nothing', () => {
    const page = runPage({ framed: false });

    expect(page.lines).toHaveLength(1);
    expect(page.listeners).toHaveLength(0);
    expect(page.inners).toHaveLength(0);
  });

  it.each([
    ['the top document', { topReadable: true }],
    ['the parent document', { parentReadable: true }],
  ])(
    'refuses when %s can be read, which means the host forgot the sandbox attribute',
    (_label, flags) => {
      const page = runPage(flags);

      expect(page.lines).toHaveLength(1);
      expect(page.host.postMessage).not.toHaveBeenCalled();
      expect(page.listeners).toHaveLength(0);
    },
  );
});

describe('app-sandbox.html: the handshake and the one inner frame', () => {
  it('tells the host it is ready, once, and makes no frame until it is given a document', () => {
    const page = runPage();

    expect(page.host.postMessage).toHaveBeenCalledExactlyOnceWith(
      { jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} },
      '*',
    );
    expect(page.inners).toHaveLength(0);
  });

  it('puts the document in one inner frame sandboxed for scripts only, with no allow attribute', () => {
    const page = runPage();

    page.dispatch(
      page.host,
      resourceReady({
        html: '<main>rows</main>',
        // None of these changes anything: the page decides the frame's limits, not the host.
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups',
        csp: { connectDomains: ['https://evil.example'] },
        permissions: { camera: {}, microphone: {} },
      }),
    );

    expect(page.inners).toHaveLength(1);
    const [inner] = page.inners;
    expect(inner?.attributes).toEqual({ sandbox: 'allow-scripts', title: 'App' });
    expect(inner?.srcdoc).toBe('<main>rows</main>');
    expect(page.body.appended).toEqual([inner]);
  });

  it('makes the frame once: a second document is ignored', () => {
    const page = runPage();

    page.dispatch(page.host, resourceReady({ html: '<main>first</main>' }));
    page.dispatch(page.host, resourceReady({ html: '<main>second</main>' }));

    expect(page.inners).toHaveLength(1);
    expect(page.inners[0]?.srcdoc).toBe('<main>first</main>');
  });

  it.each([
    ['no params', undefined],
    ['params without html', {}],
    ['a non-string document', { html: { text: '<main/>' } }],
  ])('makes no frame for %s', (_label, params) => {
    const page = runPage();

    page.dispatch(page.host, resourceReady(params));

    expect(page.inners).toHaveLength(0);
  });

  it('takes a document from the host only: the same message from any other window is dropped', () => {
    const page = runPage();
    const stranger: IFakeWindow = { name: 'stranger', postMessage: vi.fn() };

    page.dispatch(stranger, resourceReady({ html: '<main>planted</main>' }));
    page.dispatch(null, resourceReady({ html: '<main>planted</main>' }));
    page.dispatch(page.top, resourceReady({ html: '<main>planted</main>' }));

    expect(page.inners).toHaveLength(0);
  });
});

describe('app-sandbox.html: the relay', () => {
  function withView() {
    const page = runPage();
    page.dispatch(page.host, resourceReady({ html: '<main/>' }));
    page.host.postMessage.mockClear();
    const view = page.inners[0]!.contentWindow;
    return { ...page, view };
  }

  it('passes the host’s messages to the view and the view’s to the host, as they are', () => {
    const page = withView();
    const toView = { jsonrpc: '2.0', id: 1, result: { ok: true } };
    const toHost = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'x' } };

    page.dispatch(page.host, toView);
    page.dispatch(page.view, toHost);

    expect(page.view.postMessage).toHaveBeenCalledExactlyOnceWith(toView, '*');
    expect(page.host.postMessage).toHaveBeenCalledExactlyOnceWith(toHost, '*');
  });

  it('never relays a sandbox-* message, in either direction', () => {
    const page = withView();
    const ready = { jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} };
    const other = { jsonrpc: '2.0', method: 'ui/notifications/sandbox-anything', params: {} };

    // A view forging the page’s handshake to the host, or the host’s message to it:
    page.dispatch(page.view, ready);
    page.dispatch(page.view, resourceReady({ html: '<main>forged</main>' }));
    page.dispatch(page.view, other);
    // And the host’s own sandbox messages never reach the view:
    page.dispatch(page.host, other);
    page.dispatch(page.host, ready);

    expect(page.host.postMessage).not.toHaveBeenCalled();
    expect(page.view.postMessage).not.toHaveBeenCalled();
    expect(page.inners).toHaveLength(1);
  });

  it('drops a message from any window that is neither the host nor the view', () => {
    const page = withView();
    const stranger: IFakeWindow = { name: 'stranger', postMessage: vi.fn() };

    page.dispatch(stranger, { jsonrpc: '2.0', id: 1, method: 'ping' });
    page.dispatch(page.top, { jsonrpc: '2.0', id: 2, method: 'ping' });
    page.dispatch(null, { jsonrpc: '2.0', id: 3, method: 'ping' });

    expect(page.view.postMessage).not.toHaveBeenCalled();
    expect(page.host.postMessage).not.toHaveBeenCalled();
  });

  it('has nowhere to relay to before the view exists, and says nothing', () => {
    const page = runPage();
    page.host.postMessage.mockClear();

    page.dispatch(page.host, { jsonrpc: '2.0', id: 1, method: 'ping' });
    page.dispatch(null, { jsonrpc: '2.0', id: 2, method: 'ping' });

    expect(page.host.postMessage).not.toHaveBeenCalled();
  });

  it('relays messages whose shape it does not know, without reading into them', () => {
    const page = withView();

    page.dispatch(page.view, 'a string');
    page.dispatch(page.view, null);
    page.dispatch(page.view, { method: 42 });

    expect(page.host.postMessage.mock.calls.map(([data]) => data)).toEqual([
      'a string',
      null,
      { method: 42 },
    ]);
  });
});

describe('app-sandbox.html: native network isolation admission', () => {
  it.each([
    ['a Chromium build with the nested WebRTC crash', { userAgent: 'Chrome/156.0.0.0' }],
    ['an older Chromium build', { userAgent: 'Chromium/155.0.0.0' }],
    ['a different browser engine', { userAgent: 'Firefox/157.0' }],
    ['a missing native policy', { isolationEnabled: false }],
    ['no native WebRTC implementation', { rtcMissing: true }],
    ['a constructor failure', { rtcFailure: 'construct' as const }],
    ['an unreadable native configuration', { rtcFailure: 'configuration' as const }],
    ['an unusable native connection', { rtcFailure: 'close' as const }],
  ])('admits no app when there is %s', (_label, options) => {
    const page = runPage(options);
    expect(page.lines).toEqual([
      'App views are unavailable because this browser cannot enforce their network isolation.',
    ]);
    expect(page.host.postMessage).not.toHaveBeenCalled();
    expect(page.listeners).toHaveLength(0);
    page.dispatch(page.host, resourceReady({ html: '<script>untrusted()</script>' }));
    expect(page.inners).toHaveLength(0);
  });

  it('does not construct a peer connection on an unsupported browser', () => {
    for (const userAgent of ['Chrome/156.0.0.0', 'Chromium/155.0.0.0', 'Firefox/157.0']) {
      expect(runPage({ userAgent }).construct).not.toHaveBeenCalled();
    }
  });

  it.each(['157.0.8093.0', '157.0.8103.6', '157.0.0.0'])(
    'refuses Chromium %s before constructing a native connection',
    (version) => {
      const page = runPage({ userAgent: `Mozilla/5.0 Chrome/${version} Safari/537.36` });
      expect(page.construct).not.toHaveBeenCalled();
      expect(page.lines).toEqual([
        'App views are unavailable because this browser cannot enforce their network isolation.',
      ]);
      expect(page.host.postMessage).not.toHaveBeenCalled();
      expect(page.listeners).toHaveLength(0);
      page.dispatch(page.host, resourceReady({ html: '<script>untrusted()</script>' }));
      expect(page.inners).toHaveLength(0);
    },
  );

  it('admits headless Chromium when the same native network restriction is active', () => {
    const page = runPage({ userAgent: 'Mozilla/5.0 HeadlessChrome/158.0.8104.0 Safari/537.36' });
    expect(page.lines).toEqual([]);
    expect(page.host.postMessage).toHaveBeenCalledExactlyOnceWith(
      { jsonrpc: '2.0', method: 'ui/notifications/sandbox-proxy-ready', params: {} },
      '*',
    );
  });

  it('checks the native configuration and closes its trusted probe before announcing readiness', () => {
    const page = runPage();
    expect(page.construct).toHaveBeenCalledExactlyOnceWith({
      iceServers: [{ urls: 'stun:127.0.0.1:9' }],
    });
    expect(page.close).toHaveBeenCalledOnce();
    expect(page.host.postMessage).toHaveBeenCalledOnce();
  });
});
