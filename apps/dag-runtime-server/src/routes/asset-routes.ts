import type { Express, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';
import type { IAssetStore } from '@robota-sdk/dag-core';

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_SERVER_ERROR = 500;

export function mountAssetRoutes(app: Express, assetStore: IAssetStore): void {
    const upload = multer({ storage: multer.memoryStorage() });

    app.get('/view', async (req: Request, res: Response) => {
        const filename = req.query.filename;
        if (typeof filename !== 'string' || filename.trim().length === 0) {
            res.status(HTTP_BAD_REQUEST).json({
                error: { type: 'invalid_request', message: 'filename query parameter is required', details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }

        const result = await assetStore.getContent(filename.trim());
        if (!result) {
            res.status(HTTP_NOT_FOUND).json({
                error: { type: 'not_found', message: `Asset not found: ${filename}`, details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }

        res.setHeader('Content-Type', result.metadata.mediaType);
        if (result.metadata.sizeBytes > 0) {
            res.setHeader('Content-Length', String(result.metadata.sizeBytes));
        }

        const readable = result.stream instanceof Readable
            ? result.stream
            : Readable.from(result.stream);
        try {
            await pipeline(readable, res);
        } catch {
            if (!res.headersSent) {
                res.status(HTTP_INTERNAL_SERVER_ERROR).json({
                    error: { type: 'stream_error', message: 'Failed to stream asset content', details: '', extra_info: {} },
                    node_errors: {},
                });
            }
        }
    });

    app.post('/upload/image', upload.single('image'), async (req: Request, res: Response) => {
        const file = (req as Request & { file?: Express.Multer.File }).file;
        if (!file) {
            res.status(HTTP_BAD_REQUEST).json({
                error: { type: 'invalid_request', message: 'No image file provided', details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }

        const saved = await assetStore.save({
            fileName: file.originalname,
            mediaType: file.mimetype,
            content: new Uint8Array(file.buffer),
        });

        res.status(HTTP_OK).json({
            name: saved.assetId,
            subfolder: '',
            type: 'input',
        });
    });
}
