import type { Router, Request, Response } from 'express';
import type { DagDesignController } from '@robota-sdk/dag-api';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { IAssetStore } from '../asset-store-contract.js';
import type {
    IVersionBody,
    ICreateDefinitionBody,
    IUpdateDraftBody,
    IGetDefinitionQuery,
    IListDefinitionsQuery
} from './route-types.js';
import {
    resolveCorrelationId,
    validateAssetReferences,
    parseOptionalPositiveIntegerQuery,
    HTTP_BAD_REQUEST
} from './route-utils.js';

/**
 * Registers definition-related routes on the provided router.
 */
export function registerDefinitionRoutes(
    router: Router,
    designController: DagDesignController,
    assetStore: IAssetStore
): void {
    router.post('/v1/dag/definitions', async (req: Request<unknown, unknown, ICreateDefinitionBody>, res: Response) => {
        if (!req.body || typeof req.body.definition !== 'object' || req.body.definition === null) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    {
                        code: 'DAG_VALIDATION_DEFINITION_REQUIRED',
                        detail: 'definition is required',
                        retryable: false
                    }
                ]
            });
            return;
        }
        const assetValidationErrors = await validateAssetReferences(req.body.definition, assetStore);
        if (assetValidationErrors.length > 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: assetValidationErrors
            });
            return;
        }
        const created = await designController.createDefinition({
            definition: req.body.definition,
            correlationId: resolveCorrelationId(req, 'dag-dev-design-create')
        });
        res.status(created.status).json(created);
    });

    router.put('/v1/dag/definitions/:dagId/draft', async (
        req: Request<{ dagId: string }, unknown, IUpdateDraftBody>,
        res: Response
    ) => {
        if (!req.body || typeof req.body.definition !== 'object' || req.body.definition === null) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [
                    {
                        code: 'DAG_VALIDATION_DEFINITION_REQUIRED',
                        detail: 'definition is required',
                        retryable: false
                    }
                ]
            });
            return;
        }
        const assetValidationErrors = await validateAssetReferences(req.body.definition, assetStore);
        if (assetValidationErrors.length > 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: assetValidationErrors
            });
            return;
        }
        const updated = await designController.updateDraft({
            dagId: req.params.dagId,
            version: req.body.version,
            definition: req.body.definition,
            correlationId: resolveCorrelationId(req, 'dag-dev-design-update')
        });
        res.status(updated.status).json(updated);
    });

    router.post('/v1/dag/definitions/:dagId/validate', async (
        req: Request<{ dagId: string }, unknown, IVersionBody>,
        res: Response
    ) => {
        const existing = await designController.getDefinition({
            dagId: req.params.dagId,
            version: req.body.version,
            correlationId: resolveCorrelationId(req, 'dag-dev-design-get-for-asset-validate')
        });
        if (!existing.ok) {
            res.status(existing.status).json(existing);
            return;
        }
        const assetValidationErrors = await validateAssetReferences(existing.data.definition, assetStore);
        if (assetValidationErrors.length > 0) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: assetValidationErrors
            });
            return;
        }
        const validated = await designController.validateDefinition({
            dagId: req.params.dagId,
            version: req.body.version,
            correlationId: resolveCorrelationId(req, 'dag-dev-design-validate')
        });
        res.status(validated.status).json(validated);
    });

    router.post('/v1/dag/definitions/:dagId/publish', async (
        req: Request<{ dagId: string }, unknown, IVersionBody>,
        res: Response
    ) => {
        const published = await designController.publishDefinition({
            dagId: req.params.dagId,
            version: req.body.version,
            correlationId: resolveCorrelationId(req, 'dag-dev-design-publish')
        });
        res.status(published.status).json(published);
    });

    router.get('/v1/dag/definitions/:dagId', async (
        req: Request<{ dagId: string }, unknown, unknown, IGetDefinitionQuery>,
        res: Response
    ) => {
        const parsedVersionResult = parseOptionalPositiveIntegerQuery(req.query.version);
        if (!parsedVersionResult.ok) {
            res.status(HTTP_BAD_REQUEST).json({
                ok: false,
                status: HTTP_BAD_REQUEST,
                errors: [parsedVersionResult.error]
            });
            return;
        }
        const definition = await designController.getDefinition({
            dagId: req.params.dagId,
            version: parsedVersionResult.value,
            correlationId: resolveCorrelationId(req, 'dag-dev-design-get')
        });
        res.status(definition.status).json(definition);
    });

    router.get('/v1/dag/definitions', async (
        req: Request<unknown, unknown, unknown, IListDefinitionsQuery>,
        res: Response
    ) => {
        const listed = await designController.listDefinitions({
            dagId: req.query.dagId,
            correlationId: resolveCorrelationId(req, 'dag-dev-design-list')
        });
        res.status(listed.status).json(listed);
    });

    router.get('/v1/dag/nodes', async (req: Request, res: Response) => {
        const listed = await designController.listNodeCatalog({
            correlationId: resolveCorrelationId(req, 'dag-dev-nodes-list')
        });
        res.status(listed.status).json(listed);
    });
}
