import type { IDagDefinition, INodeManifest, TResult, TRunProgressEvent } from '@robota-sdk/dag-core';
import type {
    ICreateDefinitionInput,
    IDefinitionListItem,
    IGetPreviewRunResultInput,
    IPreviewResult,
    IDesignerApiClient,
    IDesignerApiClientConfig,
    IGetDefinitionInput,
    IListDefinitionsInput,
    IProblemDetails,
    IPublishDefinitionInput,
    IStartPreviewRunInput,
    ITriggerRunInput,
    IUpdateDraftInput,
    IValidateDefinitionInput
} from '../contracts/designer-api.js';

interface ILooseDesignerPayload {
    ok?: boolean;
    data?: {
        definition?: IDagDefinition;
        items?: IDefinitionListItem[];
        nodes?: INodeManifest[];
        dagRunId?: string;
        preview?: IPreviewResult;
    };
    errors?: IProblemDetails[];
}

interface IRunProgressEnvelope {
    event?: TRunProgressEvent;
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

function hasValidNodeManifests(nodes: INodeManifest[]): boolean {
    return nodes.every((node) =>
        typeof node.nodeType === 'string'
        && typeof node.displayName === 'string'
        && typeof node.category === 'string'
        && Array.isArray(node.inputs)
        && Array.isArray(node.outputs)
    );
}

function hasValidPreviewResult(preview: IPreviewResult): boolean {
    if (
        typeof preview.dagRunId !== 'string'
        || !Array.isArray(preview.traces)
        || typeof preview.totalCostUsd !== 'number'
    ) {
        return false;
    }
    return preview.traces.every((trace) =>
        typeof trace.nodeId === 'string' &&
        typeof trace.nodeType === 'string' &&
        typeof trace.input === 'object' && trace.input !== null &&
        typeof trace.output === 'object' && trace.output !== null &&
        typeof trace.estimatedCostUsd === 'number' &&
        typeof trace.totalCostUsd === 'number'
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

    public async listNodeCatalog(): Promise<TResult<INodeManifest[], IProblemDetails[]>> {
        const path = '/v1/dag/nodes';
        const payloadResult = await this.requestPayload(path, 'GET', undefined);
        if (!payloadResult.ok) {
            return payloadResult;
        }
        const nodes = payloadResult.value.data?.nodes;
        if (Array.isArray(nodes) && hasValidNodeManifests(nodes)) {
            return {
                ok: true,
                value: nodes
            };
        }
        return {
            ok: false,
            error: [createContractViolationProblem(200, path)]
        };
    }

    public async startPreviewRun(input: IStartPreviewRunInput): Promise<TResult<{ dagRunId: string }, IProblemDetails[]>> {
        const path = '/v1/dag/dev/preview/runs';
        const payloadResult = await this.requestPayload(
            path,
            'POST',
            JSON.stringify({
                definition: input.definition,
                input: input.input ?? {}
            }),
            input.correlationId
        );
        if (!payloadResult.ok) {
            return payloadResult;
        }
        const dagRunId = payloadResult.value.data?.dagRunId;
        if (typeof dagRunId === 'string' && dagRunId.length > 0) {
            return {
                ok: true,
                value: { dagRunId }
            };
        }
        return {
            ok: false,
            error: [createContractViolationProblem(200, path)]
        };
    }

    public async getPreviewRunResult(input: IGetPreviewRunResultInput): Promise<TResult<IPreviewResult, IProblemDetails[]>> {
        const path = `/v1/dag/dev/preview/runs/${input.dagRunId}/result`;
        const payloadResult = await this.requestPayload(
            path,
            'GET',
            undefined,
            input.correlationId
        );
        if (!payloadResult.ok) {
            return payloadResult;
        }
        const preview = payloadResult.value.data?.preview;
        if (preview && hasValidPreviewResult(preview)) {
            return {
                ok: true,
                value: preview
            };
        }
        return {
            ok: false,
            error: [createContractViolationProblem(200, path)]
        };
    }

    public async triggerRun(input: ITriggerRunInput): Promise<TResult<{ dagRunId: string }, IProblemDetails[]>> {
        const path = '/v1/dag/dev/runs';
        const payloadResult = await this.requestPayload(
            path,
            'POST',
            JSON.stringify({
                dagId: input.dagId,
                version: input.version,
                input: input.input ?? {},
                logicalDate: input.logicalDate
            }),
            input.correlationId
        );
        if (!payloadResult.ok) {
            return payloadResult;
        }
        const dagRunId = payloadResult.value.data?.dagRunId;
        if (typeof dagRunId === 'string' && dagRunId.length > 0) {
            return {
                ok: true,
                value: { dagRunId }
            };
        }
        return {
            ok: false,
            error: [createContractViolationProblem(200, path)]
        };
    }

    public subscribeRunProgress(input: {
        dagRunId: string;
        onEvent: (event: TRunProgressEvent) => void;
        onError?: (error: Error) => void;
    }): () => void {
        if (typeof EventSource === 'undefined') {
            input.onError?.(new Error('EventSource is not available in this environment.'));
            return () => {
                return;
            };
        }
        const path = `/v1/dag/dev/runs/${encodeURIComponent(input.dagRunId)}/events`;
        const eventSource = new EventSource(`${this.baseUrl}${path}`);
        eventSource.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data) as IRunProgressEnvelope;
                if (!parsed.event) {
                    return;
                }
                input.onEvent(parsed.event);
            } catch {
                input.onError?.(new Error('Failed to parse run progress event payload.'));
            }
        };
        eventSource.onerror = () => {
            input.onError?.(new Error('Run progress stream disconnected.'));
        };
        return () => {
            eventSource.close();
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
