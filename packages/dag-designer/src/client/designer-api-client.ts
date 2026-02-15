import type { IDagDefinition, TResult } from '@robota-sdk/dag-core';
import type {
    ICreateDefinitionInput,
    IDefinitionListItem,
    IDesignerApiClient,
    IDesignerApiClientConfig,
    IGetDefinitionInput,
    IListDefinitionsInput,
    IProblemDetails,
    IPublishDefinitionInput,
    IUpdateDraftInput,
    IValidateDefinitionInput
} from '../contracts/designer-api.js';

interface ILooseDesignerPayload {
    ok?: boolean;
    data?: {
        definition?: IDagDefinition;
        items?: IDefinitionListItem[];
    };
    errors?: IProblemDetails[];
}

function createContractViolationProblem(status: number, instance: string): IProblemDetails {
    return {
        type: 'https://robota.dev/problems/dag/contract',
        title: 'Invalid API response contract',
        status,
        detail: 'Response payload does not match designer API contract.',
        instance,
        code: 'DESIGNER_API_CONTRACT_VIOLATION',
        retryable: false
    };
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function hasValidProblemDetails(errors: IProblemDetails[]): boolean {
    return errors.every((error) =>
        typeof error.type === 'string' &&
        typeof error.title === 'string' &&
        typeof error.status === 'number' &&
        typeof error.detail === 'string' &&
        typeof error.instance === 'string' &&
        typeof error.code === 'string' &&
        typeof error.retryable === 'boolean'
    );
}

function hasValidDefinitionListItems(items: IDefinitionListItem[]): boolean {
    return items.every((item) =>
        typeof item.dagId === 'string'
        && typeof item.latestVersion === 'number'
        && Array.isArray(item.statuses)
    );
}

export class DesignerApiClient implements IDesignerApiClient {
    private readonly baseUrl: string;

    public constructor(config: IDesignerApiClientConfig) {
        this.baseUrl = normalizeBaseUrl(config.baseUrl);
    }

    public async createDefinition(input: ICreateDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>> {
        return this.requestDefinition(
            '/v1/dag/definitions',
            'POST',
            JSON.stringify({ definition: input.definition }),
            input.correlationId
        );
    }

    public async updateDraft(input: IUpdateDraftInput): Promise<TResult<IDagDefinition, IProblemDetails[]>> {
        return this.requestDefinition(
            `/v1/dag/definitions/${input.dagId}/draft`,
            'PUT',
            JSON.stringify({
                version: input.version,
                definition: input.definition
            }),
            input.correlationId
        );
    }

    public async validateDefinition(input: IValidateDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>> {
        return this.requestDefinition(
            `/v1/dag/definitions/${input.dagId}/validate`,
            'POST',
            JSON.stringify({ version: input.version }),
            input.correlationId
        );
    }

    public async publishDefinition(input: IPublishDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>> {
        return this.requestDefinition(
            `/v1/dag/definitions/${input.dagId}/publish`,
            'POST',
            JSON.stringify({ version: input.version }),
            input.correlationId
        );
    }

    public async getDefinition(input: IGetDefinitionInput): Promise<TResult<IDagDefinition, IProblemDetails[]>> {
        const versionQuery = typeof input.version === 'number' ? `?version=${input.version}` : '';
        return this.requestDefinition(
            `/v1/dag/definitions/${input.dagId}${versionQuery}`,
            'GET',
            undefined,
            input.correlationId
        );
    }

    public async listDefinitions(input?: IListDefinitionsInput): Promise<TResult<IDefinitionListItem[], IProblemDetails[]>> {
        const dagIdQuery = typeof input?.dagId === 'string' && input.dagId.trim().length > 0
            ? `?dagId=${encodeURIComponent(input.dagId)}`
            : '';
        const path = `/v1/dag/definitions${dagIdQuery}`;
        const payloadResult = await this.requestPayload(path, 'GET', undefined, input?.correlationId);
        if (!payloadResult.ok) {
            return payloadResult;
        }

        const payload = payloadResult.value;
        if (Array.isArray(payload.data?.items) && hasValidDefinitionListItems(payload.data.items)) {
            return {
                ok: true,
                value: payload.data.items
            };
        }

        return {
            ok: false,
            error: [createContractViolationProblem(200, path)]
        };
    }

    private async requestDefinition(
        path: string,
        method: 'GET' | 'POST' | 'PUT',
        body: string | undefined,
        correlationId?: string
    ): Promise<TResult<IDagDefinition, IProblemDetails[]>> {
        const payloadResult = await this.requestPayload(path, method, body, correlationId);
        if (!payloadResult.ok) {
            return payloadResult;
        }
        if (payloadResult.value.data?.definition) {
            return {
                ok: true,
                value: payloadResult.value.data.definition
            };
        }

        return {
            ok: false,
            error: [createContractViolationProblem(200, path)]
        };
    }

    private async requestPayload(
        path: string,
        method: 'GET' | 'POST' | 'PUT',
        body: string | undefined,
        correlationId?: string
    ): Promise<TResult<ILooseDesignerPayload, IProblemDetails[]>> {
        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
            method,
            headers: {
                'content-type': 'application/json',
                ...(correlationId ? { 'x-correlation-id': correlationId } : {})
            },
            body
        });

        const payload = (await response.json()) as ILooseDesignerPayload;
        if (response.ok && payload.ok === true) {
            return {
                ok: true,
                value: payload
            };
        }

        if (response.ok) {
            return {
                ok: false,
                error: [createContractViolationProblem(response.status, path)]
            };
        }

        if (payload.ok === false && Array.isArray(payload.errors) && hasValidProblemDetails(payload.errors)) {
            return {
                ok: false,
                error: payload.errors
            };
        }

        return {
            ok: false,
            error: [createContractViolationProblem(response.status, path)]
        };
    }
}
