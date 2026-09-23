import { Buffer } from 'node:buffer';
import type { Context, Hono } from 'hono';
import type { IAssetStore, IStoredAssetMetadata } from '@robota-sdk/dag-core';
import type {
  IDagOrchestrationAssetUploadRequest,
  TDagOrchestrationPayloadValue,
} from '@robota-sdk/dag-orchestration-client';

const STATUS = {
  ok: 200,
  created: 201,
  badRequest: 400,
  notFound: 404,
  internal: 500,
  unsupported: 501,
} as const;
type TAssetErrorStatus =
  | typeof STATUS.badRequest
  | typeof STATUS.notFound
  | typeof STATUS.internal
  | typeof STATUS.unsupported;

function assetError(c: Context, status: TAssetErrorStatus, code: string, detail: string): Response {
  return c.json(
    {
      ok: false,
      status,
      errors: [
        {
          type: `urn:robota:error:dag:${code.toLowerCase()}`,
          title: 'Asset operation failed',
          status,
          detail,
          instance: c.req.path,
          code,
          retryable: status === STATUS.internal,
        },
      ],
    },
    status,
  );
}

function assetData(metadata: IStoredAssetMetadata): object {
  return {
    asset: {
      referenceType: 'asset',
      assetId: metadata.assetId,
      mediaType: metadata.mediaType,
      uri: `asset://${metadata.assetId}`,
      name: metadata.fileName,
      sizeBytes: metadata.sizeBytes,
      ...(metadata.runtimeAssetId ? { runtimeAssetId: metadata.runtimeAssetId } : {}),
    },
  };
}

function validMediaTypeHeader(value: string): boolean {
  return !!value.trim() && !/[^\x20-\x7e]/.test(value);
}

function safeMediaType(value: string): string {
  return validMediaTypeHeader(value) ? value : 'application/octet-stream';
}

function validAssetId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

function validUpload(
  input: Partial<IDagOrchestrationAssetUploadRequest>,
): input is IDagOrchestrationAssetUploadRequest {
  return (
    typeof input.fileName === 'string' &&
    !!input.fileName.trim() &&
    typeof input.mediaType === 'string' &&
    validMediaTypeHeader(input.mediaType) &&
    typeof input.base64Data === 'string' &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64Data)
  );
}

function streamAssetBytes(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch {
        controller.error(new Error('Asset stream failed.'));
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

async function upload(c: Context, assets?: IAssetStore): Promise<Response> {
  if (!assets)
    return assetError(
      c,
      STATUS.unsupported,
      'DAG_ASSET_UNSUPPORTED',
      'Asset storage is not configured.',
    );
  let body: TDagOrchestrationPayloadValue;
  try {
    body = await c.req.json();
  } catch {
    return assetError(
      c,
      STATUS.badRequest,
      'DAG_ASSET_INVALID_INPUT',
      'Asset upload requires valid JSON.',
    );
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return assetError(
      c,
      STATUS.badRequest,
      'DAG_ASSET_INVALID_INPUT',
      'Asset upload requires an object.',
    );
  }
  const input = body as Partial<IDagOrchestrationAssetUploadRequest>;
  if (!validUpload(input)) {
    return assetError(
      c,
      STATUS.badRequest,
      'DAG_ASSET_INVALID_INPUT',
      'Asset upload fields are invalid.',
    );
  }
  try {
    const metadata = await assets.save({
      fileName: input.fileName,
      mediaType: input.mediaType,
      content: Buffer.from(input.base64Data, 'base64'),
    });
    return c.json({ ok: true, status: STATUS.created, data: assetData(metadata) }, STATUS.created);
  } catch {
    return assetError(c, STATUS.internal, 'DAG_ASSET_STORAGE_ERROR', 'Asset storage failed.');
  }
}

async function metadata(c: Context, assets?: IAssetStore): Promise<Response> {
  if (!assets)
    return assetError(
      c,
      STATUS.unsupported,
      'DAG_ASSET_UNSUPPORTED',
      'Asset storage is not configured.',
    );
  const assetId = c.req.param('assetId');
  if (!assetId || !validAssetId(assetId)) {
    return assetError(c, STATUS.badRequest, 'DAG_ASSET_INVALID_INPUT', 'Asset ID is invalid.');
  }
  try {
    const value = await assets.getMetadata(assetId);
    return value
      ? c.json({ ok: true, status: STATUS.ok, data: assetData(value) }, STATUS.ok)
      : assetError(c, STATUS.notFound, 'DAG_ASSET_NOT_FOUND', 'Asset not found.');
  } catch {
    return assetError(c, STATUS.internal, 'DAG_ASSET_STORAGE_ERROR', 'Asset storage failed.');
  }
}

async function content(c: Context, assets?: IAssetStore): Promise<Response> {
  if (!assets)
    return assetError(
      c,
      STATUS.unsupported,
      'DAG_ASSET_UNSUPPORTED',
      'Asset storage is not configured.',
    );
  const assetId = c.req.param('assetId');
  if (!assetId || !validAssetId(assetId)) {
    return assetError(c, STATUS.badRequest, 'DAG_ASSET_INVALID_INPUT', 'Asset ID is invalid.');
  }
  try {
    const stored = await assets.getMetadata(assetId);
    if (!stored) return assetError(c, STATUS.notFound, 'DAG_ASSET_NOT_FOUND', 'Asset not found.');
    if (stored.sourceUri?.trim()) {
      return assetError(
        c,
        STATUS.unsupported,
        'DAG_ASSET_REFERENCE_DOWNLOAD_UNSUPPORTED',
        'Reference asset downloads are not available over HTTP.',
      );
    }
    const result = await assets.getContent(assetId);
    if (!result) return assetError(c, STATUS.notFound, 'DAG_ASSET_NOT_FOUND', 'Asset not found.');
    c.header('Content-Type', safeMediaType(result.metadata.mediaType));
    c.header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(result.metadata.fileName)}`,
    );
    return c.newResponse(streamAssetBytes(result.stream));
  } catch {
    return assetError(c, STATUS.internal, 'DAG_ASSET_STORAGE_ERROR', 'Asset storage failed.');
  }
}

/** Register the transport adapter for the framework's separate asset capability. */
export function registerAssetRoutes(app: Hono, assets?: IAssetStore): void {
  app.post('/v1/dag/assets', (c) => upload(c, assets));
  app.get('/v1/dag/assets/:assetId', (c) => metadata(c, assets));
  app.get('/v1/dag/assets/:assetId/content', (c) => content(c, assets));
}
