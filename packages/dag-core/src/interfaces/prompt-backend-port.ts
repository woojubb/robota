import type { TResult } from '../types/result.js';
import type { IDagError } from '../types/error.js';
import type {
    IPromptRequest,
    IPromptResponse,
    IQueueStatus,
    IQueueAction,
    THistory,
    IObjectInfo,
    ISystemStats,
} from '../types/prompt-types.js';

/**
 * Port interface for prompt-compatible backends.
 * Method signatures derived from OpenAPI spec operations.
 * Implemented by Robota DAG runtime adapter or external HTTP proxy.
 */
export interface IPromptBackendPort {
    submitPrompt(request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>>;
    getQueue(): Promise<TResult<IQueueStatus, IDagError>>;
    manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>>;
    getHistory(promptId?: string): Promise<TResult<THistory, IDagError>>;
    getObjectInfo(nodeType?: string): Promise<TResult<IObjectInfo, IDagError>>;
    getSystemStats(): Promise<TResult<ISystemStats, IDagError>>;
}
