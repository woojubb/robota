import {
    MissingNodeLifecycleFactory,
    NodeLifecycleRunner,
    RunCostPolicyEvaluator
} from './node-lifecycle-runner.js';
import type {
    ITaskExecutionInput,
    ITaskExecutorPort,
    TTaskExecutionResult
} from '../interfaces/ports.js';
import type { INodeLifecycleFactory, INodeManifestRegistry } from '../types/node-lifecycle.js';
import { buildValidationError } from '../utils/error-builders.js';

export class LifecycleTaskExecutorPort implements ITaskExecutorPort {
    private readonly lifecycleFactory: INodeLifecycleFactory;
    private readonly runner: NodeLifecycleRunner;

    public constructor(
        private readonly nodeManifestRegistry: INodeManifestRegistry,
        lifecycleFactory?: INodeLifecycleFactory
    ) {
        this.lifecycleFactory = lifecycleFactory ?? new MissingNodeLifecycleFactory();
        this.runner = new NodeLifecycleRunner(this.lifecycleFactory, new RunCostPolicyEvaluator());
    }

    public async execute(input: ITaskExecutionInput): Promise<TTaskExecutionResult> {
        if (!input.nodeDefinition) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_DEFINITION_MISSING',
                    'Task execution requires nodeDefinition in execution input',
                    { nodeId: input.nodeId }
                )
            };
        }

        const nodeManifest = this.nodeManifestRegistry.getManifest(input.nodeDefinition.nodeType);
        if (!nodeManifest) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NODE_MANIFEST_NOT_FOUND',
                    'Node manifest is not registered for nodeType',
                    { nodeType: input.nodeDefinition.nodeType }
                )
            };
        }

        const executed = await this.runner.runNode({
            input: input.input,
            context: {
                dagId: input.dagId,
                dagRunId: input.dagRunId,
                taskRunId: input.taskRunId,
                nodeDefinition: input.nodeDefinition,
                nodeManifest,
                attempt: input.attempt,
                executionPath: input.executionPath,
                runCostLimitUsd: input.costPolicy?.runCostLimitUsd,
                currentTotalCostUsd: input.currentTotalCostUsd ?? 0
            }
        });

        if (!executed.ok) {
            return executed;
        }

        return {
            ok: true,
            output: executed.value.output,
            estimatedCostUsd: executed.value.estimatedCostUsd,
            totalCostUsd: executed.value.totalCostUsd
        };
    }
}
