import type { Router, Request, Response } from 'express';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type { DagDesignController } from '@robota-sdk/dag-api';
import { createCorrelationId, HTTP_CREATED } from './route-utils.js';

const SAMPLE_DEFINITION_VERSION = 1;

function createSampleDefinition(dagId: string, version: number): IDagDefinition {
    return {
        dagId,
        version,
        status: 'draft',
        nodes: [
            {
                nodeId: 'image_source_1',
                nodeType: 'image-source',
                dependsOn: [],
                inputs: [],
                outputs: [{ key: 'image', label: 'Image', order: 0, type: 'binary', required: true, binaryKind: 'image', mimeTypes: ['image/png'] }],
                config: { asset: { referenceType: 'uri', uri: 'file://sample-image.png' }, mimeType: 'image/png' }
            },
            {
                nodeId: 'ok_emitter_1',
                nodeType: 'ok-emitter',
                dependsOn: ['image_source_1'],
                inputs: [{ key: 'image', label: 'Image', order: 0, type: 'binary', required: true, binaryKind: 'image', mimeTypes: ['image/png'] }],
                outputs: [{ key: 'status', label: 'Status', order: 0, type: 'string', required: true }],
                config: {}
            }
        ],
        edges: [{ from: 'image_source_1', to: 'ok_emitter_1', bindings: [{ outputKey: 'image', inputKey: 'image' }] }]
    };
}

export function registerAdminRoutes(
    router: Router,
    designController: DagDesignController
): void {
    router.post('/v1/dag/admin/bootstrap', async (_req: Request, res: Response) => {
        const definition = createSampleDefinition('dag-sample', SAMPLE_DEFINITION_VERSION);
        const created = await designController.createDefinition({
            definition,
            correlationId: createCorrelationId('dag-bootstrap-create')
        });
        if (!created.ok) {
            res.status(created.status).json(created);
            return;
        }
        const published = await designController.publishDefinition({
            dagId: definition.dagId,
            version: definition.version,
            correlationId: createCorrelationId('dag-bootstrap-publish')
        });
        if (!published.ok) {
            res.status(published.status).json(published);
            return;
        }
        res.status(HTTP_CREATED).json({
            ok: true, status: HTTP_CREATED,
            data: { definitionId: `${definition.dagId}:${definition.version}`, dagId: definition.dagId, version: definition.version }
        });
    });
}
