import { describe, expect, it } from 'vitest';
import http from 'node:http';
import express, { type Request } from 'express';
import multer from 'multer';
import { Readable } from 'node:stream';
import type {
  IAssetContentResult,
  IAssetStore,
  ICreateAssetInput,
  ICreateAssetReferenceInput,
  IStoredAssetMetadata,
} from '@robota-sdk/dag-core';
import { registerAssetRoutes } from '../routes/asset-routes.js';

class CapturingAssetStore implements IAssetStore {
  public savedInput: ICreateAssetInput | undefined;

  public async save(input: ICreateAssetInput): Promise<IStoredAssetMetadata> {
    this.savedInput = input;
    return {
      assetId: 'local-asset-1',
      fileName: input.fileName,
      mediaType: input.mediaType,
      sizeBytes: input.content.byteLength,
      createdAt: '2026-05-05T00:00:00.000Z',
      runtimeAssetId: input.runtimeAssetId,
    };
  }

  public async saveReference(_input: ICreateAssetReferenceInput): Promise<IStoredAssetMetadata> {
    throw new Error('saveReference is not used by asset routes');
  }

  public async getMetadata(assetId: string): Promise<IStoredAssetMetadata | undefined> {
    return {
      assetId,
      fileName: 'photo.png',
      mediaType: 'image/png',
      sizeBytes: 4,
      createdAt: '2026-05-05T00:00:00.000Z',
      runtimeAssetId: 'runtime-asset-1',
    };
  }

  public async getContent(assetId: string): Promise<IAssetContentResult | undefined> {
    return {
      stream: Readable.from([new Uint8Array([1, 2, 3, 4])]),
      metadata: {
        assetId,
        fileName: 'photo.png',
        mediaType: 'image/png',
        sizeBytes: 4,
        createdAt: '2026-05-05T00:00:00.000Z',
        runtimeAssetId: 'runtime-asset-1',
      },
    };
  }
}

interface IStartedServer {
  baseUrl: string;
  close(): Promise<void>;
}

async function startApp(app: express.Express): Promise<IStartedServer> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address();
  if (typeof address !== 'object' || address === null) {
    throw new Error('Server did not bind to a port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function startRuntime(options: { failUpload?: boolean } = {}): Promise<IStartedServer> {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage() });
  app.post('/upload/image', upload.single('image'), (req, res) => {
    if (options.failUpload === true) {
      res.status(500).json({ error: { message: 'runtime unavailable' } });
      return;
    }
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: { message: 'missing image' } });
      return;
    }
    res.status(200).json({
      name: 'runtime-asset-1',
      subfolder: '',
      type: 'input',
    });
  });
  return startApp(app);
}

async function postJson(
  baseUrl: string,
  path: string,
  payload: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe('asset routes', () => {
  it('uploads to runtime before storing and returning the orchestrator asset reference', async () => {
    const runtime = await startRuntime();
    const assetStore = new CapturingAssetStore();
    const app = express();
    app.use(express.json());
    registerAssetRoutes(app, assetStore, runtime.baseUrl);
    const orchestrator = await startApp(app);

    try {
      const { status, body } = await postJson(orchestrator.baseUrl, '/v1/dag/assets', {
        fileName: 'photo.png',
        mediaType: 'image/png',
        base64Data: Buffer.from([1, 2, 3, 4]).toString('base64'),
      });

      expect(status).toBe(201);
      expect(body.ok).toBe(true);
      expect(assetStore.savedInput?.runtimeAssetId).toBe('runtime-asset-1');
      const data = body.data as { asset: { assetId: string; runtimeAssetId?: string } };
      expect(data.asset.assetId).toBe('local-asset-1');
      expect(data.asset.runtimeAssetId).toBe('runtime-asset-1');
    } finally {
      await orchestrator.close();
      await runtime.close();
    }
  });

  it('does not store or return an asset when runtime upload fails', async () => {
    const runtime = await startRuntime({ failUpload: true });
    const assetStore = new CapturingAssetStore();
    const app = express();
    app.use(express.json());
    registerAssetRoutes(app, assetStore, runtime.baseUrl);
    const orchestrator = await startApp(app);

    try {
      const { status, body } = await postJson(orchestrator.baseUrl, '/v1/dag/assets', {
        fileName: 'photo.png',
        mediaType: 'image/png',
        base64Data: Buffer.from([1, 2, 3, 4]).toString('base64'),
      });

      expect(status).toBe(502);
      expect(body.ok).toBe(false);
      const errors = body.errors as Array<{ code: string }>;
      expect(errors[0].code).toBe('DAG_RUNTIME_ASSET_UPLOAD_FAILED');
      expect(assetStore.savedInput).toBeUndefined();
    } finally {
      await orchestrator.close();
      await runtime.close();
    }
  });
});
