/**
 * #3186 — one web frontend, several hosts. The desktop app hands the page its sidecar through the
 * Electron preload bridge; in a browser the address comes from the page itself. The frontend never
 * needs to know which one it runs in beyond this seam.
 */

import { describe, expect, it, vi } from 'vitest';

import { resolveGuiHost } from '../gui-host.js';

import type { IDesktopBridge } from '../gui-host.js';

function page(options: { meta?: string; search?: string; host?: string } = {}): Parameters<
  typeof resolveGuiHost
>[0] {
  return {
    bridge: undefined,
    document: {
      querySelector: (selector: string) =>
        selector === 'meta[name="ws-url"]' && options.meta !== undefined
          ? ({ getAttribute: () => options.meta } as unknown as Element)
          : null,
    },
    location: { search: options.search ?? '', host: options.host ?? 'localhost:5173' },
  };
}

describe('resolveGuiHost', () => {
  it('uses the desktop bridge when the Electron preload provides one', async () => {
    const bridge: IDesktopBridge = {
      getEndpoint: vi.fn(async () => 'ws://127.0.0.1:1?token=t'),
      signalReady: vi.fn(),
      onState: vi.fn(() => () => {}),
    };
    const host = resolveGuiHost({ ...page(), bridge });
    expect(host.kind).toBe('desktop');
    await expect(host.getEndpoint()).resolves.toBe('ws://127.0.0.1:1?token=t');
    host.signalReady();
    expect(bridge.signalReady).toHaveBeenCalled();
  });

  it('in a browser, prefers the address the CLI injected into the page', async () => {
    const host = resolveGuiHost(page({ meta: 'ws://127.0.0.1:4321?token=a', search: '?ws=ws%3A%2F%2Fother' }));
    expect(host.kind).toBe('browser');
    await expect(host.getEndpoint()).resolves.toBe('ws://127.0.0.1:4321?token=a');
  });

  it('in a browser without an injected address, takes ?ws= from the page URL', async () => {
    const url = 'ws://127.0.0.1:7070?token=dev';
    const host = resolveGuiHost(page({ search: `?ws=${encodeURIComponent(url)}` }));
    await expect(host.getEndpoint()).resolves.toBe(url);
  });

  it('falls back to the page host, where HTTP and WS share a port', async () => {
    const host = resolveGuiHost(page({ host: '127.0.0.1:9000' }));
    await expect(host.getEndpoint()).resolves.toBe('ws://127.0.0.1:9000');
  });

  it('a browser host has no process to supervise: ready is a no-op and no state ever arrives', () => {
    const host = resolveGuiHost(page());
    const listener = vi.fn();
    const off = host.onState(listener);
    host.signalReady();
    off();
    expect(listener).not.toHaveBeenCalled();
  });
});
