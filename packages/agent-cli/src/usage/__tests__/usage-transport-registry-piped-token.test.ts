import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';

const constructed = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@robota-sdk/agent-transport/ws', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-transport/ws')>();
  return {
    ...actual,
    // Records what the shell hands the transport; nothing here listens on a port.
    WsTransport: class {
      constructor(options: Record<string, unknown>) {
        constructed.push(options);
      }
    },
  };
});

const { createCliUsageTransportRegistry } = await import('../usage-transport-registry.js');

const PIPED = 'ab12'.repeat(16);
const AMBIENT = 'cd34'.repeat(16);
const store = {} as IInteractiveSessionStore;

afterEach(() => {
  constructed.length = 0;
  vi.unstubAllEnvs();
});

describe('CLI WebSocket admission with a token handed over outside the environment', () => {
  it('serves under that token and writes it into no environment', () => {
    const runtime = createTestProductRuntime();
    createCliUsageTransportRegistry(
      runtime,
      store,
      false,
      false,
      undefined,
      true,
      undefined,
      PIPED,
    );
    expect(constructed).toHaveLength(1);
    expect(constructed[0]).toMatchObject({ token: PIPED, allowedOrigins: ['file://'] });
    expect(JSON.stringify(runtime.environment)).not.toContain(PIPED);
    expect(JSON.stringify(process.env)).not.toContain(PIPED);
  });

  it('prefers it over a token the environment carries, which still serves when none is piped', () => {
    const runtime = createTestProductRuntime('test-product', { PRODUCT_WS_TOKEN: AMBIENT });
    createCliUsageTransportRegistry(
      runtime,
      store,
      false,
      false,
      undefined,
      true,
      undefined,
      PIPED,
    );
    createCliUsageTransportRegistry(runtime, store, false, false, undefined, true, undefined);
    expect(constructed.map((options) => options['token'])).toEqual([PIPED, AMBIENT]);
  });

  it('attributes a plain token-bearing serve to the desktop app and a daemon to remote clients', () => {
    createCliUsageTransportRegistry(
      createTestProductRuntime(),
      store,
      false,
      false,
      undefined,
      false,
      undefined,
      PIPED,
    );
    createCliUsageTransportRegistry(
      createTestProductRuntime(),
      store,
      false,
      false,
      undefined,
      true,
      undefined,
      PIPED,
    );
    expect(constructed.map((options) => [options['driverId'], options['surface']])).toEqual([
      ['app', 'desktop-app'],
      ['remote:ws', 'remote'],
    ]);
  });
});
