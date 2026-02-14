import { type DagDefinitionService, type IDagDefinition } from '@robota-sdk/dag-core';
import type {
    ICreateDefinitionRequest,
    IDefinitionValidationResult,
    IPublishDefinitionRequest,
    TDesignApiResponse,
    IUpdateDraftRequest,
    IValidateDefinitionRequest
} from '../contracts/design-api.js';
import { toProblemDetails } from '../contracts/design-api.js';

export class DagDesignController {
    public constructor(private readonly definitionService: DagDefinitionService) {}

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
}
