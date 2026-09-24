import { describe, expect, it } from 'vitest';
import { DagOrchestrationHttpClient } from '../orchestration-http-client.js';

const TEST_SERVER_URL = 'http://127.0.0.1:3012';

interface ICapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

interface IFakePayload {
  readonly ok?: boolean;
  readonly status?: number;
  readonly data?: object;
  readonly errors?: readonly object[];
}

function createClient(responses: readonly IFakePayload[]): {
  readonly client: DagOrchestrationHttpClient;
  readonly requests: ICapturedRequest[];
} {
  const requests: ICapturedRequest[] = [];
  let responseIndex = 0;
  const client = new DagOrchestrationHttpClient({
    baseUrl: `${TEST_SERVER_URL}/`,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init: init ?? {} });
      const payload = responses[responseIndex] ?? { ok: true, status: 200 };
      responseIndex += 1;
      return new Response(JSON.stringify(payload), {
        status: payload.status ?? (payload.ok === false ? 400 : 200),
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, requests };
}

function createDefinition() {
  return {
    dagId: 'demo dag',
    version: 1,
    status: 'draft' as const,
    nodes: [],
    edges: [],
  };
}

describe('DagOrchestrationHttpClient', () => {
  it('lists definitions with encoded dagId query', async () => {
    const { client, requests } = createClient([{ ok: true, status: 200, data: { items: [] } }]);

    const result = await client.listDefinitions({ dagId: 'demo dag' });

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/definitions?dagId=demo%20dag`);
    expect(requests[0]?.init.method).toBe('GET');
  });

  it('updates draft definitions through the shared API route contract', async () => {
    const definition = createDefinition();
    const { client, requests } = createClient([{ ok: true, status: 200, data: { definition } }]);

    const result = await client.updateDraft({
      dagId: definition.dagId,
      version: definition.version,
      definition,
    });

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/definitions/demo%20dag/draft`);
    expect(requests[0]?.init.method).toBe('PUT');
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      version: 1,
      definition,
    });
  });

  it('creates partial runs without duplicating client code in downstream packages', async () => {
    const definition = createDefinition();
    const { client, requests } = createClient([
      { ok: true, status: 201, data: { preparationId: 'prep-1' } },
    ]);

    const result = await client.createRun({
      definition,
      input: { prompt: 'hello' },
      partialRun: { startNodeId: 'node-a' },
    });

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/runs`);
    expect(requests[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      definition,
      input: { prompt: 'hello' },
      partialRun: { startNodeId: 'node-a' },
    });
  });

  it('cancels a run through the encoded POST route and preserves the server response', async () => {
    const payload = { ok: true, status: 200, data: { dagRunId: 'run 1', status: 'cancelled' } };
    const { client, requests } = createClient([payload]);

    const result = await client.cancelRun('run 1');

    expect(requests[0]?.url).toBe(`${TEST_SERVER_URL}/v1/dag/runs/run%201/cancel`);
    expect(requests[0]?.init.method).toBe('POST');
    expect(result).toEqual({ ok: true, status: 200, payload });
  });

  it('calls run draft endpoints through package-owned HTTP contracts', async () => {
    const definition = createDefinition();
    const draft = {
      draftId: 'draft 1',
      definition,
      input: { prompt: 'hello' },
      nodeStateMap: {},
      createdAt: '2026-09-23T00:00:00.000Z',
      updatedAt: '2026-09-23T00:00:00.000Z',
    };
    const { client, requests } = createClient([
      { ok: true, status: 201, data: { draft } },
      { ok: true, status: 200, data: { draft } },
      { ok: true, status: 200, data: { draft } },
      { ok: true, status: 200, data: { draft } },
      { ok: true, status: 200, data: { draft } },
    ]);

    const createResult = await client.createRunDraft({
      draftId: 'draft 1',
      definition,
      input: { prompt: 'hello' },
    });
    await client.getRunDraft('draft 1');
    await client.replaceRunDraft('draft 1', {
      definition,
      input: { prompt: 'updated' },
    });
    await client.resetRunDraftNodeResult('draft 1', 'source node');
    await client.overwriteRunDraftNodeResult('draft 1', 'source node', {
      input: { prompt: 'manual' },
      output: { text: 'manual result' },
    });

    expect(createResult).toMatchObject({ ok: true, value: draft });
    expect(requests.map((request) => request.url)).toEqual([
      `${TEST_SERVER_URL}/v1/dag/run-drafts`,
      `${TEST_SERVER_URL}/v1/dag/run-drafts/draft%201`,
      `${TEST_SERVER_URL}/v1/dag/run-drafts/draft%201`,
      `${TEST_SERVER_URL}/v1/dag/run-drafts/draft%201/nodes/source%20node/reset`,
      `${TEST_SERVER_URL}/v1/dag/run-drafts/draft%201/nodes/source%20node/result`,
    ]);
    expect(requests.map((request) => request.init.method)).toEqual([
      'POST',
      'GET',
      'PUT',
      'POST',
      'PUT',
    ]);
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      draftId: 'draft 1',
      definition,
      input: { prompt: 'hello' },
    });
    expect(JSON.parse(String(requests[2]?.init.body))).toEqual({
      definition,
      input: { prompt: 'updated' },
    });
    expect(requests[3]?.init.body).toBeUndefined();
    expect(JSON.parse(String(requests[4]?.init.body))).toEqual({
      input: { prompt: 'manual' },
      output: { text: 'manual result' },
    });
  });

  it('rejects malformed successful run-draft data and preserves a missing-draft error', async () => {
    const { client } = createClient([
      { ok: true, status: 200, data: { draft: { draftId: 'incomplete' } } },
      {
        ok: false,
        status: 404,
        errors: [{ code: 'DAG_RUN_DRAFT_NOT_FOUND', detail: 'Run draft not found.' }],
      },
    ]);
    expect(await client.getRunDraft('incomplete')).toMatchObject({
      ok: false,
      error: { code: 'DAG_RUN_DRAFT_INVALID_RESPONSE' },
    });
    expect(await client.getRunDraft('missing')).toMatchObject({
      ok: false,
      error: { code: 'DAG_RUN_DRAFT_NOT_FOUND', retryable: false },
    });
  });

  it('does not expose transport exception details in a run-draft domain error', async () => {
    const client = new DagOrchestrationHttpClient({
      baseUrl: TEST_SERVER_URL,
      fetch: async () => {
        throw new Error('request failed with token secret-123');
      },
    });
    const result = await client.getRunDraft('draft-1');
    expect(result).toMatchObject({ ok: false, error: { code: 'DAG_RUN_DRAFT_TRANSPORT_ERROR' } });
    expect(JSON.stringify(result)).not.toContain('secret-123');
  });

  it('treats null or malformed run-draft JSON as a non-retryable invalid response', async () => {
    const bodies = ['null', '{broken'];
    const client = new DagOrchestrationHttpClient({
      baseUrl: TEST_SERVER_URL,
      fetch: async () =>
        new Response(bodies.shift(), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    for (const draftId of ['null', 'malformed']) {
      expect(await client.getRunDraft(draftId)).toMatchObject({
        ok: false,
        error: { code: 'DAG_RUN_DRAFT_INVALID_RESPONSE', retryable: false },
      });
    }
  });

  it('keeps a non-JSON 5xx run-draft reply retryable as a server failure', async () => {
    const client = new DagOrchestrationHttpClient({
      baseUrl: TEST_SERVER_URL,
      fetch: async () => new Response('upstream unavailable', { status: 503 }),
    });
    expect(await client.getRunDraft('draft-1')).toMatchObject({
      ok: false,
      error: { code: 'DAG_RUN_DRAFT_SERVER_ERROR', retryable: true },
    });
  });

  it('starts a published workflow run with optional version and overrides', async () => {
    const { client, requests } = createClient([
      {
        ok: true,
        status: 202,
        data: {
          dagRunId: 'run-1',
          preparationId: 'prep-1',
          dagId: 'published dag',
          version: 3,
        },
      },
    ]);

    const result = await client.startPublishedWorkflowRun(
      'published dag',
      {
        input: { prompt: 'hello' },
        overrides: {
          'text-1': { template: 'override-template' },
        },
      },
      3,
    );

    expect(result.status).toBe(202);
    expect(requests[0]?.url).toBe(
      `${TEST_SERVER_URL}/v1/dag/workflows/published%20dag/runs?version=3`,
    );
    expect(requests[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      input: { prompt: 'hello' },
      overrides: {
        'text-1': { template: 'override-template' },
      },
    });
  });

  it('calls asset upload and metadata endpoints while leaving content as a binary URL', async () => {
    const { client, requests } = createClient([
      {
        ok: true,
        status: 201,
        data: {
          asset: {
            referenceType: 'asset',
            assetId: 'asset 1',
            mediaType: 'image/png',
            uri: `${TEST_SERVER_URL}/v1/dag/assets/asset%201/content`,
            name: 'photo.png',
            sizeBytes: 4,
            runtimeAssetId: 'runtime-asset-1',
          },
        },
      },
      {
        ok: true,
        status: 200,
        data: {
          asset: {
            referenceType: 'asset',
            assetId: 'asset 1',
            mediaType: 'image/png',
            uri: `${TEST_SERVER_URL}/v1/dag/assets/asset%201/content`,
            name: 'photo.png',
            sizeBytes: 4,
          },
        },
      },
    ]);

    const uploadResult = await client.uploadAsset({
      fileName: 'photo.png',
      mediaType: 'image/png',
      base64Data: 'AQIDBA==',
    });
    const metadataResult = await client.getAssetMetadata('asset 1');
    const contentInfo = client.getAssetContentDownloadInfo('asset 1');

    expect(uploadResult.status).toBe(201);
    expect(metadataResult.status).toBe(200);
    expect(requests.map((request) => request.url)).toEqual([
      `${TEST_SERVER_URL}/v1/dag/assets`,
      `${TEST_SERVER_URL}/v1/dag/assets/asset%201`,
    ]);
    expect(requests.map((request) => request.init.method)).toEqual(['POST', 'GET']);
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      fileName: 'photo.png',
      mediaType: 'image/png',
      base64Data: 'AQIDBA==',
    });
    expect(contentInfo).toEqual({
      assetId: 'asset 1',
      url: `${TEST_SERVER_URL}/v1/dag/assets/asset%201/content`,
      method: 'GET',
      responseType: 'binary',
      contentTypeHeader: 'Content-Type',
      contentDispositionHeader: 'Content-Disposition',
    });
  });
});
