/**
 * #3186 — one web frontend, several hosts. The desktop app hands the page its sidecar through the
 * Electron preload bridge; in a browser the address comes from the page itself. The frontend never
 * needs to know which one it runs in beyond this seam.
 */

import { describe, expect, it, vi } from 'vitest';

import { resolveGuiHost } from '../gui-host.js';

import type { IDesktopBridge } from '../gui-host.js';

function page(
  options: { meta?: string; search?: string; host?: string } = {},
): Parameters<typeof resolveGuiHost>[0] {
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
      restartRuntime: vi.fn(async () => {}),
      trustQuestion: vi.fn(async () => null),
      answerTrust: vi.fn(async () => ({})),
      pickFiles: vi.fn(async () => [{ path: '/repo/a.ts', name: 'a.ts', size: 10 }]),
      getPathForFile: vi.fn(() => '/repo/dropped.ts'),
      onOpenSettings: vi.fn(() => () => {}),
      openPath: vi.fn(async () => ({})),
    };
    const host = resolveGuiHost({ ...page(), bridge });
    expect(host.kind).toBe('desktop');
    await expect(host.getEndpoint()).resolves.toBe('ws://127.0.0.1:1?token=t');
    host.signalReady();
    expect(bridge.signalReady).toHaveBeenCalled();
    await host.restartRuntime?.();
    expect(bridge.restartRuntime).toHaveBeenCalled();
    await expect(host.trustQuestion?.()).resolves.toBeNull();
    await host.answerTrust?.('restricted');
    expect(bridge.answerTrust).toHaveBeenCalledWith('restricted');
    // #3282 §4d: the composer's attach button and drop handler reach the bridge through these two.
    await expect(host.pickFiles?.()).resolves.toEqual([
      { path: '/repo/a.ts', name: 'a.ts', size: 10 },
    ]);
    const file = new File(['x'], 'dropped.ts');
    expect(host.getPathForFile?.(file)).toBe('/repo/dropped.ts');
    expect(bridge.getPathForFile).toHaveBeenCalledWith(file);
    const listener = vi.fn();
    host.onOpenSettings(listener);
    expect(bridge.onOpenSettings).toHaveBeenCalledWith(listener);
    // #3282 §4c: the Project panel's Memory "Open in editor" reaches the bridge's openPath.
    host.openMemoryInEditor?.('.fixture-state/memory/MEMORY.md');
    expect(bridge.openPath).toHaveBeenCalledWith('.fixture-state/memory/MEMORY.md');
  });

  it('keeps remote task paths outside the local desktop filesystem', () => {
    const bridge = {
      runtimeMode: 'remote',
      getEndpoint: vi.fn(),
      signalReady: vi.fn(),
      onState: vi.fn(),
      restartRuntime: vi.fn(),
      trustQuestion: vi.fn(),
      answerTrust: vi.fn(),
      pickFiles: vi.fn(),
      getPathForFile: vi.fn(),
      openPath: vi.fn(),
      onOpenSettings: vi.fn(),
    } as unknown as IDesktopBridge;
    const host = resolveGuiHost({ ...page(), bridge });
    expect(host.pickFiles).toBeUndefined();
    expect(host.getPathForFile).toBeUndefined();
    expect(host.openMemoryInEditor).toBeUndefined();
    expect(host.trustQuestion).toBeUndefined();
    expect(host.restartRuntime).toBeDefined();
  });

  it('in a browser, prefers the address the CLI injected into the page', async () => {
    const host = resolveGuiHost(
      page({ meta: 'ws://127.0.0.1:4321?token=a', search: '?ws=ws%3A%2F%2Fother' }),
    );
    expect(host.kind).toBe('browser');
    expect(host.restartRuntime).toBeUndefined();
    // A browser page is served by a runtime that already started; there is nothing to ask first.
    expect(host.trustQuestion).toBeUndefined();
    await expect(host.getEndpoint()).resolves.toBe('ws://127.0.0.1:4321?token=a');
    // #3282 §4d: a plain browser has no native picker and no way to resolve a File's real path — the
    // composer reads the absence of these two as "attach only shows the plain sentence".
    expect(host.pickFiles).toBeUndefined();
    expect(host.getPathForFile).toBeUndefined();
    // #3282 §4c: a plain browser cannot open a file in an external editor — the Project panel's
    // Memory section reads this absence as "hide 'Open in editor' entirely".
    expect(host.openMemoryInEditor).toBeUndefined();
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

  it('a browser host has no menu: onOpenSettings is a harmless no-op', () => {
    const host = resolveGuiHost(page());
    const listener = vi.fn();
    const off = host.onOpenSettings(listener);
    off();
    expect(listener).not.toHaveBeenCalled();
  });
});
