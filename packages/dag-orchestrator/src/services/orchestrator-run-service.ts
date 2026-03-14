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
    dagRunId: string | undefined;
    promptRequest: IPromptRequest;
    definition: IDagDefinition;
    status: TRunStatus;
    input: TPortPayload;
    nodeEvents: TRunProgressEvent[];
}

export class OrchestratorRunService {
    /** Keyed by preparationId (pre-start internal key). */
    private readonly runs = new Map<string, IRunState>();
    /** Maps dagRunId (= promptId) → preparationId for post-start lookups. */
    private readonly dagRunIdIndex = new Map<string, string>();

    getDagRunId(preparationId: string): string | undefined {
        return this.runs.get(preparationId)?.dagRunId ?? undefined;
    }

    getPendingPromptRequest(preparationId: string): IPromptRequest | undefined {
        const run = this.runs.get(preparationId);
        if (!run || run.status !== 'pending') return undefined;
        return run.promptRequest;
    }

    getPendingDefinition(preparationId: string): IDagDefinition | undefined {
        const run = this.runs.get(preparationId);
        if (!run || run.status !== 'pending') return undefined;
        return run.definition;
    }

    private findRun(id: string): { run: IRunState; preparationId: string } | undefined {
        const prepId = this.dagRunIdIndex.get(id);
        if (prepId !== undefined) {
            const run = this.runs.get(prepId);
            if (run) return { run, preparationId: prepId };
        }
        const run = this.runs.get(id);
        if (run) return { run, preparationId: id };
        return undefined;
    }

    recordEvent(dagRunId: string, event: TRunProgressEvent): void {
        const found = this.findRun(dagRunId);
        if (!found) return;

        found.run.nodeEvents.push(event);

        if (event.eventType === 'execution.completed') {
            found.run.status = 'success';
        } else if (event.eventType === 'execution.failed') {
            found.run.status = 'failed';
        }
    }

    async createRun(
        definition: IDagDefinition,
        input: TPortPayload
    ): Promise<TResult<{ preparationId: string }, IDagError>> {
        const translationResult = translateDefinitionToPrompt(definition, input);
        if (!translationResult.ok) {
            return translationResult;
        }

        const preparationId = randomUUID();
        this.runs.set(preparationId, {
            dagRunId: undefined,
            promptRequest: translationResult.value,
            definition,
            status: 'pending',
            input,
            nodeEvents: [],
        });

        return {
            ok: true,
            value: { preparationId },
        };
    }

    async startRun(preparationId: string): Promise<TResult<{ dagRunId: string; preparationId: string }, IDagError>> {
        const run = this.runs.get(preparationId);
        if (!run) {
            return {
                ok: false,
                error: buildValidationError(
                    'ORCHESTRATOR_RUN_NOT_FOUND',
                    'Run not found',
                    { preparationId }
                ),
            };
        }
        if (run.status !== 'pending') {
            return {
                ok: false,
                error: buildValidationError(
                    'ORCHESTRATOR_RUN_ALREADY_STARTED',
                    'Run has already been started',
                    { preparationId }
                ),
            };
        }

        const submitResult = await this.promptClient.submitPrompt(run.promptRequest);
        if (!submitResult.ok) {
            run.status = 'failed';
            return submitResult;
        }

        const promptId = submitResult.value.prompt_id;
        run.dagRunId = promptId;
        run.status = 'running';
        this.dagRunIdIndex.set(promptId, preparationId);

        return {
            ok: true,
            value: { dagRunId: promptId, preparationId },
        };
    }

    async createAndStartRun(
        definition: IDagDefinition,
        input: TPortPayload
    ): Promise<TResult<{ dagRunId: string; preparationId: string }, IDagError>> {
        const createResult = await this.createRun(definition, input);
        if (!createResult.ok) {
            return createResult;
        }
        return this.startRun(createResult.value.preparationId);
    }

    async getRunStatus(dagRunId: string): Promise<TResult<{ status: TRunStatus }, IDagError>> {
        const found = this.findRun(dagRunId);
        if (!found) {
            return {
                ok: false,
                error: buildValidationError(
                    'ORCHESTRATOR_RUN_NOT_FOUND',
                    'Run not found',
                    { dagRunId }
                ),
            };
        }

        const { run } = found;

        if (run.status === 'running' && typeof run.dagRunId === 'string') {
            const historyResult = await this.promptClient.getHistory(run.dagRunId);
            if (historyResult.ok) {
                const entry = historyResult.value[run.dagRunId];
                if (entry) {
                    const newStatus = entry.status.status_str === 'success' ? 'success' : 'failed';
                    run.status = newStatus;
                }
            }
        }

        return { ok: true, value: { status: run.status } };
    }

    async getRunResult(dagRunId: string): Promise<TResult<IRunResult, IDagError>> {
        const found = this.findRun(dagRunId);
        if (!found) {
            return { ok: false, error: buildValidationError('ORCHESTRATOR_RUN_NOT_FOUND', 'Run not found', { dagRunId }) };
        }

        const { run } = found;
        if (typeof run.dagRunId !== 'string') {
            return { ok: false, error: buildValidationError('ORCHESTRATOR_RUN_NOT_COMPLETED', 'Run has not been started yet', { dagRunId }) };
        }

        const promptId = run.dagRunId;
        const historyResult = await this.promptClient.getHistory(promptId);
        if (!historyResult.ok) return historyResult;

        const entry = historyResult.value[promptId];
        if (!entry) {
            return { ok: false, error: buildValidationError('ORCHESTRATOR_RUN_NOT_COMPLETED', 'Run has not completed yet', { dagRunId, promptId }) };
        }

        if (entry.status.status_str !== 'success') {
            run.status = 'failed';
            return { ok: true, value: this.buildFailedRunResult(run, promptId) };
        }
        run.status = 'success';
        return { ok: true, value: this.buildSuccessRunResult(run, promptId) };
    }

    private buildFailedRunResult(run: IRunState, promptId: string): IRunResult {
        const nodeTypeMap = new Map(
            run.definition.nodes.map((node) => [node.nodeId, node.nodeType])
        );
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
            dagRunId: promptId,
            status: 'failed',
            traces: [],
            nodeErrors,
            totalCredits: 0,
        };
    }

    private buildSuccessRunResult(run: IRunState, promptId: string): IRunResult {
        const completedEventsByNode = new Map<string, TRunProgressEvent & { eventType: 'task.completed' }>();
        for (const evt of run.nodeEvents) {
            if (evt.eventType === 'task.completed') {
                completedEventsByNode.set(evt.nodeId, evt);
            }
        }

        const traces: IRunNodeTrace[] = run.definition.nodes.map((node) => {
            const completedEvt = completedEventsByNode.get(node.nodeId);
            return {
                nodeId: node.nodeId,
                nodeType: node.nodeType,
                input: completedEvt?.input ?? {},
                output: completedEvt?.output ?? {},
                estimatedCredits: 0,
                totalCredits: 0,
            };
        });

        return {
            dagRunId: promptId,
            status: 'success',
            traces,
            nodeErrors: [],
            totalCredits: 0,
        };
    }

    constructor(private readonly promptClient: IPromptApiClientPort) {}
}
