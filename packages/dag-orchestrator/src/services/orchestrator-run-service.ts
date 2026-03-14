import { randomUUID } from 'node:crypto';
import type {
    IDagDefinition,
    IDagError,
    IPromptRequest,
    TPortPayload,
    TResult,
    IRunResult,
    IRunNodeTrace,
    IRunNodeError,
    TRunProgressEvent,
} from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';
import { translateDefinitionToPrompt } from '../adapters/definition-to-prompt-translator.js';

type TRunStatus = 'pending' | 'running' | 'success' | 'failed';

interface IRunState {
    promptId: string | undefined;
    promptRequest: IPromptRequest;
    definition: IDagDefinition;
    status: TRunStatus;
    input: TPortPayload;
    nodeEvents: TRunProgressEvent[];
}

export class OrchestratorRunService {
    private readonly runs = new Map<string, IRunState>();

    constructor(private readonly promptClient: IPromptApiClientPort) {}

    getPromptIdForRun(dagRunId: string): string | undefined {
        return this.runs.get(dagRunId)?.promptId ?? undefined;
    }

    recordEvent(dagRunId: string, event: TRunProgressEvent): void {
        const run = this.runs.get(dagRunId);
        if (!run) return;

        run.nodeEvents.push(event);

        if (event.eventType === 'execution.completed') {
            run.status = 'success';
        } else if (event.eventType === 'execution.failed') {
            run.status = 'failed';
        }
    }

    async createRun(
        definition: IDagDefinition,
        input: TPortPayload
    ): Promise<TResult<{ dagRunId: string }, IDagError>> {
        const translationResult = translateDefinitionToPrompt(definition, input);
        if (!translationResult.ok) {
            return translationResult;
        }

        const dagRunId = randomUUID();
        this.runs.set(dagRunId, {
            promptId: undefined,
            promptRequest: translationResult.value,
            definition,
            status: 'pending',
            input,
            nodeEvents: [],
        });

        return {
            ok: true,
            value: { dagRunId },
        };
    }

    async startRun(dagRunId: string): Promise<TResult<{ dagRunId: string; promptId: string }, IDagError>> {
        const run = this.runs.get(dagRunId);
        if (!run) {
            return {
                ok: false,
                error: buildValidationError(
                    'ORCHESTRATOR_RUN_NOT_FOUND',
                    'Run not found',
                    { dagRunId }
                ),
            };
        }
        if (run.status !== 'pending') {
            return {
                ok: false,
                error: buildValidationError(
                    'ORCHESTRATOR_RUN_ALREADY_STARTED',
                    'Run has already been started',
                    { dagRunId }
                ),
            };
        }

        const submitResult = await this.promptClient.submitPrompt(run.promptRequest);
        if (!submitResult.ok) {
            run.status = 'failed';
            return submitResult;
        }

        const promptId = submitResult.value.prompt_id;
        run.promptId = promptId;
        run.status = 'running';

        return {
            ok: true,
            value: { dagRunId, promptId },
        };
    }

    async createAndStartRun(
        definition: IDagDefinition,
        input: TPortPayload
    ): Promise<TResult<{ dagRunId: string; promptId: string }, IDagError>> {
        const createResult = await this.createRun(definition, input);
        if (!createResult.ok) {
            return createResult;
        }
        return this.startRun(createResult.value.dagRunId);
    }

    async getRunStatus(dagRunId: string): Promise<TResult<{ status: TRunStatus }, IDagError>> {
        const run = this.runs.get(dagRunId);
        if (!run) {
            return {
                ok: false,
                error: buildValidationError(
                    'ORCHESTRATOR_RUN_NOT_FOUND',
                    'Run not found',
                    { dagRunId }
                ),
            };
        }

        if (run.status === 'running' && typeof run.promptId === 'string') {
            const historyResult = await this.promptClient.getHistory(run.promptId);
            if (historyResult.ok) {
                const entry = historyResult.value[run.promptId];
                if (entry) {
                    const newStatus = entry.status.status_str === 'success' ? 'success' : 'failed';
                    run.status = newStatus;
                }
            }
        }

        return { ok: true, value: { status: run.status } };
    }

    async getRunResult(dagRunId: string): Promise<TResult<IRunResult, IDagError>> {
        const run = this.runs.get(dagRunId);
        if (!run) {
            return {
                ok: false,
                error: buildValidationError(
                    'ORCHESTRATOR_RUN_NOT_FOUND',
                    'Run not found',
                    { dagRunId }
                ),
            };
        }

        if (typeof run.promptId !== 'string') {
            return {
                ok: false,
                error: buildValidationError(
                    'ORCHESTRATOR_RUN_NOT_COMPLETED',
                    'Run has not been started yet',
                    { dagRunId }
                ),
            };
        }

        const promptId = run.promptId;
        const historyResult = await this.promptClient.getHistory(promptId);
        if (!historyResult.ok) {
            return historyResult;
        }

        const entry = historyResult.value[promptId];
        if (!entry) {
            return {
                ok: false,
                error: buildValidationError(
                    'ORCHESTRATOR_RUN_NOT_COMPLETED',
                    'Run has not completed yet',
                    { dagRunId, promptId }
                ),
            };
        }

        const nodeTypeMap = new Map(
            run.definition.nodes.map((node) => [node.nodeId, node.nodeType])
        );

        if (entry.status.status_str !== 'success') {
            run.status = 'failed';
            const nodeErrors: IRunNodeError[] = run.nodeEvents
                .filter((evt): evt is Extract<TRunProgressEvent, { eventType: 'task.failed' }> =>
                    evt.eventType === 'task.failed'
                )
                .map((evt) => ({
                    nodeId: evt.nodeId,
                    nodeType: nodeTypeMap.get(evt.nodeId) ?? 'unknown',
                    error: evt.error,
                    occurredAt: evt.occurredAt,
                }));

            return {
                ok: true,
                value: {
                    dagRunId,
                    status: 'failed',
                    traces: [],
                    nodeErrors,
                    totalCostUsd: 0,
                },
            };
        }

        run.status = 'success';
        const traces: IRunNodeTrace[] = run.definition.nodes.map((node) => ({
            nodeId: node.nodeId,
            nodeType: node.nodeType,
            input: {},
            output: {},
            estimatedCostUsd: 0,
            totalCostUsd: 0,
        }));

        return {
            ok: true,
            value: {
                dagRunId,
                status: 'success',
                traces,
                nodeErrors: [],
                totalCostUsd: 0,
            },
        };
    }
}
