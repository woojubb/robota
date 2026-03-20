import type { Router, Request, Response } from 'express';
import type { DagDesignController } from '@robota-sdk/dag-api';
import type { IDagDefinition, IAssetStore } from '@robota-sdk/dag-core';
import {
    resolveCorrelationId,
    validateAssetReferences,
    parseOptionalPositiveIntegerQuery,
    HTTP_BAD_REQUEST
} from './route-utils.js';

export function registerDefinitionRoutes(
    router: Router,
    designController: DagDesignController,
    assetStore: IAssetStore
): void {
    router.post('/v1/dag/definitions', async (req: Request, res: Response) => {
        if (!req.body || typeof req.body.definition !== 'object' || req.body.definition === null) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false, status: HTTP_BAD_REQUEST,
                errors: [{ code: 'DAG_VALIDATION_DEFINITION_REQUIRED', detail: 'definition is required', retryable: false }]
            });
            return;
        }
        const assetErrors = await validateAssetReferences(req.body.definition as IDagDefinition, assetStore);
        if (assetErrors.length > 0) {
            res.status(HTTP_BAD_REQUEST).json({ ok: false, status: HTTP_BAD_REQUEST, errors: assetErrors });
            return;
        }
        const created = await designController.createDefinition({
            definition: req.body.definition,
            correlationId: resolveCorrelationId(req, 'dag-design-create')
        });
        res.status(created.status).json(created);
    });

    router.put('/v1/dag/definitions/:dagId/draft', async (req: Request<{ dagId: string }>, res: Response) => {
        if (!req.body || typeof req.body.definition !== 'object' || req.body.definition === null) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false, status: HTTP_BAD_REQUEST,
                errors: [{ code: 'DAG_VALIDATION_DEFINITION_REQUIRED', detail: 'definition is required', retryable: false }]
            });
            return;
        }
        const assetErrors = await validateAssetReferences(req.body.definition as IDagDefinition, assetStore);
        if (assetErrors.length > 0) {
            res.status(HTTP_BAD_REQUEST).json({ ok: false, status: HTTP_BAD_REQUEST, errors: assetErrors });
            return;
        }
        const updated = await designController.updateDraft({
            dagId: req.params.dagId,
            version: req.body.version,
            definition: req.body.definition,
            correlationId: resolveCorrelationId(req, 'dag-design-update')
        });
        res.status(updated.status).json(updated);
    });

    router.post('/v1/dag/definitions/:dagId/validate', async (req: Request<{ dagId: string }>, res: Response) => {
        const existing = await designController.getDefinition({
            dagId: req.params.dagId,
            version: req.body.version,
            correlationId: resolveCorrelationId(req, 'dag-design-get-for-asset-validate')
        });
        if (!existing.ok) {
            res.status(existing.status).json(existing);
            return;
        }
        const assetErrors = await validateAssetReferences(existing.data.definition, assetStore);
        if (assetErrors.length > 0) {
            res.status(HTTP_BAD_REQUEST).json({ ok: false, status: HTTP_BAD_REQUEST, errors: assetErrors });
            return;
        }
        const validated = await designController.validateDefinition({
            dagId: req.params.dagId,
            version: req.body.version,
            correlationId: resolveCorrelationId(req, 'dag-design-validate')
        });
        res.status(validated.status).json(validated);
    });

    router.post('/v1/dag/definitions/:dagId/publish', async (req: Request<{ dagId: string }>, res: Response) => {
        const published = await designController.publishDefinition({
            dagId: req.params.dagId,
            version: req.body.version,
            correlationId: resolveCorrelationId(req, 'dag-design-publish')
        });
        res.status(published.status).json(published);
    });

    router.get('/v1/dag/definitions/:dagId', async (req: Request<{ dagId: string }>, res: Response) => {
        const parsedVersion = parseOptionalPositiveIntegerQuery(req.query.version as string | undefined);
        if (!parsedVersion.ok) {
            res.status(HTTP_BAD_REQUEST).json({ ok: false, status: HTTP_BAD_REQUEST, errors: [parsedVersion.error] });
            return;
        }
        const definition = await designController.getDefinition({
            dagId: req.params.dagId,
            version: parsedVersion.value,
            correlationId: resolveCorrelationId(req, 'dag-design-get')
        });
        res.status(definition.status).json(definition);
    });

    router.get('/v1/dag/definitions', async (req: Request, res: Response) => {
        const listed = await designController.listDefinitions({
            dagId: req.query.dagId as string | undefined,
            correlationId: resolveCorrelationId(req, 'dag-design-list')
        });
        res.status(listed.status).json(listed);
    });

}
