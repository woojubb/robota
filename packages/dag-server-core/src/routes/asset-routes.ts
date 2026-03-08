import type { Router, Request, Response } from 'express';
import type { IAssetStore } from '../asset-store-contract.js';
import type { ICreateAssetBody } from './route-types.js';
import {
    toAssetReference,
    getAssetContentUri,
    HTTP_BAD_REQUEST,
    HTTP_NOT_FOUND,
    HTTP_CREATED,
    HTTP_OK
} from './route-utils.js';

/**
 * Registers asset-related routes on the provided router.
 */
export function registerAssetRoutes(
    router: Router,
    assetStore: IAssetStore
): void {
    router.post('/v1/dag/assets', async (
        req: Request<unknown, unknown, ICreateAssetBody>,
        res: Response
    ) => {
        const body = req.body;
        if (!body || typeof body.fileName !== 'string' || body.fileName.trim().length === 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    {
                        code: 'DAG_VALIDATION_ASSET_FILENAME_REQUIRED',
                        detail: 'fileName is required',
                        retryable: false
                    }
                ]
            });
            return;
        }
        if (typeof body.mediaType !== 'string' || body.mediaType.trim().length === 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    {
                        code: 'DAG_VALIDATION_ASSET_MEDIATYPE_REQUIRED',
                        detail: 'mediaType is required',
                        retryable: false
                    }
                ]
            });
            return;
        }
        if (typeof body.base64Data !== 'string' || body.base64Data.trim().length === 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    {
                        code: 'DAG_VALIDATION_ASSET_BASE64_REQUIRED',
                        detail: 'base64Data is required',
                        retryable: false
                    }
                ]
            });
            return;
        }

        try {
            const content = Buffer.from(body.base64Data, 'base64');
            if (content.byteLength === 0) {
                res.status(HTTP_BAD_REQUEST).json({
                    ok: false,
                    status: HTTP_BAD_REQUEST,
                    errors: [
                        {
                            code: 'DAG_VALIDATION_ASSET_EMPTY_CONTENT',
                            detail: 'Decoded asset content must not be empty',
                            retryable: false
                        }
                    ]
                });
                return;
            }
            const metadata = await assetStore.save({
                fileName: body.fileName,
                mediaType: body.mediaType,
                content
            });
            res.status(HTTP_CREATED).json({
                ok: true,
                status: HTTP_CREATED,
                data: {
                    asset: toAssetReference(metadata, getAssetContentUri(req, metadata.assetId))
                }
            });
        } catch (error: unknown) {
            const detail = error instanceof Error && error.message.trim().length > 0
                ? `base64Data processing failed: ${error.message}`
                : 'base64Data must be a valid base64 encoded string';
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    {
                        code: 'DAG_VALIDATION_ASSET_BASE64_INVALID',
                        detail,
                        retryable: false
                    }
                ]
            });
        }
    });

    router.get('/v1/dag/assets/:assetId', async (
        req: Request<{ assetId: string }>,
        res: Response
    ) => {
        const metadata = await assetStore.getMetadata(req.params.assetId);
        if (!metadata) {
            res.status(HTTP_NOT_FOUND).json({
                ok: false,
                status: HTTP_NOT_FOUND,
                errors: [
                    {
                        code: 'DAG_ASSET_NOT_FOUND',
                        detail: `Asset not found: ${req.params.assetId}`,
                        retryable: false
                    }
                ]
            });
            return;
        }
        res.status(HTTP_OK).json({
            ok: true,
            status: HTTP_OK,
            data: {
                asset: toAssetReference(metadata, getAssetContentUri(req, metadata.assetId))
            }
        });
    });

    router.get('/v1/dag/assets/:assetId/content', async (
        req: Request<{ assetId: string }>,
        res: Response
    ) => {
        const contentResult = await assetStore.getContent(req.params.assetId);
        if (!contentResult) {
            res.status(HTTP_NOT_FOUND).json({
                ok: false,
                status: HTTP_NOT_FOUND,
                errors: [
                    {
                        code: 'DAG_ASSET_NOT_FOUND',
                        detail: `Asset not found: ${req.params.assetId}`,
                        retryable: false
                    }
                ]
            });
            return;
        }
        res.setHeader('Content-Type', contentResult.metadata.mediaType);
        res.setHeader('Content-Disposition', `inline; filename="${contentResult.metadata.fileName}"`);
        contentResult.stream.pipe(res);
    });
}
