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

/** Default cost policy evaluator that checks if the next estimated credits stays within the run budget. */
export class RunCostPolicyEvaluator implements IRunCostPolicyEvaluator {
    public assertWithinBudget(
        currentTotalCredits: number,
        nextEstimatedCredits: number,
        runCreditLimit?: number
    ): TResult<number, IDagError> {
        if (nextEstimatedCredits < 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_NEGATIVE_ESTIMATED_CREDITS',
                    'estimatedCredits must be zero or positive',
                    { nextEstimatedCredits }
                )
            };
        }

        const nextTotalCredits = currentTotalCredits + nextEstimatedCredits;
        if (typeof runCreditLimit === 'number' && nextTotalCredits > runCreditLimit) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_CREDIT_LIMIT_EXCEEDED',
                    'Estimated run credits exceeds runCreditLimit',
                    { nextTotalCredits, runCreditLimit }
                )
            };
        }

        return {
            ok: true,
            value: nextTotalCredits
        };
    }
}

/** Input for running a single node through its full lifecycle. */
export interface IRunNodeInput {
    input: TPortPayload;
    context: INodeExecutionContext;
}

/**
 * Orchestrates a node through its full lifecycle: initialize → validate → estimate cost → budget check → execute → validate output → dispose.
 */
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
            input.context.currentTotalCredits,
            estimated.value.estimatedCredits,
            input.context.runCreditLimit
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
                estimatedCredits: estimated.value.estimatedCredits,
                totalCredits: budgetCheck.value
            }
        };
    }
}

/** Sentinel factory that always returns an error — used when no lifecycle factory is configured. */
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
