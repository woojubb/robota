import type { Router, Request, Response } from 'express';
import type { ICostMetaStoragePort, ICostMeta } from '@robota-sdk/dag-cost';
import { CelCostEvaluator } from '@robota-sdk/dag-cost';
import { HTTP_OK, HTTP_CREATED, HTTP_BAD_REQUEST, HTTP_NOT_FOUND } from './route-utils.js';

export function registerCostMetaRoutes(
    router: Router,
    storage: ICostMetaStoragePort,
    evaluator: CelCostEvaluator,
): void {
    // GET /v1/cost-meta — list all cost meta entries
    router.get('/v1/cost-meta', async (_req: Request, res: Response) => {
        const items = await storage.getAll();
        res.status(HTTP_OK).json({ ok: true, data: items });
    });

    // POST /v1/cost-meta/validate — validate formula only (before :nodeType routes)
    router.post('/v1/cost-meta/validate', (req: Request, res: Response) => {
        const { formula } = req.body as { formula: string };
        const result = evaluator.validate(formula);
        if (result.ok) {
            res.status(HTTP_OK).json({ ok: true });
        } else {
            res.status(HTTP_OK).json({ ok: false, errors: [result.error.message] });
        }
    });

    // POST /v1/cost-meta/preview — evaluate formula with test context (before :nodeType routes)
    router.post('/v1/cost-meta/preview', (req: Request, res: Response) => {
        const { formula, variables, testContext } = req.body as {
            formula: string;
            variables?: Record<string, unknown>;
            testContext?: Record<string, unknown>;
        };
        const context: Record<string, unknown> = {
            ...variables,
            ...testContext,
        };
        const result = evaluator.evaluate(formula, context);
        if (result.ok) {
            res.status(HTTP_OK).json({ ok: true, result: result.value });
        } else {
            res.status(HTTP_OK).json({ ok: false, error: result.error.message });
        }
    });

    // POST /v1/cost-meta — create new cost meta
    router.post('/v1/cost-meta', async (req: Request, res: Response) => {
        const body = req.body as ICostMeta;
        const validationError = validateFormulas(evaluator, body);
        if (validationError) {
            res.status(HTTP_BAD_REQUEST).json({ ok: false, error: validationError });
            return;
        }
        await storage.save(body);
        res.status(HTTP_CREATED).json({ ok: true, data: body });
    });

    // GET /v1/cost-meta/:nodeType — get single entry
    router.get('/v1/cost-meta/:nodeType', async (req: Request<{ nodeType: string }>, res: Response) => {
        const meta = await storage.get(req.params.nodeType);
        if (!meta) {
            res.status(HTTP_NOT_FOUND).json({ ok: false, error: `Cost meta not found for nodeType: ${req.params.nodeType}` });
            return;
        }
        res.status(HTTP_OK).json({ ok: true, data: meta });
    });

    // PUT /v1/cost-meta/:nodeType — update existing cost meta
    router.put('/v1/cost-meta/:nodeType', async (req: Request<{ nodeType: string }>, res: Response) => {
        const body = req.body as ICostMeta;
        body.nodeType = req.params.nodeType;
        const validationError = validateFormulas(evaluator, body);
        if (validationError) {
            res.status(HTTP_BAD_REQUEST).json({ ok: false, error: validationError });
            return;
        }
        await storage.save(body);
        res.status(HTTP_OK).json({ ok: true, data: body });
    });

    // DELETE /v1/cost-meta/:nodeType — delete cost meta
    router.delete('/v1/cost-meta/:nodeType', async (req: Request<{ nodeType: string }>, res: Response) => {
        await storage.delete(req.params.nodeType);
        res.status(HTTP_OK).json({ ok: true });
    });
}

function validateFormulas(evaluator: CelCostEvaluator, meta: ICostMeta): string | undefined {
    const estimateResult = evaluator.validate(meta.estimateFormula);
    if (!estimateResult.ok) {
        return `Invalid estimateFormula: ${estimateResult.error.message}`;
    }
    if (typeof meta.calculateFormula === 'string' && meta.calculateFormula.length > 0) {
        const calculateResult = evaluator.validate(meta.calculateFormula);
        if (!calculateResult.ok) {
            return `Invalid calculateFormula: ${calculateResult.error.message}`;
        }
    }
    return undefined;
}
