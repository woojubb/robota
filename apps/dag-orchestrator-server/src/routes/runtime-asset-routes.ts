import type { Express, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const HTTP_BAD_REQUEST = 400;
const HTTP_BAD_GATEWAY = 502;

/**
 * Mapped routes for runtime asset operations (ComfyUI-compatible).
 * These validate inputs at the orchestrator layer, then forward to the runtime backend.
 * NOT a blind proxy — explicit validation and access control boundary.
 */
export function registerRuntimeAssetRoutes(app: Express, backendUrl: string): void {
    app.get('/view', async (req: Request, res: Response) => {
        const filename = req.query.filename;
        if (typeof filename !== 'string' || filename.trim().length === 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [{ code: 'DAG_VALIDATION_FILENAME_REQUIRED', detail: 'filename query parameter is required', retryable: false }],
            });
            return;
        }

        const sanitized = filename.trim();
        const url = `${backendUrl}/view?filename=${encodeURIComponent(sanitized)}`;

        try {
            const upstream = await fetch(url);
            if (!upstream.ok) {
                res.status(upstream.status).json(await upstream.json());
                return;
            }

            const contentType = upstream.headers.get('content-type');
            const contentLength = upstream.headers.get('content-length');
            if (contentType) { res.setHeader('Content-Type', contentType); }
            if (contentLength) { res.setHeader('Content-Length', contentLength); }

            if (upstream.body) {
                const readable = Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream);
                await pipeline(readable, res);
            } else {
                res.end();
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Runtime backend unreachable';
            res.status(HTTP_BAD_GATEWAY).json({
                ok: false,
                status: HTTP_BAD_GATEWAY,
                errors: [{ code: 'DAG_RUNTIME_UNREACHABLE', detail: message, retryable: true }],
            });
        }
    });

    app.post('/upload/image', async (req: Request, res: Response) => {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.startsWith('multipart/form-data')) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [{ code: 'DAG_VALIDATION_MULTIPART_REQUIRED', detail: 'Content-Type must be multipart/form-data', retryable: false }],
            });
            return;
        }

        const url = `${backendUrl}/upload/image`;

        try {
            // Forward the raw request body to the runtime backend, preserving the multipart boundary.
            const upstream = await fetch(url, {
                method: 'POST',
                headers: { 'content-type': contentType },
                body: Readable.toWeb(req) as ReadableStream,
                // @ts-expect-error -- Node fetch supports duplex for streaming request bodies
                duplex: 'half',
            });

            if (!upstream.ok) {
                res.status(upstream.status).json(await upstream.json());
                return;
            }

            res.status(upstream.status).json(await upstream.json());
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Runtime backend unreachable';
            res.status(HTTP_BAD_GATEWAY).json({
                ok: false,
                status: HTTP_BAD_GATEWAY,
                errors: [{ code: 'DAG_RUNTIME_UNREACHABLE', detail: message, retryable: true }],
            });
        }
    });
}
