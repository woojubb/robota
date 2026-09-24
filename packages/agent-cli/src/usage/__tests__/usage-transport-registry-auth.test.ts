import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCliUsageTransportRegistry } from '../usage-transport-registry.js';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

afterEach(() => vi.unstubAllEnvs());

describe('CLI WebSocket admission', () => {
  it('uses the transport auto-minted token when no desktop token is supplied', () => {
    vi.stubEnv('ROBOTA_WS_TOKEN', undefined);
    const store = {} as IInteractiveSessionStore;
    const first = createCliUsageTransportRegistry(store, false, false);
    const second = createCliUsageTransportRegistry(store, false, false);

    expect(first.wsTransport.resolvedToken).toBeTruthy();
    expect(second.wsTransport.resolvedToken).toBeTruthy();
    expect(first.wsTransport.resolvedToken).not.toBe(second.wsTransport.resolvedToken);
  });
});
