import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { FileStoragePort } from '@robota-sdk/dag-adapters-local';
import type { IDagOrchestrationPublishedWorkflowRunSuccessPayload } from '@robota-sdk/dag-orchestration-client';
import type {
  IDagDefinition,
  IAssetContentResult,
  IAssetStore,
  ICreateAssetInput,
  ICreateAssetReferenceInput,
  IPromptRequest,
  IStoredAssetMetadata,
  TPortPayload,
} from '@robota-sdk/dag-core';
import type { OrchestratorRunService } from '@robota-sdk/dag-orchestrator';
import { registerPublishedWorkflowRoutes } from '../routes/published-workflow-routes.js';

class StubAssetStore implements IAssetStore {
  async save(_input: ICreateAssetInput): Promise<IStoredAssetMetadata> {
    return createAssetMetadata('asset-1');
  }

  async saveReference(_input: ICreateAssetReferenceInput): Promise<IStoredAssetMetadata> {
    return createAssetMetadata('asset-1');
  }

  async getMetadata(assetId: string): Promise<IStoredAssetMetadata | undefined> {
    return createAssetMetadata(assetId);
  }

  async getContent(_assetId: string): Promise<IAssetContentResult | undefined> {
    return { data: Buffer.from('test'), mediaType: 'image/png' };
  }
}

class StubRunService {
  public createdDefinition: IDagDefinition | undefined;
  public createdInput: TPortPayload | undefined;
  public startedPreparationId: string | undefined;

  async createRun(definition: IDagDefinition, input: TPortPayload) {
    this.createdDefinition = definition;
    this.createdInput = input;
    return { ok: true as const, value: { preparationId: 'prep-1' } };
  }

  getPendingPromptRequest(_preparationId: string): IPromptRequest | undefined {
    return { prompt: {} };
  }

  async startRun(preparationId: string) {
    this.startedPreparationId = preparationId;
    return { ok: true as const, value: { dagRunId: 'dag-run-1', preparationId } };
  }
}

interface ITestServer {
  baseUrl: string;
  close(): Promise<void>;
  runService: StubRunService;
  storage: FileStoragePort;
}

const openServers: ITestServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

function createAssetMetadata(assetId: string): IStoredAssetMetadata {
  return {
    assetId,
    fileName: 'test.png',
    mediaType: 'image/png',
    sizeBytes: 100,
    createdAt: new Date().toISOString(),
  };
}

function createDefinition(
  version: number,
  status: IDagDefinition['status'],
  config: Record<string, string | number>,
): IDagDefinition {
  return {
    dagId: 'published-dag',
    version,
    status,
    nodes: [
      {
        nodeId: 'text-1',
        nodeType: 'text-template',
        dependsOn: [],
        config,
      },
    ],
    edges: [],
  };
}

async function createTestServer(definitions: IDagDefinition[]): Promise<ITestServer> {
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'robota-published-workflow-'));
  const storage = new FileStoragePort(storageRoot);
  for (const definition of definitions) {
    await storage.saveDefinition(definition);
  }

  const app = express();
  app.use(express.json());

  const runService = new StubRunService();
  const router = express.Router();
  registerPublishedWorkflowRoutes(
    router,
    storage,
    runService as unknown as OrchestratorRunService,
    new StubAssetStore(),
    'http://127.0.0.1:8188',
  );
  app.use(router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('Server did not bind to a port');
  }

  const testServer: ITestServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    runService,
    storage,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
  openServers.push(testServer);
  return testServer;
}

async function post(
  pathname: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown }> {
  const server = openServers[openServers.length - 1];
  if (!server) {
    throw new Error('No open test server');
  }
  const response = await fetch(`${server.baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof payload === 'undefined' ? undefined : JSON.stringify(payload),
  });
  const body: unknown = await response.json();
  return { status: response.status, body };
}

describe('published workflow routes', () => {
  it('starts the latest published definition and applies per-run overrides without persisting them', async () => {
    const server = await createTestServer([
      createDefinition(1, 'published', { template: 'published-v1', seed: 1 }),
      createDefinition(2, 'draft', { template: 'draft-v2', seed: 2 }),
      createDefinition(3, 'published', { template: 'published-v3', seed: 3 }),
    ]);

    const { status, body } = await post('/v1/dag/workflows/published-dag/runs', {
      input: { prompt: 'from-api' },
      overrides: {
        'text-1': { template: 'override-template' },
      },
    });

    expect(status).toBe(202);
    const envelope = body as IDagOrchestrationPublishedWorkflowRunSuccessPayload;
    expect(envelope.ok).toBe(true);
    expect(envelope.status).toBe(202);
    expect(envelope.data).toEqual({
      dagRunId: 'dag-run-1',
      preparationId: 'prep-1',
      dagId: 'published-dag',
      version: 3,
    });

    expect(server.runService.createdInput).toEqual({ prompt: 'from-api' });
    expect(server.runService.createdDefinition?.version).toBe(3);
    expect(server.runService.createdDefinition?.nodes[0]?.config).toEqual({
      template: 'override-template',
      seed: 3,
    });
    expect(server.runService.startedPreparationId).toBe('prep-1');

    const persistedDefinition = await server.storage.getDefinition('published-dag', 3);
    expect(persistedDefinition?.nodes[0]?.config).toEqual({
      template: 'published-v3',
      seed: 3,
    });
  });

  it('rejects an exact version that is not published', async () => {
    const server = await createTestServer([
      createDefinition(1, 'draft', { template: 'draft-v1', seed: 1 }),
    ]);

    const { status, body } = await post('/v1/dag/workflows/published-dag/runs?version=1', {});

    expect(status).toBe(409);
    const envelope = body as { ok: boolean; errors: Array<{ code: string }> };
    expect(envelope.ok).toBe(false);
    expect(envelope.errors[0]?.code).toBe('DAG_PUBLISHED_DEFINITION_STATUS_INVALID');
    expect(server.runService.createdDefinition).toBeUndefined();
  });

  it('returns 404 when no published definition exists', async () => {
    await createTestServer([]);

    const { status, body } = await post('/v1/dag/workflows/published-dag/runs', {});

    expect(status).toBe(404);
    const envelope = body as { ok: boolean; errors: Array<{ code: string }> };
    expect(envelope.ok).toBe(false);
    expect(envelope.errors[0]?.code).toBe('DAG_PUBLISHED_DEFINITION_NOT_FOUND');
  });

  it('rejects overrides for unknown node IDs', async () => {
    const server = await createTestServer([
      createDefinition(1, 'published', { template: 'published-v1', seed: 1 }),
    ]);

    const { status, body } = await post('/v1/dag/workflows/published-dag/runs', {
      overrides: {
        missing: { template: 'override-template' },
      },
    });

    expect(status).toBe(400);
    const envelope = body as { ok: boolean; errors: Array<{ code: string }> };
    expect(envelope.ok).toBe(false);
    expect(envelope.errors[0]?.code).toBe('DAG_VALIDATION_WORKFLOW_OVERRIDE_NODE_NOT_FOUND');
    expect(server.runService.createdDefinition).toBeUndefined();
  });
});
