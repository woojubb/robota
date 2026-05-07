import type { Router, Request, RequestHandler, Response } from 'express';
import type { IAssetContentResult, IAssetStore, IStoredAssetMetadata } from '@robota-sdk/dag-core';
import type {
  IDagOrchestrationAssetSuccessPayload,
  IDagOrchestrationAssetUploadRequest,
} from '@robota-sdk/dag-orchestration-client';
import {
  toAssetReference,
  getAssetContentUri,
  isAllowedInlineMediaType,
  sanitizeFileName,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_CREATED,
  HTTP_OK,
  HTTP_INTERNAL_SERVER_ERROR,
} from './route-utils.js';
import { uploadAssetBufferToRuntime } from './runtime-asset-upload.js';

type TAssetUploadBodyParseResult =
  | { ok: true; body: IDagOrchestrationAssetUploadRequest }
  | { ok: false; code: string; detail: string };

interface IRuntimeAssetInput {
  content: Buffer;
  fileName: string;
  mediaType: string;
}

function sendJsonError(
  res: Response,
  status: number,
  code: string,
  detail: string,
  retryable: boolean,
): void {
  res.status(status).json({
    ok: false,
    status,
    errors: [{ code, detail, retryable }],
  });
}

function parseAssetUploadBody(rawBody: object | undefined): TAssetUploadBodyParseResult {
  const body = rawBody as
    | { fileName?: string; mediaType?: string; base64Data?: string }
    | undefined;
  if (!body || typeof body.fileName !== 'string' || body.fileName.trim().length === 0) {
    return {
      ok: false,
      code: 'DAG_VALIDATION_ASSET_FILENAME_REQUIRED',
      detail: 'fileName is required',
    };
  }
  if (typeof body.mediaType !== 'string' || body.mediaType.trim().length === 0) {
    return {
      ok: false,
      code: 'DAG_VALIDATION_ASSET_MEDIATYPE_REQUIRED',
      detail: 'mediaType is required',
    };
  }
  if (typeof body.base64Data !== 'string' || body.base64Data.trim().length === 0) {
    return {
      ok: false,
      code: 'DAG_VALIDATION_ASSET_BASE64_REQUIRED',
      detail: 'base64Data is required',
    };
  }
  return {
    ok: true,
    body: {
      fileName: body.fileName.trim(),
      mediaType: body.mediaType.trim(),
      base64Data: body.base64Data.trim(),
    },
  };
}

function getRequestBodyObject(req: Request): object | undefined {
  return typeof req.body === 'object' && req.body !== null ? (req.body as object) : undefined;
}

function createAssetSuccessPayload(
  req: Request,
  metadata: IStoredAssetMetadata,
  status: number,
): IDagOrchestrationAssetSuccessPayload {
  return {
    ok: true,
    status,
    data: { asset: toAssetReference(metadata, getAssetContentUri(req, metadata.assetId)) },
  };
}

function decodeAssetContent(base64Data: string, res: Response): Buffer | undefined {
  const content = Buffer.from(base64Data, 'base64');
  if (content.byteLength > 0) {
    return content;
  }
  sendJsonError(
    res,
    HTTP_BAD_REQUEST,
    'DAG_VALIDATION_ASSET_EMPTY_CONTENT',
    'Decoded asset content must not be empty',
    false,
  );
  return undefined;
}

async function uploadRuntimeAssetOrSendError(
  res: Response,
  backendUrl: string,
  input: IRuntimeAssetInput,
): Promise<string | undefined> {
  const runtimeUpload = await uploadAssetBufferToRuntime({
    backendUrl,
    content: input.content,
    fileName: input.fileName,
    mediaType: input.mediaType,
  });
  if (runtimeUpload.ok) {
    return runtimeUpload.runtimeAssetId;
  }
  sendJsonError(
    res,
    runtimeUpload.status,
    runtimeUpload.code,
    runtimeUpload.detail,
    runtimeUpload.retryable,
  );
  return undefined;
}

function sendAssetNotFound(res: Response, assetId: string): void {
  res.status(HTTP_NOT_FOUND).json({
    ok: false,
    status: HTTP_NOT_FOUND,
    errors: [
      {
        code: 'DAG_ASSET_NOT_FOUND',
        detail: `Asset not found: ${assetId}`,
        retryable: false,
      },
    ],
  });
}

function createAssetUploadHandler(assetStore: IAssetStore, backendUrl: string): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const parsedBody = parseAssetUploadBody(getRequestBodyObject(req));
    if (!parsedBody.ok) {
      sendJsonError(res, HTTP_BAD_REQUEST, parsedBody.code, parsedBody.detail, false);
      return;
    }

    try {
      const { fileName, mediaType, base64Data } = parsedBody.body;
      const content = decodeAssetContent(base64Data, res);
      if (!content) return;
      const runtimeAssetId = await uploadRuntimeAssetOrSendError(res, backendUrl, {
        content,
        fileName,
        mediaType,
      });
      if (!runtimeAssetId) return;

      const metadata = await assetStore.save({ fileName, mediaType, content, runtimeAssetId });
      res.status(HTTP_CREATED).json(createAssetSuccessPayload(req, metadata, HTTP_CREATED));
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim().length > 0
          ? `Asset storage failed: ${error.message}`
          : 'Asset storage failed';
      sendJsonError(res, HTTP_INTERNAL_SERVER_ERROR, 'DAG_ASSET_STORAGE_FAILED', detail, true);
    }
  };
}

function createAssetMetadataHandler(assetStore: IAssetStore): RequestHandler<{ assetId: string }> {
  return async (req: Request<{ assetId: string }>, res: Response): Promise<void> => {
    const metadata = await assetStore.getMetadata(req.params.assetId);
    if (!metadata) {
      sendAssetNotFound(res, req.params.assetId);
      return;
    }
    res.status(HTTP_OK).json(createAssetSuccessPayload(req, metadata, HTTP_OK));
  };
}

function setContentHeaders(res: Response, contentResult: IAssetContentResult): void {
  const mediaType = contentResult.metadata.mediaType;
  const isInlineSafe = isAllowedInlineMediaType(mediaType);
  const safeContentType = isInlineSafe ? mediaType : 'application/octet-stream';
  const disposition = isInlineSafe ? 'inline' : 'attachment';
  const safeFileName = sanitizeFileName(contentResult.metadata.fileName);
  res.setHeader('Content-Type', safeContentType);
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeFileName}"`);
}

async function writeAssetContent(res: Response, contentResult: IAssetContentResult): Promise<void> {
  setContentHeaders(res, contentResult);
  for await (const chunk of contentResult.stream) {
    res.write(chunk);
  }
  res.end();
}

function createAssetContentHandler(assetStore: IAssetStore): RequestHandler<{ assetId: string }> {
  return async (req: Request<{ assetId: string }>, res: Response): Promise<void> => {
    const contentResult = await assetStore.getContent(req.params.assetId);
    if (!contentResult) {
      sendAssetNotFound(res, req.params.assetId);
      return;
    }
    await writeAssetContent(res, contentResult);
  };
}

export function registerAssetRoutes(
  router: Router,
  assetStore: IAssetStore,
  backendUrl: string,
): void {
  router.post('/v1/dag/assets', createAssetUploadHandler(assetStore, backendUrl));
  router.get('/v1/dag/assets/:assetId', createAssetMetadataHandler(assetStore));
  router.get('/v1/dag/assets/:assetId/content', createAssetContentHandler(assetStore));
}
