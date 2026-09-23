import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDagFramework } from '@robota-sdk/dag-framework';
import { DagOrchestrationHttpClient } from '@robota-sdk/dag-orchestration-client';
import type { ICostMetaOperationsPort } from '@robota-sdk/dag-cost';

import { createDagRuntimeServer } from '../app.js';

import type { IRunProgressSource } from '../app.js';
import type { IAssetStore, IRunDraftOperationsPort, TRunProgressEvent } from '@robota-sdk/dag-core';
import type { IDagFramework } from '@robota-sdk/dag-framework';
import type { Hono } from 'hono';

describe('dag-runtime-server contract', () => {
  let framework: IDagFramework;
  let app: Hono;

  beforeEach(async () => {
    framework = await createDagFramework();
    await framework.start();
    app = createDagRuntimeServer(
      framework.client,
      framework.costMeta,
      framework.runDrafts,
      undefined,
      framework.assets,
    );
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
    const supportedApp = createDagRuntimeServer(framework.client, costMeta, framework.runDrafts);

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
    const failingApp = createDagRuntimeServer(framework.client, costMeta, framework.runDrafts);

    const res = await failingApp.request('/v1/dag/cost-meta');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('/private/secret.json');
  });

  it('round-trips run drafts through the separate domain capability', async () => {
    const client = new DagOrchestrationHttpClient({
      baseUrl: 'http://dag.test',
      fetch: async (url, init) => app.request(url, init),
    });
    const created = await client.createRunDraft({
      definition: { dagId: 'draft-test', version: 1, status: 'draft', nodes: [], edges: [] },
      input: { text: 'hello' },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const draftId = created.value.draftId;
    expect(await client.getRunDraft(draftId)).toEqual(created);

    const overwritten = await client.overwriteRunDraftNodeResult(draftId, 'node-1', {
      output: { text: 'done' },
    });
    expect(overwritten).toMatchObject({
      ok: true,
      value: { nodeStateMap: { 'node-1': { executionStatus: 'success' } } },
    });
    const reset = await client.resetRunDraftNodeResult(draftId, 'node-1');
    expect(reset).toMatchObject({ ok: true, value: { nodeStateMap: {} } });
  });

  it('rejects invalid run-draft input before the capability call', async () => {
    const res = await app.request('/v1/dag/run-drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        definition: { dagId: 'draft', version: 1, status: 'secret-123', nodes: [], edges: [] },
      }),
    });
    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    expect(body).toMatchObject({
      ok: false,
      errors: [{ code: 'DAG_RUN_DRAFT_INVALID_INPUT' }],
    });
    expect(JSON.stringify(body)).not.toContain('secret-123');
  });

  it('redacts storage details in a run-draft HTTP failure', async () => {
    const drafts = Object.create(framework.runDrafts) as IRunDraftOperationsPort;
    drafts.getRunDraft = async () => ({
      ok: false,
      error: {
        code: 'DAG_RUN_DRAFT_STORAGE_ERROR',
        category: 'dispatch',
        message: 'storage failed at /private/drafts.json',
        retryable: true,
      },
    });
    const failingApp = createDagRuntimeServer(framework.client, framework.costMeta, drafts);
    const res = await failingApp.request('/v1/dag/run-drafts/draft-1');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('/private/drafts.json');
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

  it('streams stored bytes through the asset content route and returns 404 for missing assets', async () => {
    const uploaded = await app.request('/v1/dag/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'hello.txt',
        mediaType: 'text/plain',
        base64Data: 'aGVsbG8=',
      }),
    });
    expect(uploaded.status).toBe(201);
    const payload = (await uploaded.json()) as { data: { asset: { assetId: string } } };
    const res = await app.request(`/v1/dag/assets/${payload.data.asset.assetId}/content`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe('hello');

    const missing = await app.request('/v1/dag/assets/missing/content');
    expect(missing.status).toBe(404);
  });

  it('preserves the upload and metadata HTTP client contract while serving binary content', async () => {
    const client = new DagOrchestrationHttpClient({
      baseUrl: 'http://dag.test',
      fetch: async (url, init) => app.request(url, init),
    });
    const uploaded = await client.uploadAsset({
      fileName: 'asset.bin',
      mediaType: 'application/octet-stream',
      base64Data: 'AAECAw==',
    });
    expect(uploaded.status).toBe(201);
    const data = uploaded.payload['data'] as { asset: { assetId: string } };
    const metadata = await client.getAssetMetadata(data.asset.assetId);
    expect(metadata).toMatchObject({
      ok: true,
      status: 200,
      payload: { data: { asset: { sizeBytes: 4 } } },
    });
    const binary = await app.request(client.getAssetContentDownloadInfo(data.asset.assetId).url);
    expect(Array.from(new Uint8Array(await binary.arrayBuffer()))).toEqual([0, 1, 2, 3]);
  });

  it('rejects invalid asset input and does not expose storage failures', async () => {
    const invalid = await app.request('/v1/dag/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'bad.txt',
        mediaType: 'text/plain',
        base64Data: 'not base64!',
      }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      errors: [{ type: 'urn:robota:error:dag:dag_asset_invalid_input' }],
    });
    expect(await framework.assets.getMetadata('bad')).toBeUndefined();

    const traversal = await app.request('/v1/dag/assets/..%2Fsecret');
    expect(traversal.status).toBe(400);

    const unwiredApp = createDagRuntimeServer(
      framework.client,
      framework.costMeta,
      framework.runDrafts,
    );
    const unwired = await unwiredApp.request('/v1/dag/assets/missing');
    expect(unwired.status).toBe(501);

    const broken = Object.create(framework.assets) as IAssetStore;
    broken.getMetadata = async () => {
      throw new Error('/private/secret.json');
    };
    const failingApp = createDagRuntimeServer(
      framework.client,
      framework.costMeta,
      framework.runDrafts,
      undefined,
      broken,
    );
    const failed = await failingApp.request('/v1/dag/assets/asset-id');
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain('/private/secret.json');
  });

  it('does not complete a successful download when its source stream fails', async () => {
    const broken = Object.create(framework.assets) as IAssetStore;
    broken.getContent = async () => ({
      metadata: {
        assetId: 'broken', fileName: 'broken.bin', mediaType: 'application/octet-stream',
        sizeBytes: 2, createdAt: '2026-01-01T00:00:00.000Z',
      },
      stream: (async function* () {
        yield Uint8Array.from([1]);
        throw new Error('/private/source.bin');
      })(),
    });
    const failingApp = createDagRuntimeServer(framework.client, framework.costMeta, framework.runDrafts, undefined, broken);
    const response = await failingApp.request('/v1/dag/assets/broken/content');
    await expect(response.arrayBuffer()).rejects.toThrow('Asset stream failed.');
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
    const app = createDagRuntimeServer({} as never, {} as never, {} as never, source);

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
    const app = createDagRuntimeServer({} as never, {} as never, {} as never, source);
    const body = await (await app.request('/v1/dag/runs/run-1/events')).text();
    expect(body).not.toContain('other-run');
    expect(body).toContain('event: execution.completed');
  });
});
