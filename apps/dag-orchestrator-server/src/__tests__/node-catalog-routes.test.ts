import { describe, expect, it } from 'vitest';
import express from 'express';
import http from 'node:http';
import { DagDefinitionService, buildDispatchError } from '@robota-sdk/dag-core';
import type {
  IAssetContentResult,
  IAssetStore,
  ICreateAssetInput,
  ICreateAssetReferenceInput,
  IStoredAssetMetadata,
  TObjectInfo,
} from '@robota-sdk/dag-core';
import { InMemoryStoragePort } from '@robota-sdk/dag-adapters-local';
import { DagDesignController, type INodeCatalogService } from '@robota-sdk/dag-api';
import { registerDefinitionRoutes } from '../routes/definition-routes.js';

const objectInfo: TObjectInfo = {
  KSampler: {
    display_name: 'KSampler',
    category: 'sampling',
    input: { required: {} },
    output: ['IMAGE'],
    output_is_list: [false],
    output_name: ['image'],
    output_node: false,
    description: 'Sampler node',
  },
};

class NoopAssetStore implements IAssetStore {
  public async save(_input: ICreateAssetInput): Promise<IStoredAssetMetadata> {
    return makeAssetMetadata('asset-1');
  }

  public async saveReference(_input: ICreateAssetReferenceInput): Promise<IStoredAssetMetadata> {
    return makeAssetMetadata('asset-1');
  }

  public async getMetadata(assetId: string): Promise<IStoredAssetMetadata | undefined> {
    return makeAssetMetadata(assetId);
  }

  public async getContent(_assetId: string): Promise<IAssetContentResult | undefined> {
    return { data: Buffer.from('test'), mediaType: 'text/plain' };
  }
}

function makeAssetMetadata(assetId: string): IStoredAssetMetadata {
  return {
    assetId,
    fileName: 'test.txt',
    mediaType: 'text/plain',
    sizeBytes: 4,
    createdAt: new Date(0).toISOString(),
  };
}

async function withNodeCatalogServer<T>(
  nodeCatalogService: INodeCatalogService,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const app = express();
  app.use(express.json());
  const controller = new DagDesignController(
    new DagDefinitionService(new InMemoryStoragePort()),
    nodeCatalogService,
  );
  registerDefinitionRoutes(app, controller, new NoopAssetStore());

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('Server did not bind to a port');
  }

  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('node catalog routes', () => {
  it('returns object_info through /v1/dag/nodes', async () => {
    const catalog: INodeCatalogService = {
      async listObjectInfo() {
        return { ok: true, value: objectInfo };
      },
      async hasNodeType(nodeType: string) {
        return { ok: true, value: Object.hasOwn(objectInfo, nodeType) };
      },
    };

    await withNodeCatalogServer(catalog, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/dag/nodes`);
      const body = (await response.json()) as { ok: boolean; status: number; data: TObjectInfo };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.status).toBe(200);
      expect(body.data.KSampler?.category).toBe('sampling');
    });
  });

  it('returns problem details when runtime catalog fetch fails', async () => {
    const catalog: INodeCatalogService = {
      async listObjectInfo() {
        return { ok: false, error: buildDispatchError('NETWORK_ERROR', 'runtime unavailable') };
      },
      async hasNodeType() {
        return { ok: true, value: false };
      },
    };

    await withNodeCatalogServer(catalog, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/v1/dag/nodes`);
      const body = (await response.json()) as {
        ok: boolean;
        status: number;
        errors: Array<{ code: string; retryable: boolean }>;
      };

      expect(response.status).toBe(503);
      expect(body.ok).toBe(false);
      expect(body.status).toBe(503);
      expect(body.errors[0]?.code).toBe('NETWORK_ERROR');
      expect(body.errors[0]?.retryable).toBe(true);
    });
  });
});
