import type { Express, Request, Response } from 'express';
import type { PromptApiController } from '@robota-sdk/dag-api';
import type { IDagError } from '@robota-sdk/dag-core';

function sendError(res: Response, error: IDagError, status = 500): void {
    res.status(status).json({
        error: {
            type: error.code,
            message: error.message,
            details: '',
            extra_info: {},
        },
        node_errors: {},
    });
}

export function mountPromptRoutes(
    app: Express,
    controller: PromptApiController,
): void {
    app.post('/prompt', async (req: Request, res: Response) => {
        const result = await controller.submitPrompt(req.body);
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error, 400);
        }
    });

    app.get('/queue', async (_req: Request, res: Response) => {
        const result = await controller.getQueue();
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    });

    app.post('/queue', async (req: Request, res: Response) => {
        const result = await controller.manageQueue(req.body);
        if (result.ok) {
            res.status(200).json({});
        } else {
            sendError(res, result.error);
        }
    });

    app.get('/history', async (_req: Request, res: Response) => {
        const result = await controller.getHistory();
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    });

    app.get('/history/:prompt_id', async (req: Request, res: Response) => {
        const result = await controller.getHistory(req.params.prompt_id);
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    });

    app.get('/object_info', async (_req: Request, res: Response) => {
        const result = await controller.getObjectInfo();
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    });

    app.get('/object_info/:node_type', async (req: Request, res: Response) => {
        const result = await controller.getObjectInfo(req.params.node_type);
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    });

    app.get('/system_stats', async (_req: Request, res: Response) => {
        const result = await controller.getSystemStats();
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    });
}
