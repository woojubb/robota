import type { TPrompt, TObjectInfo, TResult, IDagError } from '@robota-sdk/dag-core';
import type { ICostEstimatorPort } from '../interfaces/orchestrator-policy-port.js';
import type { ICostEstimate } from '../types/orchestrator-types.js';
import { type ICostMetaStoragePort, CelCostEvaluator } from '@robota-sdk/dag-cost';

/**
 * Adapter that bridges ICostEstimatorPort with dag-cost's CelCostEvaluator.
 *
 * For each node in the prompt, looks up cost metadata from storage and
 * evaluates the CEL estimate formula with node inputs as context variables.
 */
export class CelCostEstimatorAdapter implements ICostEstimatorPort {
    private readonly evaluator = new CelCostEvaluator();

    constructor(private readonly storage: ICostMetaStoragePort) {}

    async estimateCost(
        prompt: TPrompt,
        _objectInfo: TObjectInfo,
    ): Promise<TResult<ICostEstimate, IDagError>> {
        let totalEstimatedCredits = 0;
        const perNode: ICostEstimate['perNode'] = {};

        for (const [nodeId, nodeDef] of Object.entries(prompt)) {
            const costMeta = await this.storage.get(nodeDef.class_type);

            if (!costMeta || !costMeta.enabled) {
                perNode[nodeId] = { nodeType: nodeDef.class_type, estimatedCredits: 0 };
                continue;
            }

            const context: Record<string, unknown> = {
                ...costMeta.variables,
                ...nodeDef.inputs,
            };

            const evalResult = this.evaluator.evaluate(costMeta.estimateFormula, context);
            if (!evalResult.ok) {
                return evalResult as TResult<never, IDagError>;
            }

            perNode[nodeId] = { nodeType: nodeDef.class_type, estimatedCredits: evalResult.value };
            totalEstimatedCredits += evalResult.value;
        }

        return { ok: true, value: { totalEstimatedCredits, perNode } };
    }
}
