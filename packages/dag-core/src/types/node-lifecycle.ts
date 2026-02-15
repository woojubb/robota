import type { TPortPayload } from '../interfaces/ports.js';
import type { IDagError } from './error.js';
import type { TResult } from './result.js';
import type { IDagNodeDefinition, INodeManifest } from './domain.js';

export interface ICostEstimate {
    estimatedCostUsd: number;
    details?: Record<string, string | number | boolean>;
}

export interface INodeExecutionContext {
    dagId: string;
    dagRunId: string;
    taskRunId: string;
    nodeDefinition: IDagNodeDefinition;
    nodeManifest: INodeManifest;
    attempt: number;
    executionPath: string[];
    runCostLimitUsd?: number;
    currentTotalCostUsd: number;
}

export interface INodeExecutionResult {
    output: TPortPayload;
    estimatedCostUsd: number;
    totalCostUsd: number;
}

export interface INodeLifecycle {
    initialize(context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
    validateInput(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
    estimateCost(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<ICostEstimate, IDagError>>;
    execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>>;
    validateOutput(output: TPortPayload, context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
    dispose(context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
}

export interface INodeLifecycleFactory {
    create(nodeType: string): TResult<INodeLifecycle, IDagError>;
}

export interface INodeManifestRegistry {
    getManifest(nodeType: string): INodeManifest | undefined;
    listManifests(): INodeManifest[];
}

export interface INodeTaskHandler {
    initialize?(context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
    validateInput?(
        input: TPortPayload,
        context: INodeExecutionContext
    ): Promise<TResult<void, IDagError>>;
    estimateCost?(
        input: TPortPayload,
        context: INodeExecutionContext
    ): Promise<TResult<ICostEstimate, IDagError>>;
    execute(
        input: TPortPayload,
        context: INodeExecutionContext
    ): Promise<TResult<TPortPayload, IDagError>>;
    validateOutput?(
        output: TPortPayload,
        context: INodeExecutionContext
    ): Promise<TResult<void, IDagError>>;
    dispose?(context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
}

export interface INodeTaskHandlerRegistry {
    getHandler(nodeType: string): INodeTaskHandler | undefined;
    listNodeTypes(): string[];
}

export interface IRunCostPolicyEvaluator {
    assertWithinBudget(
        currentTotalCostUsd: number,
        nextEstimatedCostUsd: number,
        runCostLimitUsd?: number
    ): TResult<number, IDagError>;
}
