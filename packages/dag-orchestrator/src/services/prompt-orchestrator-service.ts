import type {
    TResult,
    IDagError,
    IQueueStatus,
    IQueueAction,
    THistory,
    TObjectInfo,
    ISystemStats,
} from '@robota-sdk/dag-core';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';
import type {
    IOrchestratedPromptRequest,
    IOrchestratedPromptResponse,
} from '../types/orchestrator-types.js';
import type {
    ICostEstimatorPort,
    ICostPolicyEvaluatorPort,
} from '../interfaces/orchestrator-policy-port.js';

/**
 * Orchestrator service — gateway to Prompt API Server.
 * Communicates via IPromptApiClientPort (HTTP), not IPromptBackendPort.
 */
export class PromptOrchestratorService {
    constructor(
        private readonly apiClient: IPromptApiClientPort,
        private readonly costEstimator: ICostEstimatorPort,
        private readonly costPolicyEvaluator: ICostPolicyEvaluatorPort,
    ) {}

    async submitPrompt(
        request: IOrchestratedPromptRequest,
    ): Promise<TResult<IOrchestratedPromptResponse, IDagError>> {
        const { promptRequest, config } = request;

        if (config?.costPolicy) {
            const objectInfoResult = await this.apiClient.getObjectInfo();
            if (!objectInfoResult.ok) return objectInfoResult;

            const nodeTypes = Object.values(promptRequest.prompt).map((n) => n.class_type);
            const estimateResult = await this.costEstimator.estimateCost(
                nodeTypes,
                objectInfoResult.value,
            );
            if (!estimateResult.ok) return estimateResult;

            const policyResult = this.costPolicyEvaluator.evaluate(
                estimateResult.value,
                config.costPolicy,
            );
            if (!policyResult.ok) return policyResult;

            const submitResult = await this.apiClient.submitPrompt(promptRequest);
            if (!submitResult.ok) return submitResult;

            return {
                ok: true,
                value: {
                    promptResponse: submitResult.value,
                    costEstimate: estimateResult.value,
                },
            };
        }

        const submitResult = await this.apiClient.submitPrompt(promptRequest);
        if (!submitResult.ok) return submitResult;

        return {
            ok: true,
            value: { promptResponse: submitResult.value },
        };
    }

    async getQueue(): Promise<TResult<IQueueStatus, IDagError>> {
        return this.apiClient.getQueue();
    }

    async manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>> {
        return this.apiClient.manageQueue(action);
    }

    async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> {
        return this.apiClient.getHistory(promptId);
    }

    async getObjectInfo(nodeType?: string): Promise<TResult<TObjectInfo, IDagError>> {
        return this.apiClient.getObjectInfo(nodeType);
    }

    async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> {
        return this.apiClient.getSystemStats();
    }
}
