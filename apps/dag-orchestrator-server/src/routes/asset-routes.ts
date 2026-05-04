import type { Router, Request, RequestHandler, Response } from 'express';
import type { IAssetStore } from '@robota-sdk/dag-core';
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

interface IAssetUploadRequestBody {
  fileName: string;
  mediaType: string;
  base64Data: string;
}

type TAssetUploadBodyParseResult =
  | { ok: true; body: IAssetUploadRequestBody }
  | { ok: false; code: string; detail: string };

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

function createAssetUploadHandler(assetStore: IAssetStore, backendUrl: string): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const rawBody =
      typeof req.body === 'object' && req.body !== null ? (req.body as object) : undefined;
    const parsedBody = parseAssetUploadBody(rawBody);
    if (!parsedBody.ok) {
      sendJsonError(res, HTTP_BAD_REQUEST, parsedBody.code, parsedBody.detail, false);
      return;
    }

    try {
      const { fileName, mediaType, base64Data } = parsedBody.body;
      const content = Buffer.from(base64Data, 'base64');
      if (content.byteLength === 0) {
        sendJsonError(
          res,
          HTTP_BAD_REQUEST,
          'DAG_VALIDATION_ASSET_EMPTY_CONTENT',
          'Decoded asset content must not be empty',
          false,
        );
        return;
      }
      const runtimeUpload = await uploadAssetBufferToRuntime({
        backendUrl,
        content,
        fileName,
        mediaType,
      });
      if (!runtimeUpload.ok) {
        sendJsonError(
          res,
          runtimeUpload.status,
          runtimeUpload.code,
          runtimeUpload.detail,
          runtimeUpload.retryable,
        );
        return;
      }

      const metadata = await assetStore.save({
        fileName,
        mediaType,
        content,
        runtimeAssetId: runtimeUpload.runtimeAssetId,
      });
      res.status(HTTP_CREATED).json({
        ok: true,
        status: HTTP_CREATED,
        data: { asset: toAssetReference(metadata, getAssetContentUri(req, metadata.assetId)) },
      });
    } catch (error) {
      const detail =
        error instanceof Error && error.message.trim().length > 0
          ? `Asset storage failed: ${error.message}`
          : 'Asset storage failed';
      sendJsonError(res, HTTP_INTERNAL_SERVER_ERROR, 'DAG_ASSET_STORAGE_FAILED', detail, true);
    }
  };
}

export function registerAssetRoutes(
  router: Router,
  assetStore: IAssetStore,
  backendUrl: string,
): void {
  router.post('/v1/dag/assets', createAssetUploadHandler(assetStore, backendUrl));

  router.get(
    '/v1/dag/assets/:assetId',
    async (req: Request<{ assetId: string }>, res: Response) => {
      const metadata = await assetStore.getMetadata(req.params.assetId);
      if (!metadata) {
        res.status(HTTP_NOT_FOUND).json({
          ok: false,
          status: HTTP_NOT_FOUND,
          errors: [
            {
              code: 'DAG_ASSET_NOT_FOUND',
              detail: `Asset not found: ${req.params.assetId}`,
              retryable: false,
            },
          ],
        });
        return;
      }
      res.status(HTTP_OK).json({
        ok: true,
        status: HTTP_OK,
        data: { asset: toAssetReference(metadata, getAssetContentUri(req, metadata.assetId)) },
      });
    },
  );

  router.get(
    '/v1/dag/assets/:assetId/content',
    async (req: Request<{ assetId: string }>, res: Response) => {
      const contentResult = await assetStore.getContent(req.params.assetId);
      if (!contentResult) {
        res.status(HTTP_NOT_FOUND).json({
          ok: false,
          status: HTTP_NOT_FOUND,
          errors: [
            {
              code: 'DAG_ASSET_NOT_FOUND',
              detail: `Asset not found: ${req.params.assetId}`,
              retryable: false,
            },
          ],
        });
        return;
      }
      const mediaType = contentResult.metadata.mediaType;
      const isInlineSafe = isAllowedInlineMediaType(mediaType);
      const safeContentType = isInlineSafe ? mediaType : 'application/octet-stream';
      const disposition = isInlineSafe ? 'inline' : 'attachment';
      const safeFileName = sanitizeFileName(contentResult.metadata.fileName);
      res.setHeader('Content-Type', safeContentType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeFileName}"`);
      const stream = contentResult.stream;
      for await (const chunk of stream) {
        res.write(chunk);
      }
      res.end();
    },
  );
}
