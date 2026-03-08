import type { TPortPayload } from '../interfaces/ports.js';
import type { IDagError } from './error.js';
import type { TResult } from './result.js';
import type { IDagNode, INodeManifest } from './domain.js';
import { buildConfigSchema } from '../utils/node-descriptor.js';

export interface ICostEstimate {
    estimatedCostUsd: number;
    details?: Record<string, string | number | boolean>;
}

export interface INodeExecutionContext {
    dagId: string;
    dagRunId: string;
    taskRunId: string;
    nodeDefinition: IDagNode;
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

export interface IDagNodeDefinition {
    nodeType: string;
    displayName: string;
    category: string;
    inputs: INodeManifest['inputs'];
    outputs: INodeManifest['outputs'];
    configSchemaDefinition: unknown;
    taskHandler: INodeTaskHandler;
}

export interface INodeDefinitionAssembly {
    manifests: INodeManifest[];
    handlersByType: Record<string, INodeTaskHandler>;
}

export function buildNodeDefinitionAssembly(nodeDefinitions: IDagNodeDefinition[]): TResult<INodeDefinitionAssembly, IDagError> {
    const manifests: INodeManifest[] = [];
    const handlersByType: Record<string, INodeTaskHandler> = {};
    for (const nodeDefinition of nodeDefinitions) {
        const configSchemaResult = buildConfigSchema(nodeDefinition.configSchemaDefinition);
        if (!configSchemaResult.ok) {
            return configSchemaResult;
        }
        const manifest: INodeManifest = {
            nodeType: nodeDefinition.nodeType,
            displayName: nodeDefinition.displayName,
            category: nodeDefinition.category,
            inputs: nodeDefinition.inputs,
            outputs: nodeDefinition.outputs,
            configSchema: configSchemaResult.value
        };
        manifests.push(manifest);
        handlersByType[manifest.nodeType] = nodeDefinition.taskHandler;
    }
    return {
        ok: true,
        value: {
            manifests,
            handlersByType
        }
    };
}

export interface IRunCostPolicyEvaluator {
    assertWithinBudget(
        currentTotalCostUsd: number,
        nextEstimatedCostUsd: number,
        runCostLimitUsd?: number
    ): TResult<number, IDagError>;
}
