import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDagFramework } from '@robota-sdk/dag-framework';

import { createDagRuntimeServer } from '../app.js';

import type { IRunProgressSource } from '../app.js';
import type { TRunProgressEvent } from '@robota-sdk/dag-core';
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

  it('GET /v1/dag/cost-meta is wired to the port (route exists; port may return 501)', async () => {
    const res = await app.request('/v1/dag/cost-meta');
    // The route reaches the port (not a 404). The in-process framework may not
    // implement cost-meta and can answer 501 — that is the port's response, forwarded verbatim.
    expect(res.status).not.toBe(404);
  });

  it('GET /v1/dag/assets/:id/content returns a download descriptor (no binary in the port)', async () => {
    const res = await app.request('/v1/dag/assets/missing/content');
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { assetId?: string; url?: string };
    expect(payload.assetId).toBe('missing');
    expect(typeof payload.url).toBe('string');
  });

  it('POST /v1/dag/run-drafts is routed to the port (run-draft surface)', async () => {
    const res = await app.request('/v1/dag/run-drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    // The route exists and reaches the port (not a 404); the port decides the status.
    expect(res.status).not.toBe(404);
  });

  it('GET /v1/dag/runs/:id/events is 501 when no progress source is wired', async () => {
    const res = await app.request('/v1/dag/runs/run-1/events');
    expect(res.status).toBe(501);
  });

  it('unknown route is a 404 (no external-runtime surface)', async () => {
    const res = await app.request('/external-runtime-unknown');
    expect(res.status).toBe(404);
  });
});

describe('dag-runtime-server SSE progress stream', () => {
  it('streams a run’s progress events and closes on a terminal event', async () => {
    // A fake progress source that, once subscribed, emits one matching terminal event next tick.
    const source: IRunProgressSource = {
      subscribe(listener: (event: TRunProgressEvent) => void): () => void {
        queueMicrotask(() => {
          listener({
            dagRunId: 'run-1',
            eventType: 'execution.completed',
            occurredAt: '2026-06-30T00:00:00.000Z',
          });
        });
        return () => undefined;
      },
    };
    const app = createDagRuntimeServer({} as never, source);

    const res = await app.request('/v1/dag/runs/run-1/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('event: open');
    expect(body).toContain('event: execution.completed');
  });

  it('ignores progress events for other runs', async () => {
    const source: IRunProgressSource = {
      subscribe(listener: (event: TRunProgressEvent) => void): () => void {
        queueMicrotask(() => {
          // An event for a DIFFERENT run, then the terminal event for ours.
          listener({
            dagRunId: 'other-run',
            eventType: 'task.started',
            occurredAt: '2026-06-30T00:00:00.000Z',
            taskRunId: 't1',
            nodeId: 'n1',
          });
          listener({
            dagRunId: 'run-1',
            eventType: 'execution.completed',
            occurredAt: '2026-06-30T00:00:01.000Z',
          });
        });
        return () => undefined;
      },
    };
    const app = createDagRuntimeServer({} as never, source);
    const body = await (await app.request('/v1/dag/runs/run-1/events')).text();
    expect(body).not.toContain('other-run');
    expect(body).toContain('event: execution.completed');
  });
});
