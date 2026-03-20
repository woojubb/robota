import type {
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

/**
 * Port for communicating with a Prompt API Server over HTTP.
 * Method signatures derived from OpenAPI spec operations.
 *
 * NOT the same as IPromptBackendPort:
 * - IPromptBackendPort: used inside Prompt API Server to talk to backend runtime
 * - IPromptApiClientPort: used by Orchestrator to call Prompt API Server over HTTP
 */
export interface IPromptApiClientPort {
    submitPrompt(request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>>;
    getQueue(): Promise<TResult<IQueueStatus, IDagError>>;
    manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>>;
    getHistory(promptId?: string): Promise<TResult<THistory, IDagError>>;
    getObjectInfo(nodeType?: string): Promise<TResult<TObjectInfo, IDagError>>;
    getSystemStats(): Promise<TResult<ISystemStats, IDagError>>;
}
