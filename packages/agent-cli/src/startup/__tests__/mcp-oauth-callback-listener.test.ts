/**
 * The product's MCP sign-in opens the Node host's loopback callback listener under
 * the `oauth-callback` row. Plain mode listens exactly as before; secure mode keeps the callback,
 * because its rule (loopback, bound by a fresh path or a required state, single use, a timeout, no
 * session) admits nothing a same-user program could use.
 */
import { request } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { productOAuthCallbackListener } from '../mcp-oauth-host.js';

afterEach(() => cleanupTestProductRuntimes());

function get(url: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const sent = request(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    sent.on('error', reject);
    sent.end();
  });
}

describe.each([
  ['plain', false],
  ['secure', true],
] as const)('the MCP OAuth callback listener in %s mode', (_mode, secure) => {
  it('listens on loopback for the one redirect that carries its state', async () => {
    const runtime = createTestProductRuntime();
    overrideProductSecureMode(runtime, secure);
    const listener = productOAuthCallbackListener(runtime);

    const server = await listener.listen({ expectedState: 'expected-state', timeoutMs: 5_000 });
    try {
      const redirect = new URL(server.redirectUri);
      expect(redirect.hostname).toBe('127.0.0.1');
      expect(redirect.pathname).toBe('/callback');
      expect(await get(`${server.redirectUri}?code=c&state=other-state`)).toBe(400);
      expect(await get(`${server.redirectUri}?code=c&state=expected-state`)).toBe(200);
      await expect(server.wait()).resolves.toMatchObject({ code: 'c' });
    } finally {
      await server.close();
    }
  });

  it('finds a free loopback port for a pasted redirect', async () => {
    const runtime = createTestProductRuntime();
    overrideProductSecureMode(runtime, secure);

    const port = await productOAuthCallbackListener(runtime).freePort();

    expect(port).toBeGreaterThan(0);
  });
});
