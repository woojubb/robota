import type { TResult, IDagError, TObjectInfo } from '@robota-sdk/dag-core';
import type { ICostEstimate, ICostPolicy } from '../types/orchestrator-types.js';

export interface ICostEstimatorPort {
    estimateCost(
        nodeTypes: string[],
        objectInfo: TObjectInfo,
    ): Promise<TResult<ICostEstimate, IDagError>>;
}

export interface ICostPolicyEvaluatorPort {
    evaluate(
        estimate: ICostEstimate,
        policy: ICostPolicy,
    ): TResult<void, IDagError>;
}
