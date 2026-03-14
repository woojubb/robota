import type { Express, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IAssetStore } from '@robota-sdk/dag-core';

export function mountAssetRoutes(app: Express, assetStore: IAssetStore): void {
    app.get('/view', async (req: Request, res: Response) => {
        const filename = req.query.filename;
        if (typeof filename !== 'string' || filename.trim().length === 0) {
            res.status(400).json({
                error: { type: 'invalid_request', message: 'filename query parameter is required', details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }

        const result = await assetStore.getContent(filename.trim());
        if (!result) {
            res.status(404).json({
                error: { type: 'not_found', message: `Asset not found: ${filename}`, details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }

        res.setHeader('Content-Type', result.metadata.mediaType);
        res.setHeader('Content-Length', String(result.metadata.sizeBytes));

        const readable = result.stream instanceof Readable
            ? result.stream
            : Readable.from(result.stream);
        await pipeline(readable, res);
    });
}
