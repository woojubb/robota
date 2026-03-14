import type { TPortPayload } from '../interfaces/ports.js';
import type { IDagError } from './error.js';
import type { TResult } from './result.js';
import type { IDagNode, INodeManifest } from './domain.js';

/** Estimated execution cost for a node, returned by cost estimation lifecycle phase. */
export interface ICostEstimate {
    estimatedCredits: number;
    details?: Record<string, string | number | boolean>;
}

/** Runtime context passed to every node lifecycle method during execution. */
export interface INodeExecutionContext {
    dagId: string;
    dagRunId: string;
    taskRunId: string;
    nodeDefinition: IDagNode;
    nodeManifest: INodeManifest;
    attempt: number;
    executionPath: string[];
    runCreditLimit?: number;
    currentTotalCredits: number;
}

/** Final output of a node execution including payload and cost accounting. */
export interface INodeExecutionResult {
    output: TPortPayload;
    estimatedCredits: number;
    totalCredits: number;
}

/** Full node lifecycle contract: initialize → validate input → estimate cost → execute → validate output → dispose. */
export interface INodeLifecycle {
    initialize(context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
    validateInput(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
    estimateCost(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<ICostEstimate, IDagError>>;
    execute(input: TPortPayload, context: INodeExecutionContext): Promise<TResult<TPortPayload, IDagError>>;
    validateOutput(output: TPortPayload, context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
    dispose(context: INodeExecutionContext): Promise<TResult<void, IDagError>>;
}

/** Factory that creates an {@link INodeLifecycle} instance for a given node type. */
export interface INodeLifecycleFactory {
    create(nodeType: string): TResult<INodeLifecycle, IDagError>;
}

/** Registry of available node manifests, queryable by node type. */
export interface INodeManifestRegistry {
    getManifest(nodeType: string): INodeManifest | undefined;
    listManifests(): INodeManifest[];
}

/** Handler providing optional lifecycle hooks and a required execute method for a node type. */
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

/** Registry of task handlers, keyed by node type. */
export interface INodeTaskHandlerRegistry {
    getHandler(nodeType: string): INodeTaskHandler | undefined;
    listNodeTypes(): string[];
}

/** Complete definition of a DAG node type including metadata, ports, config schema, and handler. */
export interface IDagNodeDefinition {
    nodeType: string;
    displayName: string;
    category: string;
    inputs: INodeManifest['inputs'];
    outputs: INodeManifest['outputs'];
    configSchemaDefinition: unknown;
    taskHandler: INodeTaskHandler;
}

/** Assembled collection of node manifests and their corresponding task handlers. */
export interface INodeDefinitionAssembly {
    manifests: INodeManifest[];
    handlersByType: Record<string, INodeTaskHandler>;
}

/** Evaluates whether a pending cost stays within the run's budget limit. */
export interface IRunCostPolicyEvaluator {
    assertWithinBudget(
        currentTotalCredits: number,
        nextEstimatedCredits: number,
        runCreditLimit?: number
    ): TResult<number, IDagError>;
}
