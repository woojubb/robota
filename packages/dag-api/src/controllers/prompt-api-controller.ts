import type {
    IPromptBackendPort,
    IPromptRequest,
    IPromptResponse,
    IQueueStatus,
    IQueueAction,
    THistory,
    TObjectInfo,
    ISystemStats,
    TResult,
    IDagError,
} from '@robota-sdk/dag-core';

export class PromptApiController {
    constructor(private readonly backend: IPromptBackendPort) {}

    async submitPrompt(request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>> {
        const nodeIds = Object.keys(request.prompt);
        if (nodeIds.length === 0) {
            return {
                ok: false,
                error: {
                    code: 'PROMPT_NO_OUTPUTS',
                    category: 'validation',
                    message: 'Prompt has no nodes',
                    retryable: false,
                },
            };
        }

        for (const nodeId of nodeIds) {
            if (!request.prompt[nodeId].class_type) {
                return {
                    ok: false,
                    error: {
                        code: 'INVALID_NODE',
                        category: 'validation',
                        message: `Node ${nodeId} missing class_type`,
                        retryable: false,
                    },
                };
            }
        }

        return this.backend.submitPrompt(request);
    }

    async getQueue(): Promise<TResult<IQueueStatus, IDagError>> {
        return this.backend.getQueue();
    }

    async manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>> {
        return this.backend.manageQueue(action);
    }

    async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> {
        return this.backend.getHistory(promptId);
    }

    async getObjectInfo(nodeType?: string): Promise<TResult<TObjectInfo, IDagError>> {
        return this.backend.getObjectInfo(nodeType);
    }

    async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> {
        return this.backend.getSystemStats();
    }
}
