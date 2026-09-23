import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDagFramework } from '@robota-sdk/dag-framework';
import { DagOrchestrationHttpClient } from '@robota-sdk/dag-orchestration-client';
import type { ICostMetaOperationsPort } from '@robota-sdk/dag-cost';

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
    app = createDagRuntimeServer(framework.client, framework.costMeta);
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

  it('GET /v1/dag/cost-meta maps explicit unsupported capability to 501', async () => {
    const res = await app.request('/v1/dag/cost-meta');
    expect(res.status).toBe(501);
    expect(await res.json()).toMatchObject({
      ok: false,
      errors: [{ code: 'DAG_COST_META_UNSUPPORTED' }],
    });
  });

  it('round-trips cost capability unavailability through the HTTP client', async () => {
    const client = new DagOrchestrationHttpClient({
      baseUrl: 'http://dag.test',
      fetch: async (url, init) => app.request(url, init),
    });
    expect(await client.listCostMeta()).toMatchObject({
      ok: false,
      error: { code: 'DAG_COST_META_UNSUPPORTED' },
    });
  });

  it('maps a supported cost capability result to the existing HTTP response shape', async () => {
    const costMeta = Object.create(framework.costMeta) as ICostMetaOperationsPort;
    costMeta.listCostMeta = async () => ({ ok: true, value: [] });
    const supportedApp = createDagRuntimeServer(framework.client, costMeta);

    const res = await supportedApp.request('/v1/dag/cost-meta');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 200, data: { items: [] } });
  });

  it('does not expose internal cost failures in a 500 response', async () => {
    const costMeta = Object.create(framework.costMeta) as ICostMetaOperationsPort;
    costMeta.listCostMeta = async () => ({
      ok: false,
      error: {
        code: 'DAG_COST_META_INTERNAL',
        category: 'task_execution',
        message: 'storage failed at /private/secret.json',
        retryable: false,
      },
    });
    const failingApp = createDagRuntimeServer(framework.client, costMeta);

    const res = await failingApp.request('/v1/dag/cost-meta');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('/private/secret.json');
  });

  it('rejects invalid cost metadata JSON before invoking the capability', async () => {
    const res = await app.request('/v1/dag/cost-meta', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errors: [{ code: 'DAG_COST_META_INVALID' }] });
  });

  it('rejects a cost metadata update whose body node type disagrees with the path', async () => {
    const res = await app.request('/v1/dag/cost-meta/input', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'output',
        displayName: 'Output',
        category: 'transform',
        estimateFormula: '0',
        variables: {},
        enabled: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ errors: [{ code: 'DAG_COST_META_INVALID' }] });
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
    const app = createDagRuntimeServer({} as never, {} as never, source);

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
    const app = createDagRuntimeServer({} as never, {} as never, source);
    const body = await (await app.request('/v1/dag/runs/run-1/events')).text();
    expect(body).not.toContain('other-run');
    expect(body).toContain('event: execution.completed');
  });
});
