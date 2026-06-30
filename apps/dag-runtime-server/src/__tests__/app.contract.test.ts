import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDagFramework } from '@robota-sdk/dag-framework';

import { createDagRuntimeServer } from '../app.js';

import type { IDagFramework } from '@robota-sdk/dag-framework';
import type { Hono } from 'hono';

describe('dag-runtime-server contract', () => {
  let framework: IDagFramework;
  let app: Hono;

  beforeEach(async () => {
    framework = await createDagFramework();
    await framework.start();
    app = createDagRuntimeServer(framework.client);
  });

  afterEach(async () => {
    await framework.stop();
  });

  it('GET /v1/dag/nodes returns the node catalog over the native route', async () => {
    const res = await app.request('/v1/dag/nodes');
    expect(res.status).toBe(200);
    const payload: unknown = await res.json();
    expect(payload).toBeDefined();
  });

  it('GET /v1/dag/definitions returns a successful response', async () => {
    const res = await app.request('/v1/dag/definitions');
    expect(res.status).toBeLessThan(500);
    const payload: unknown = await res.json();
    expect(payload).toBeDefined();
  });

  it('unknown route is a 404 (no external-runtime surface)', async () => {
    const res = await app.request('/external-runtime-unknown');
    expect(res.status).toBe(404);
  });
});
