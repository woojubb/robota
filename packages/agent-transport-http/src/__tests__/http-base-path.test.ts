import { describe, expect, it } from 'vitest';

import { createHttpTransport } from '../http-transport.js';

import type { IHttpTransportSession } from '../http-session.js';

/**
 * Issue #2480 (TRANS-002): `basePath` was declared and advertised but never read, so routes always
 * mounted at root. It is honored now.
 */
describe('createHttpTransport basePath', () => {
  it('mounts every route under basePath when one is given', async () => {
    const transport = createHttpTransport({
      basePath: '/api',
      admission: { open: true, openReason: 'basePath test' },
    });
    transport.attach({} as IHttpTransportSession);
    await transport.start();
    const paths = transport.getApp().routes.map((route) => route.path);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.startsWith('/api'))).toBe(true);
  });

  it('mounts at root when basePath is absent', async () => {
    const transport = createHttpTransport({
      admission: { open: true, openReason: 'basePath test' },
    });
    transport.attach({} as IHttpTransportSession);
    await transport.start();
    const paths = transport.getApp().routes.map((route) => route.path);
    expect(paths.some((path) => path.startsWith('/api'))).toBe(false);
  });
});
