import type { IDagDefinition, TResult } from '@robota-sdk/dag-core';
import type {
    ICreateDefinitionInput,
    IDesignerApiClient,
    IDesignerApiClientConfig,
    IProblemDetails,
    IPublishDefinitionInput,
    IUpdateDraftInput,
    IValidateDefinitionInput
} from '../contracts/designer-api.js';

interface ILooseDesignerPayload {
    ok?: boolean;
    data?: {
        definition?: IDagDefinition;
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

    private async requestDefinition(
        path: string,
        method: 'POST' | 'PUT',
        body: string | undefined,
        correlationId?: string
    ): Promise<TResult<IDagDefinition, IProblemDetails[]>> {
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
        if (response.ok && payload.ok === true && payload.data?.definition) {
            return {
                ok: true,
                value: payload.data.definition
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
