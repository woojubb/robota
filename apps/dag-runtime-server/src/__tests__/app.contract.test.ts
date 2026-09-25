import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dag-runtime-server-contract-'));
    framework = await createDagFramework({
      paths: { storageRoot: path.join(tmpDir, 'storage'), assetRoot: path.join(tmpDir, 'assets') },
    });
    await framework.start();
    app = createDagRuntimeServer(
      framework.runs,
      framework.costMeta,
      framework.runDrafts,
      framework.build,
      framework.validation,
      framework.catalog,
      framework.definitionReads,
      framework.definitionMutations,
      undefined,
      framework.assets,
    );
  });

  afterEach(async () => {
    await framework.stop();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('GET /v1/dag/nodes returns the node catalog over the native route', async () => {
    const res = await app.request('/v1/dag/nodes');
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      ok: boolean;
      status: number;
      data: { items: Array<Record<string, unknown>> };
    };
    expect(payload.ok).toBe(true);
    expect(payload.status).toBe(200);
    const input = payload.data.items.find((item) => item['nodeType'] === 'input');
    expect(input).toMatchObject({
      nodeType: 'input',
      category: expect.any(String),
      inputs: expect.any(Array),
      outputs: expect.any(Array),
    });
    expect(input).not.toHaveProperty('defaultInputPort');
  });

  it('cancels a prepared run through the HTTP lifecycle and reports missing runs', async () => {
    const created = await framework.runs.createRun({
      definition: {
        dagId: 'cancel-over-http',
        version: 1,
        status: 'published',
        nodes: [{ nodeId: 'in', nodeType: 'input', dependsOn: [], config: { text: 'hello' } }],
        edges: [],
      },
      input: {},
    });
    if (!created.ok) throw new Error('Expected a prepared run');

    const path = `/v1/dag/runs/${created.value.dagRunId}/cancel`;
    const response = await app.request(path, { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      status: 200,
      data: { dagRunId: created.value.dagRunId, status: 'cancelled' },
    });
    const stored = await framework.runs.getRun(created.value.dagRunId);
    expect(stored.ok && stored.value.dagRun.status).toBe('cancelled');

    const repeated = await app.request(path, { method: 'POST' });
    expect(repeated.status).toBe(400);
    expect(await repeated.json()).toMatchObject({
      ok: false,
      status: 400,
      errors: [{ code: 'DAG_STATE_TRANSITION_INVALID' }],
    });

    const missing = await app.request('/v1/dag/runs/absent/cancel', { method: 'POST' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      ok: false,
      status: 404,
      errors: [{ code: 'DAG_VALIDATION_DAG_RUN_NOT_FOUND' }],
    });
  });

  it('GET /v1/dag/definitions returns a successful response', async () => {
    const res = await app.request('/v1/dag/definitions');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: 200,
      data: { items: expect.any(Array) },
    });
  });

  it('maps domain definition reads to the existing HTTP response and missing error', async () => {
    const built = await framework.build.buildDag({
      dagId: 'read-contract',
      pipeline: [{ nodeType: 'input', config: { text: 'hello' } }],
    });
    if (!built.ok) throw new Error('Expected a valid test definition.');
    expect((await framework.definitionMutations.createDefinition(built.definition)).ok).toBe(true);
    const found = await app.request('/v1/dag/definitions/read-contract?version=1');
    expect(found.status).toBe(200);
    expect(await found.json()).toMatchObject({
      ok: true,
      status: 200,
      data: { definition: { dagId: 'read-contract', version: 1 } },
    });
    const listed = await app.request('/v1/dag/definitions?dagId=read-contract');
    expect(await listed.json()).toEqual({
      ok: true,
      status: 200,
      data: { items: [{ dagId: 'read-contract', latestVersion: 1, statuses: ['draft'] }] },
    });

    const missing = await app.request('/v1/dag/definitions/absent?version=2');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      ok: false,
      status: 404,
      errors: [
        {
          type: 'urn:robota:problems:dag:validation',
          title: 'Validation failed',
          status: 400,
          detail: 'Definition does not exist',
          instance: '/v1/dag/definitions/absent?version=2',
          code: 'DAG_VALIDATION_DEFINITION_NOT_FOUND',
          retryable: false,
        },
      ],
    });
  });

  it('maps definition mutations to the existing success and validation envelopes', async () => {
    const built = await framework.build.buildDag({
      dagId: 'mutation-contract',
      pipeline: [{ nodeType: 'input', config: { text: 'hello' } }],
    });
    if (!built.ok) throw new Error('Expected a valid test definition.');
    const definition = built.definition;
    const create = () =>
      app.request('/v1/dag/definitions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ definition }),
      });
    const created = await create();
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      ok: true,
      status: 201,
      data: { definitionId: 'mutation-contract:1', definition: { status: 'draft' } },
    });
    const duplicate = await create();
    expect(duplicate.status).toBe(400);
    expect(await duplicate.json()).toMatchObject({
      ok: false,
      status: 400,
      errors: [
        {
          type: 'urn:robota:problems:dag:validation',
          title: 'Validation failed',
          status: 400,
          instance: '/v1/dag/definitions/mutation-contract/versions/1',
          code: 'DAG_VALIDATION_DUPLICATE_VERSION',
        },
      ],
    });

    const updated = await app.request('/v1/dag/definitions/mutation-contract/draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, definition }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      ok: true,
      status: 200,
      data: { definition: { dagId: 'mutation-contract', status: 'draft' } },
    });
    const validated = await app.request('/v1/dag/definitions/mutation-contract/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect(validated.status).toBe(200);
    expect(await validated.json()).toMatchObject({
      ok: true,
      status: 200,
      data: { valid: true, definition: { dagId: 'mutation-contract' } },
    });
    const published = await app.request('/v1/dag/definitions/mutation-contract/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(published.status).toBe(200);
    expect(await published.json()).toMatchObject({
      ok: true,
      status: 200,
      data: { definitionId: 'mutation-contract:2', definition: { status: 'published' } },
    });
    const republished = await app.request('/v1/dag/definitions/mutation-contract/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(republished.status).toBe(400);
    expect(await republished.json()).toMatchObject({
      ok: false,
      errors: [
        {
          instance: '/v1/dag/definitions/mutation-contract/versions/2/publish',
          code: 'DAG_VALIDATION_PUBLISH_ONLY_DRAFT',
        },
      ],
    });
  });

  it('preserves missing-definition errors for validation and versionless publishing', async () => {
    const validated = await app.request('/v1/dag/definitions/absent/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 4 }),
    });
    expect(validated.status).toBe(400);
    expect(await validated.json()).toMatchObject({
      ok: false,
      status: 400,
      errors: [
        {
          instance: '/v1/dag/definitions/absent/versions/4/validate',
          code: 'DAG_VALIDATION_DEFINITION_NOT_FOUND',
        },
      ],
    });
    const published = await app.request('/v1/dag/definitions/absent/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(published.status).toBe(404);
    expect(await published.json()).toEqual({
      ok: false,
      status: 404,
      errors: [
        {
          type: 'urn:robota:problems:dag:not_found',
          title: 'Resource not found',
          status: 404,
          detail: 'DAG definition not found',
          instance: '/v1/dag/definitions/absent/publish',
          code: 'DAG_NOT_FOUND',
          retryable: false,
        },
      ],
    });
  });

  it('maps domain run lifecycle results to the existing HTTP routes', async () => {
    const built = await framework.build.buildDag({
      dagId: 'run-boundary-contract',
      pipeline: [{ nodeType: 'input', config: { text: 'hello' } }],
    });
    if (!built.ok) throw new Error('Expected a valid test definition.');
    const created = await app.request('/v1/dag/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: built.definition, input: {} }),
    });
    expect(created.status).toBe(201);
    const createPayload = (await created.json()) as { data: { dagRunId: string; version: number } };
    expect(createPayload).toMatchObject({
      ok: true,
      status: 201,
      data: {
        dagRunId: expect.any(String),
        preparationId: expect.any(String),
        dagId: 'run-boundary-contract',
        version: 2,
        logicalDate: expect.any(String),
        status: expect.any(String),
      },
    });
    const runId = createPayload.data.dagRunId;
    const started = await app.request(`/v1/dag/runs/${runId}/start`, { method: 'POST' });
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({
      ok: true,
      status: 200,
      data: { dagRunId: runId, dagId: 'run-boundary-contract' },
    });
    for (const route of [`/v1/dag/runs/${runId}`, `/v1/dag/runs/${runId}/result`]) {
      const found = await app.request(route);
      expect(found.status).toBe(200);
      expect(await found.json()).toMatchObject({
        ok: true,
        status: 200,
        data: { dagRun: { dagRunId: runId }, taskRuns: expect.any(Array) },
      });
    }
    const published = await app.request('/v1/dag/definitions/run-boundary-contract/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    expect(published.status).toBe(201);
    expect(await published.json()).toMatchObject({
      ok: true,
      status: 201,
      data: { dagRunId: expect.any(String), preparationId: expect.any(String), version: 2 },
    });
  });

  it('preserves run errors and implicit definition-publish failure envelopes', async () => {
    for (const route of ['/v1/dag/runs/absent', '/v1/dag/runs/absent/result']) {
      const missing = await app.request(route);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({
        ok: false,
        status: 404,
        errors: [{ title: 'DAG operation failed', instance: route, status: 404 }],
      });
    }
    const missingStart = await app.request('/v1/dag/runs/absent/start', { method: 'POST' });
    expect(missingStart.status).toBe(404);
    expect(await missingStart.json()).toMatchObject({
      ok: false,
      errors: [{ title: 'DAG operation failed', instance: '/v1/dag/runs/absent/start' }],
    });
    const missingPublished = await app.request('/v1/dag/definitions/absent/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(missingPublished.status).toBe(404);
    expect(await missingPublished.json()).toMatchObject({
      ok: false,
      errors: [{ title: 'DAG operation failed', instance: '/v1/dag/workflows/absent/runs' }],
    });
    const built = await framework.build.buildDag({
      dagId: 'bad-run-definition',
      pipeline: [{ nodeType: 'input', config: { text: 'hello' } }],
    });
    if (!built.ok) throw new Error('Expected a valid test definition.');
    const invalid = {
      ...built.definition,
      edges: [{ from: 'missing', to: 'missing', bindings: [] }],
    };
    const rejected = await app.request('/v1/dag/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: invalid }),
    });
    expect(rejected.status).toBe(400);
    const rejectedPayload = (await rejected.json()) as {
      ok: boolean;
      status: number;
      errors: Array<{ title: string; instance: string; status: number }>;
    };
    expect(rejectedPayload.ok).toBe(false);
    expect(rejectedPayload.status).toBe(400);
    expect(rejectedPayload.errors.length).toBeGreaterThan(0);
    expect(
      rejectedPayload.errors.every(
        (error) =>
          error.title === 'Publish failed' &&
          error.instance === '/v1/dag/runs' &&
          error.status === 400,
      ),
    ).toBe(true);
  });

  it('maps domain build results to the existing HTTP route envelope', async () => {
    const success = await app.request('/v1/dag/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pipeline: [{ nodeType: 'input', config: { text: 'hello' } }] }),
    });
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({
      ok: true,
      data: { nodeCount: 1, definition: { nodes: [{ nodeType: 'input' }] } },
    });

    const invalid = await app.request('/v1/dag/build', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pipeline: [{ nodeType: 'missing-node' }] }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({
      ok: false,
      status: 400,
      errors: [
        {
          type: 'urn:robota:problems:dag:validation',
          title: 'DAG build failed',
          status: 400,
          detail: 'Node type "missing-node" is not registered',
          instance: 'inproc://dag-framework/build',
          code: 'UNKNOWN_NODE_TYPE',
          retryable: false,
        },
      ],
    });
  });

  it('maps domain validation results to the existing HTTP route envelope', async () => {
    const built = await framework.build.buildDag({
      pipeline: [{ nodeType: 'input', config: { text: 'hello' } }],
    });
    if (!built.ok) throw new Error('Expected a valid test definition.');

    const valid = await app.request('/v1/dag/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition: built.definition }),
    });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({
      ok: true,
      status: 200,
      data: { valid: true, errors: [] },
    });

    const invalid = await app.request('/v1/dag/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        definition: {
          ...built.definition,
          nodes: [{ ...built.definition.nodes[0], nodeType: 'missing-node' }],
        },
      }),
    });
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({
      ok: true,
      status: 200,
      data: { valid: false, errors: ['Unknown node type "missing-node" for node "input-0"'] },
    });
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
    const supportedApp = createDagRuntimeServer(
      framework.runs,
      costMeta,
      framework.runDrafts,
      framework.build,
      framework.validation,
      framework.catalog,
      framework.definitionReads,
      framework.definitionMutations,
    );

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
    const failingApp = createDagRuntimeServer(
      framework.runs,
      costMeta,
      framework.runDrafts,
      framework.build,
      framework.validation,
      framework.catalog,
      framework.definitionReads,
      framework.definitionMutations,
    );

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
    const failingApp = createDagRuntimeServer(
      framework.runs,
      framework.costMeta,
      drafts,
      framework.build,
      framework.validation,
      framework.catalog,
      framework.definitionReads,
      framework.definitionMutations,
    );
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

  it('does not dereference reference assets through the unauthenticated content route', async () => {
    const referenceStore = Object.create(framework.assets) as IAssetStore;
    let contentCalled = false;
    referenceStore.getMetadata = async () => ({
      assetId: 'reference',
      fileName: 'remote.bin',
      mediaType: 'application/octet-stream',
      sizeBytes: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceUri: 'https://public.example.test/remote.bin',
    });
    referenceStore.getContent = async () => {
      contentCalled = true;
      throw new Error('Reference source must not be fetched.');
    };
    const referenceApp = createDagRuntimeServer(
      framework.runs,
      framework.costMeta,
      framework.runDrafts,
      framework.build,
      framework.validation,
      framework.catalog,
      framework.definitionReads,
      framework.definitionMutations,
      undefined,
      referenceStore,
    );
    const response = await referenceApp.request('/v1/dag/assets/reference/content');
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({
      errors: [{ code: 'DAG_ASSET_REFERENCE_DOWNLOAD_UNSUPPORTED' }],
    });
    expect(contentCalled).toBe(false);
  });

  it('rejects unsafe upload media types and safely serves legacy metadata', async () => {
    const invalid = await app.request('/v1/dag/assets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'bad.txt',
        mediaType: 'text/plain\u0000bad',
        base64Data: 'YQ==',
      }),
    });
    expect(invalid.status).toBe(400);

    const legacy = await framework.assets.save({
      fileName: 'legacy.txt',
      mediaType: 'text/plain\u0000bad',
      content: Uint8Array.from([97]),
    });
    const downloaded = await app.request(`/v1/dag/assets/${legacy.assetId}/content`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get('content-type')).toContain('application/octet-stream');
    expect(await downloaded.text()).toBe('a');
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
      framework.runs,
      framework.costMeta,
      framework.runDrafts,
      framework.build,
      framework.validation,
      framework.catalog,
      framework.definitionReads,
      framework.definitionMutations,
    );
    const unwired = await unwiredApp.request('/v1/dag/assets/missing');
    expect(unwired.status).toBe(501);

    const broken = Object.create(framework.assets) as IAssetStore;
    broken.getMetadata = async () => {
      throw new Error('/private/secret.json');
    };
    const failingApp = createDagRuntimeServer(
      framework.runs,
      framework.costMeta,
      framework.runDrafts,
      framework.build,
      framework.validation,
      framework.catalog,
      framework.definitionReads,
      framework.definitionMutations,
      undefined,
      broken,
    );
    const failed = await failingApp.request('/v1/dag/assets/asset-id');
    expect(failed.status).toBe(500);
    expect(JSON.stringify(await failed.json())).not.toContain('/private/secret.json');
  });

  it('does not complete a successful download when its source stream fails', async () => {
    const broken = Object.create(framework.assets) as IAssetStore;
    broken.getMetadata = async () => ({
      assetId: 'broken',
      fileName: 'broken.bin',
      mediaType: 'application/octet-stream',
      sizeBytes: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    broken.getContent = async () => ({
      metadata: {
        assetId: 'broken',
        fileName: 'broken.bin',
        mediaType: 'application/octet-stream',
        sizeBytes: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      stream: (async function* () {
        yield Uint8Array.from([1]);
        throw new Error('/private/source.bin');
      })(),
    });
    const failingApp = createDagRuntimeServer(
      framework.runs,
      framework.costMeta,
      framework.runDrafts,
      framework.build,
      framework.validation,
      framework.catalog,
      framework.definitionReads,
      framework.definitionMutations,
      undefined,
      broken,
    );
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
    const app = createDagRuntimeServer(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      source,
    );

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
    const app = createDagRuntimeServer(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      source,
    );
    const body = await (await app.request('/v1/dag/runs/run-1/events')).text();
    expect(body).not.toContain('other-run');
    expect(body).toContain('event: execution.completed');
  });
});
