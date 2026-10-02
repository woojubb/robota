import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCliUsageTransportRegistry, resolveCliUsageAttribution } from '../usage-transport-registry.js';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

afterEach(() => vi.unstubAllEnvs());

describe('CLI WebSocket admission', () => {
  it('uses the transport auto-minted token when no desktop token is supplied', () => {
    vi.stubEnv('PRODUCT_WS_TOKEN', undefined);
    const store = {} as IInteractiveSessionStore;
    const first = createCliUsageTransportRegistry(createTestProductRuntime(), store, false, false);
    const second = createCliUsageTransportRegistry(createTestProductRuntime(), store, false, false);

    expect(first.wsTransport.resolvedToken).toBeTruthy();
    expect(second.wsTransport.resolvedToken).toBeTruthy();
    expect(first.wsTransport.resolvedToken).not.toBe(second.wsTransport.resolvedToken);
  });

  it('uses the supplied invocation token and removes the ambient copy', () => {
    vi.stubEnv('PRODUCT_WS_TOKEN', 'e'.repeat(64));
    const runtime = createTestProductRuntime('test-product', { PRODUCT_WS_TOKEN: 'e'.repeat(64) });
    const registry = createCliUsageTransportRegistry(runtime, {} as IInteractiveSessionStore, false, false);
    expect(registry.wsTransport.resolvedToken).toBe('e'.repeat(64));
    expect(runtime.environment['PRODUCT_WS_TOKEN']).toBe('e'.repeat(64));
    expect(process.env).not.toHaveProperty('PRODUCT_WS_TOKEN');
  });
});

describe('CLI usage attribution', () => {
  it('labels only a plain token-bearing serve as the desktop app, never a daemon', () => {
    expect(resolveCliUsageAttribution({ desktopToken: true, open: false, daemon: false }))
      .toEqual({ driverId: 'app', surface: 'desktop-app' });
    expect(resolveCliUsageAttribution({ desktopToken: true, open: false, daemon: true }))
      .toEqual({ driverId: 'remote:ws', surface: 'remote' });
    expect(resolveCliUsageAttribution({ desktopToken: false, open: true, daemon: false }))
      .toEqual({ driverId: 'browser', surface: 'browser' });
    expect(resolveCliUsageAttribution({ desktopToken: false, open: false, daemon: false }))
      .toEqual({ driverId: 'remote:ws', surface: 'remote' });
  });
});
