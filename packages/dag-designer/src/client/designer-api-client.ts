import type { IDagDefinition, IRunResult, TObjectInfo, TResult, TRunProgressEvent } from '@robota-sdk/dag-core';
import type { IProblemDetails, IDefinitionListItem } from '@robota-sdk/dag-api';
import type {
    IDesignerCreateRunInput,
    ICreateDefinitionInput,
    IGetRunResultInput,
    IDesignerApiClient,
    IDesignerApiClientConfig,
    IGetDefinitionInput,
    IListDefinitionsInput,
    IPublishDefinitionInput,
    IDesignerStartRunInput,
    ISubscribeRunProgressInput,
    IUpdateDraftInput,
    IValidateDefinitionInput
} from '../contracts/designer-api.js';

interface ILooseDesignerPayload {
    ok?: boolean;
    data?: {
        definition?: IDagDefinition;
        items?: IDefinitionListItem[];
        preparationId?: string;
        dagRunId?: string;
        run?: IRunResult;
    };
    errors?: IProblemDetails[];
}

interface IRunProgressEnvelope {
    event?: TRunProgressEvent;
}

function createContractViolationProblem(status: number, instance: string): IProblemDetails {
    return {
        type: 'urn:robota:problems:dag:contract',
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

export function hasValidRunResult(run: IRunResult): boolean {
    if (
        typeof run.dagRunId !== 'string'
        || typeof run.status !== 'string'
        || !Array.isArray(run.traces)
        || !Array.isArray(run.nodeErrors)
        || typeof run.totalCredits !== 'number'
    ) {
        return false;
    }
    return run.traces.every((trace) =>
        typeof trace.nodeId === 'string' &&
        typeof trace.nodeType === 'string' &&
        typeof trace.input === 'object' && trace.input !== null &&
        typeof trace.output === 'object' && trace.output !== null &&
        typeof trace.estimatedCredits === 'number' &&
        typeof trace.totalCredits === 'number'
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

    public async listObjectInfo(): Promise<TResult<TObjectInfo, IProblemDetails[]>> {
        const path = '/v1/dag/nodes';
        const payloadResult = await this.requestPayload(path, 'GET', undefined);
        if (!payloadResult.ok) {
            return payloadResult;
        }
        const data = payloadResult.value.data;
        if (data && typeof data === 'object') {
            return { ok: true, value: data as TObjectInfo };
        }
        return { ok: false, error: [createContractViolationProblem(200, path)] };
    }

    public async createRun(input: IDesignerCreateRunInput): Promise<TResult<{ preparationId: string }, IProblemDetails[]>> {
        const path = '/v1/dag/runs';
        const payloadResult = await this.requestPayload(
            path,
            'POST',
            JSON.stringify({
                definition: input.definition,
                input: input.input
            }),
            input.correlationId
        );
        if (!payloadResult.ok) {
            return payloadResult;
        }
        const preparationId = payloadResult.value.data?.preparationId;
        if (typeof preparationId === 'string' && preparationId.length > 0) {
            return {
                ok: true,
                value: { preparationId }
            };
        }
        return {
            ok: false,
            error: [createContractViolationProblem(200, path)]
        };
    }

    public async startRun(
        input: IDesignerStartRunInput
    ): Promise<TResult<{ dagRunId: string }, IProblemDetails[]>> {
        const path = `/v1/dag/runs/${input.preparationId}/start`;
        const payloadResult = await this.requestPayload(
            path,
            'POST',
            JSON.stringify({}),
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

    public async getRunResult(input: IGetRunResultInput): Promise<TResult<IRunResult, IProblemDetails[]>> {
        const path = `/v1/dag/runs/${input.dagRunId}/result`;
        const payloadResult = await this.requestPayload(
            path,
            'GET',
            undefined,
            input.correlationId
        );
        if (!payloadResult.ok) {
            return payloadResult;
        }
        const run = payloadResult.value.data?.run;
        if (run && hasValidRunResult(run)) {
            return {
                ok: true,
                value: run
            };
        }
        return {
            ok: false,
            error: [createContractViolationProblem(200, path)]
        };
    }

    public subscribeRunProgress(input: ISubscribeRunProgressInput): () => void {
        if (typeof WebSocket === 'undefined') {
            input.onError?.(new Error('WebSocket is not available in this environment.'));
            return () => { return; };
        }
        const wsProtocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
        const wsHost = this.baseUrl.replace(/^https?:\/\//, '');
        const path = `/v1/dag/runs/${encodeURIComponent(input.preparationId)}/ws`;
        const wsUrl = `${wsProtocol}://${wsHost}${path}`;

        const maxReconnectAttempts = input.maxReconnectAttempts ?? 5;
        const initialReconnectDelayMs = input.initialReconnectDelayMs ?? 500;
        let reconnectAttempt = 0;
        let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
        let closed = false;
        let ws: WebSocket | undefined;

        const clearReconnectTimer = (): void => {
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = undefined;
            }
        };

        const connect = (): void => {
            if (closed) return;
            const nextWs = new WebSocket(wsUrl);
            ws = nextWs;
            nextWs.onopen = () => { reconnectAttempt = 0; };
            nextWs.onmessage = (msgEvent) => {
                try {
                    const parsed = JSON.parse(String(msgEvent.data)) as IRunProgressEnvelope;
                    if (parsed.event) {
                        input.onEvent(parsed.event);
                    }
                } catch {
                    input.onError?.(new Error('Failed to parse run progress event payload.'));
                }
            };
            nextWs.onerror = () => {
                // onerror is always followed by onclose in browsers
            };
            nextWs.onclose = () => {
                if (closed) return;
                if (ws !== nextWs) return;
                if (reconnectAttempt >= maxReconnectAttempts) {
                    input.onError?.(new Error('Run progress stream disconnected.'));
                    return;
                }
                const delay = initialReconnectDelayMs * (2 ** reconnectAttempt);
                reconnectAttempt += 1;
                clearReconnectTimer();
                reconnectTimer = setTimeout(() => { connect(); }, delay);
            };
        };

        connect();

        return () => {
            closed = true;
            clearReconnectTimer();
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                ws.close();
            }
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
