import type { Express, Request, Response, NextFunction } from 'express';
import type { PromptApiController } from '@robota-sdk/dag-api';
import type { IDagError } from '@robota-sdk/dag-core';

function toHttpStatus(error: IDagError): number {
    switch (error.category) {
        case 'validation': return 400;
        default: return 500;
    }
}

function sendError(res: Response, error: IDagError, statusOverride?: number): void {
    const status = statusOverride ?? toHttpStatus(error);
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

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function wrapAsync(handler: AsyncHandler): AsyncHandler {
    return async (req, res, next) => {
        try {
            await handler(req, res, next);
        } catch (err: unknown) {
            next(err);
        }
    };
}

export function mountPromptRoutes(
    app: Express,
    controller: PromptApiController,
): void {
    app.post('/prompt', wrapAsync(async (req, res) => {
        const result = await controller.submitPrompt(req.body);
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    }));

    app.get('/queue', wrapAsync(async (_req, res) => {
        const result = await controller.getQueue();
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    }));

    app.post('/queue', wrapAsync(async (req, res) => {
        const result = await controller.manageQueue(req.body);
        if (result.ok) {
            res.status(200).json({});
        } else {
            sendError(res, result.error);
        }
    }));

    app.get('/history', wrapAsync(async (_req, res) => {
        const result = await controller.getHistory();
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    }));

    app.get('/history/:prompt_id', wrapAsync(async (req, res) => {
        const result = await controller.getHistory(req.params.prompt_id);
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    }));

    app.get('/object_info', wrapAsync(async (_req, res) => {
        const result = await controller.getObjectInfo();
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    }));

    app.get('/object_info/:node_type', wrapAsync(async (req, res) => {
        const result = await controller.getObjectInfo(req.params.node_type);
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    }));

    app.get('/system_stats', wrapAsync(async (_req, res) => {
        const result = await controller.getSystemStats();
        if (result.ok) {
            res.status(200).json(result.value);
        } else {
            sendError(res, result.error);
        }
    }));
}
