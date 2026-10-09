import { describe, expect, it, vi } from 'vitest';

import { resolveClientRuntimeHost } from '../runtime-host.js';

const browser = {
  document: { querySelector: () => null },
  location: { search: '', host: 'localhost:8787', protocol: 'https:' },
};

describe('public client runtime host', () => {
  it('resolves a browser endpoint using secure WebSocket on an HTTPS page', async () => {
    const host = resolveClientRuntimeHost(browser);
    expect(host.kind).toBe('browser');
    await expect(host.getEndpoint()).resolves.toBe('wss://localhost:8787');
    expect(host.trustQuestion).toBeUndefined();
    expect(host.restartRuntime).toBeUndefined();
  });

  it('uses the injected endpoint before the query string', async () => {
    const host = resolveClientRuntimeHost({
      document: {
        querySelector: () => ({ getAttribute: () => 'wss://127.0.0.1:9999/session' }),
      },
      location: { search: '?ws=ws://other:1234', host: 'localhost:8787', protocol: 'https:' },
    });
    await expect(host.getEndpoint()).resolves.toBe('wss://127.0.0.1:9999/session');
  });

  it('keeps trust before endpoint available to a desktop consumer and forwards lifecycle callbacks', async () => {
    const getEndpoint = vi.fn(async () => 'ws://127.0.0.1:9999/session');
    const trustQuestion = vi.fn(async () => ({ folder: '/tmp/project', loads: ['settings'] }));
    const signalReady = vi.fn();
    const restartRuntime = vi.fn(async () => {});
    const onState = vi.fn(() => () => {});
    const host = resolveClientRuntimeHost({
      ...browser,
      bridge: {
        getEndpoint,
        trustQuestion,
        signalReady,
        restartRuntime,
        onState,
        answerTrust: vi.fn(async () => ({})),
      },
    });

    expect(host.kind).toBe('desktop');
    await expect(host.trustQuestion?.()).resolves.toEqual({
      folder: '/tmp/project', loads: ['settings'],
    });
    expect(getEndpoint).not.toHaveBeenCalled();
    await expect(host.getEndpoint()).resolves.toBe('ws://127.0.0.1:9999/session');
    host.signalReady();
    await host.restartRuntime?.();
    host.onState(() => {});
    expect(signalReady).toHaveBeenCalledOnce();
    expect(restartRuntime).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenCalledOnce();
  });

  it('omits local trust and filesystem actions for a remote desktop runtime', () => {
    const host = resolveClientRuntimeHost({
      ...browser,
      bridge: {
        runtimeMode: 'remote',
        getEndpoint: async () => 'wss://remote.example/session',
        signalReady: () => {},
        onState: () => () => {},
        restartRuntime: async () => {},
        trustQuestion: async () => null,
        answerTrust: async () => ({}),
        pickFiles: async () => [],
        getPathForFile: () => '/tmp/file',
        openPath: async () => ({}),
      },
    });
    expect(host.trustQuestion).toBeUndefined();
    expect(host.answerTrust).toBeUndefined();
    expect(host.pickFiles).toBeUndefined();
    expect(host.getPathForFile).toBeUndefined();
    expect(host.openMemoryInEditor).toBeUndefined();
  });
});
