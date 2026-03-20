import type { TResult, IDagError, TObjectInfo, TPrompt } from '@robota-sdk/dag-core';
import type { IPromptCostEstimate, IPromptCostPolicy } from '../types/orchestrator-types.js';

export interface ICostEstimatorPort {
    estimateCost(
        prompt: TPrompt,
        objectInfo: TObjectInfo,
    ): Promise<TResult<IPromptCostEstimate, IDagError>>;
}

export interface ICostPolicyEvaluatorPort {
    evaluate(
        estimate: IPromptCostEstimate,
        policy: IPromptCostPolicy,
    ): TResult<void, IDagError>;
}
