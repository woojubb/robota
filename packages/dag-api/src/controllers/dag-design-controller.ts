import { type DagDefinitionService, type IDagDefinition, type INodeManifest, buildValidationError } from '@robota-sdk/dag-core';
import {
    toProblemDetails,
    type ICreateDefinitionRequest,
    type IDefinitionListItem,
    type IDefinitionValidationResult,
    type IGetDefinitionRequest,
    type IListDefinitionsRequest,
    type IListNodeCatalogRequest,
    type IPublishDefinitionRequest,
    type TDesignApiResponse,
    type IUpdateDraftRequest,
    type IValidateDefinitionRequest
} from '../contracts/design-api.js';

export interface INodeCatalogService {
    listManifests(): Promise<INodeManifest[]>;
    hasNodeType(nodeType: string): boolean;
}

export class DagDesignController {
    public constructor(
        private readonly definitionService: DagDefinitionService,
        private readonly nodeCatalogService?: INodeCatalogService
    ) {}

    public async createDefinition(
        request: ICreateDefinitionRequest
    ): Promise<TDesignApiResponse<{ definitionId: string; definition: ICreateDefinitionRequest['definition'] }>> {
        const created = await this.definitionService.createDraft(request.definition);
        if (!created.ok) {
            return {
                ok: false,
                status: 400,
                errors: created.error.map((error) =>
                    toProblemDetails(
                        error,
                        `/v1/dag/definitions/${request.definition.dagId}/versions/${request.definition.version}`,
                        request.correlationId
                    )
                )
            };
        }

        return {
            ok: true,
            status: 201,
            data: {
                definitionId: `${created.value.dagId}:${created.value.version}`,
                definition: created.value
            }
        };
    }

    public async updateDraft(
        request: IUpdateDraftRequest
    ): Promise<TDesignApiResponse<{ definition: IUpdateDraftRequest['definition'] }>> {
        const updated = await this.definitionService.updateDraft(request.definition);
        if (!updated.ok) {
            return {
                ok: false,
                status: 400,
                errors: updated.error.map((error) =>
                    toProblemDetails(
                        error,
                        `/v1/dag/definitions/${request.dagId}/versions/${request.version}`,
                        request.correlationId
                    )
                )
            };
        }

        return {
            ok: true,
            status: 200,
            data: {
                definition: updated.value
            }
        };
    }

    public async validateDefinition(
        request: IValidateDefinitionRequest
    ): Promise<TDesignApiResponse<IDefinitionValidationResult>> {
        if (this.nodeCatalogService) {
            const existing = await this.definitionService.getDefinitionByDagId(request.dagId, request.version);
            if (!existing) {
                const notFound = buildValidationError(
                    'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                    'Definition does not exist',
                    { dagId: request.dagId, version: request.version }
                );
                return {
                    ok: false,
                    status: 400,
                    errors: [
                        toProblemDetails(
                            notFound,
                            `/v1/dag/definitions/${request.dagId}/versions/${request.version}/validate`,
                            request.correlationId
                        )
                    ]
                };
            }
            for (const node of existing.nodes) {
                if (!this.nodeCatalogService.hasNodeType(node.nodeType)) {
                    const nodeTypeError = buildValidationError(
                        'DAG_VALIDATION_NODE_TYPE_NOT_REGISTERED',
                        'Node type is not registered in node catalog',
                        { nodeType: node.nodeType, nodeId: node.nodeId }
                    );
                    return {
                        ok: false,
                        status: 400,
                        errors: [
                            toProblemDetails(
                                nodeTypeError,
                                `/v1/dag/definitions/${request.dagId}/versions/${request.version}/validate`,
                                request.correlationId
                            )
                        ]
                    };
                }
            }
        }

        const validated = await this.definitionService.validate(request.dagId, request.version);
        if (!validated.ok) {
            return {
                ok: false,
                status: 400,
                errors: validated.error.map((error) =>
                    toProblemDetails(
                        error,
                        `/v1/dag/definitions/${request.dagId}/versions/${request.version}/validate`,
                        request.correlationId
                    )
                )
            };
        }

        return {
            ok: true,
            status: 200,
            data: {
                definition: validated.value,
                valid: true
            }
        };
    }

    public async publishDefinition(
        request: IPublishDefinitionRequest
    ): Promise<TDesignApiResponse<{ definitionId: string; definition: IDagDefinition }>> {
        const published = await this.definitionService.publish(request.dagId, request.version);
        if (!published.ok) {
            return {
                ok: false,
                status: 400,
                errors: published.error.map((error) =>
                    toProblemDetails(
                        error,
                        `/v1/dag/definitions/${request.dagId}/versions/${request.version}/publish`,
                        request.correlationId
                    )
                )
            };
        }

        return {
            ok: true,
            status: 200,
            data: {
                definitionId: `${published.value.dagId}:${published.value.version}`,
                definition: published.value
            }
        };
    }

    public async getDefinition(
        request: IGetDefinitionRequest
    ): Promise<TDesignApiResponse<{ definition: IDagDefinition }>> {
        const definition = await this.definitionService.getDefinitionByDagId(request.dagId, request.version);
        if (!definition) {
            const error = buildValidationError(
                'DAG_VALIDATION_DEFINITION_NOT_FOUND',
                'Definition does not exist',
                { dagId: request.dagId, version: request.version ?? 'latest' }
            );
            return {
                ok: false,
                status: 404,
                errors: [
                    toProblemDetails(
                        error,
                        `/v1/dag/definitions/${request.dagId}${typeof request.version === 'number' ? `?version=${request.version}` : ''}`,
                        request.correlationId
                    )
                ]
            };
        }

        return {
            ok: true,
            status: 200,
            data: { definition }
        };
    }

    public async listDefinitions(
        request: IListDefinitionsRequest
    ): Promise<TDesignApiResponse<{ items: IDefinitionListItem[] }>> {
        const definitions = await this.definitionService.listDefinitions(request.dagId);
        const listItemByDagId = new Map<string, IDefinitionListItem>();

        for (const definition of definitions) {
            const existing = listItemByDagId.get(definition.dagId);
            if (!existing) {
                listItemByDagId.set(definition.dagId, {
                    dagId: definition.dagId,
                    latestVersion: definition.version,
                    statuses: [definition.status]
                });
                continue;
            }

            const nextStatuses = existing.statuses.includes(definition.status)
                ? existing.statuses
                : [...existing.statuses, definition.status];
            listItemByDagId.set(definition.dagId, {
                dagId: definition.dagId,
                latestVersion: Math.max(existing.latestVersion, definition.version),
                statuses: nextStatuses
            });
        }

        return {
            ok: true,
            status: 200,
            data: {
                items: [...listItemByDagId.values()].sort((a, b) => a.dagId.localeCompare(b.dagId))
            }
        };
    }

    public async listNodeCatalog(
        request: IListNodeCatalogRequest
    ): Promise<TDesignApiResponse<{ nodes: INodeManifest[] }>> {
        if (!this.nodeCatalogService) {
            const error = buildValidationError(
                'DAG_VALIDATION_NODE_CATALOG_NOT_CONFIGURED',
                'Node catalog service is not configured'
            );
            return {
                ok: false,
                status: 400,
                errors: [
                    toProblemDetails(
                        error,
                        '/v1/dag/nodes',
                        request.correlationId
                    )
                ]
            };
        }
        const nodes = await this.nodeCatalogService.listManifests();
        return {
            ok: true,
            status: 200,
            data: { nodes }
        };
    }

}
