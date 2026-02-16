import type { TPortPayload } from '../interfaces/ports.js';
import type { IDagError } from '../types/error.js';
import type { TResult } from '../types/result.js';
import type {
    INodeExecutionContext,
    INodeExecutionResult,
    INodeLifecycleFactory,
    IRunCostPolicyEvaluator
} from '../types/node-lifecycle.js';
import { buildTaskExecutionError, buildValidationError } from '../utils/error-builders.js';

export class RunCostPolicyEvaluator implements IRunCostPolicyEvaluator {
    public assertWithinBudget(
        currentTotalCostUsd: number,
        nextEstimatedCostUsd: number,
        runCostLimitUsd?: number
    ): TResult<number, IDagError> {
        if (nextEstimatedCostUsd < 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NEGATIVE_ESTIMATED_COST',
                    'estimatedCostUsd must be zero or positive',
                    { nextEstimatedCostUsd }
                )
            };
        }

        const nextTotalCostUsd = currentTotalCostUsd + nextEstimatedCostUsd;
        if (typeof runCostLimitUsd === 'number' && nextTotalCostUsd > runCostLimitUsd) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_COST_LIMIT_EXCEEDED',
                    'Estimated run cost exceeds runCostLimitUsd',
                    { nextTotalCostUsd, runCostLimitUsd }
                )
            };
        }

        return {
            ok: true,
            value: nextTotalCostUsd
        };
    }
}

export interface IRunNodeInput {
    input: TPortPayload;
    context: INodeExecutionContext;
}

export class NodeLifecycleRunner {
    public constructor(
        private readonly lifecycleFactory: INodeLifecycleFactory,
        private readonly costPolicyEvaluator: IRunCostPolicyEvaluator
    ) {}

    public async runNode(input: IRunNodeInput): Promise<TResult<INodeExecutionResult, IDagError>> {
        const lifecycle = this.lifecycleFactory.create(input.context.nodeDefinition.nodeType);
        if (!lifecycle.ok) {
            return lifecycle;
        }

        const initialized = await lifecycle.value.initialize(input.context);
        if (!initialized.ok) {
            return initialized;
        }

        const validatedInput = await lifecycle.value.validateInput(input.input, input.context);
        if (!validatedInput.ok) {
            await lifecycle.value.dispose(input.context);
            return validatedInput;
        }

        const estimated = await lifecycle.value.estimateCost(input.input, input.context);
        if (!estimated.ok) {
            await lifecycle.value.dispose(input.context);
            return estimated;
        }

        const budgetCheck = this.costPolicyEvaluator.assertWithinBudget(
            input.context.currentTotalCostUsd,
            estimated.value.estimatedCostUsd,
            input.context.runCostLimitUsd
        );
        if (!budgetCheck.ok) {
            await lifecycle.value.dispose(input.context);
            return budgetCheck;
        }

        const executed = await lifecycle.value.execute(input.input, input.context);
        if (!executed.ok) {
            await lifecycle.value.dispose(input.context);
            return executed;
        }

        const validatedOutput = await lifecycle.value.validateOutput(executed.value, input.context);
        if (!validatedOutput.ok) {
            await lifecycle.value.dispose(input.context);
            return validatedOutput;
        }

        const disposed = await lifecycle.value.dispose(input.context);
        if (!disposed.ok) {
            return {
                ok: false,
                error: buildTaskExecutionError(
                    'DAG_TASK_EXECUTION_DISPOSE_FAILED',
                    'Node dispose step failed after execution',
                    false,
                    {
                        nodeType: input.context.nodeDefinition.nodeType,
                        taskRunId: input.context.taskRunId
                    }
                )
            };
        }

        return {
            ok: true,
            value: {
                output: executed.value,
                estimatedCostUsd: estimated.value.estimatedCostUsd,
                totalCostUsd: budgetCheck.value
            }
        };
    }
}

export class MissingNodeLifecycleFactory implements INodeLifecycleFactory {
    public create(nodeType: string): TResult<never, IDagError> {
        return {
            ok: false,
            error: buildValidationError(
                'DAG_VALIDATION_NODE_LIFECYCLE_NOT_REGISTERED',
                'Node lifecycle is not registered for nodeType',
                { nodeType }
            )
        };
    }
}
