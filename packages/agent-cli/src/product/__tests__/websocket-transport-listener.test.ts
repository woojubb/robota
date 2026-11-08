/**
 * The CLI's WebSocket transport opens through its `SECURE_SURFACES` row. The TUI,
 * `--serve`, a daemon and the desktop sidecar all start it through the transport registry, so the
 * gate wraps the bound adapter the CLI registers. Plain mode binds exactly as before: loopback, the
 * launch token, and the settings `/transport` lists. Secure mode refuses it before anything binds.
 */
import { request } from 'node:http';
import { createServer } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import { SecureSurfaceRefusedError } from '../../secure/secure-surfaces.js';
import { createCliUsageTransportRegistry } from '../../usage/usage-transport-registry.js';
import { overrideProductSecureMode } from '../session-sealing.js';

import type {
  IInteractiveSession,
  IInteractiveSessionStore,
} from '@robota-sdk/agent-interface-session';

afterEach(() => {
  vi.unstubAllEnvs();
  cleanupTestProductRuntimes();
});

/** The transport reads a session only once a client is admitted; these cases admit none. */
const session = {} as IInteractiveSession;

/** A loopback port free right now, so the case never meets a running TUI on the default port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        resolve(typeof address === 'object' && address !== null ? address.port : 0),
      );
    });
  });
}

async function transports() {
  vi.stubEnv('PRODUCT_WS_TOKEN', undefined);
  const runtime = createTestProductRuntime('test-product', {
    PRODUCT_WS_PORT: String(await freePort()),
  });
  const wiring = createCliUsageTransportRegistry(
    runtime,
    {} as IInteractiveSessionStore,
    false,
    false,
  );
  wiring.bindTransports(session);
  return { runtime, ...wiring };
}

function plainGet(port: number): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = request({ host: '127.0.0.1', port, path: '/' }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    sent.on('error', reject);
    sent.end();
  });
}

function closeCode(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = new WebSocket(url);
    client.on('close', (code) => resolve(code));
    client.on('error', reject);
  });
}

describe('the WebSocket transport in plain mode', () => {
  it('binds loopback and admits only the launch token, as before the gate', async () => {
    const { registry, wsTransport } = await transports();
    await registry.startAll();
    try {
      const port = wsTransport.boundPort;
      expect(port).toBeGreaterThan(0);
      expect(await plainGet(port ?? 0)).toEqual({ status: 400, body: 'WebSocket endpoint' });
      expect(await closeCode(`ws://127.0.0.1:${port}`)).toBe(1008);
      expect(wsTransport.resolvedToken).toMatch(/\S{32,}/);
    } finally {
      await registry.stopAll();
    }
  });

  it('keeps every setting the registry and `/transport` read from the transport', async () => {
    const { registry } = await transports();
    const [entry] = registry.getAll();
    expect(entry?.transport.name).toBe('ws');
    expect(entry?.transport.defaultEnabled).toBe(true);
    expect(Object.keys(entry?.transport.optionsSchema ?? {}).sort()).toEqual([
      'maxRetries',
      'port',
    ]);
    expect(entry?.config.enabled).toBe(true);
    expect(registry.getEnabled().map((transport) => transport.name)).toEqual(['ws']);
  });
});

describe('the WebSocket transport in secure mode', () => {
  it('is refused with its reason, and nothing binds', async () => {
    const { runtime, registry, wsTransport } = await transports();
    overrideProductSecureMode(runtime, true);

    const failure: unknown = await registry.startAll().then(
      () => registry.stopAll().then(() => undefined),
      (error: unknown) => error,
    );

    expect((failure as { cause?: unknown } | undefined)?.cause).toBeInstanceOf(
      SecureSurfaceRefusedError,
    );
    expect(wsTransport.boundPort).toBeUndefined();
  });
});
