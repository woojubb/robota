import type {
    IDagDefinition,
    IPromptRequest,
    TPrompt,
    TPromptInputValue,
    TResult,
    IDagError,
    TPortPayload,
    IDagEdgeDefinition,
} from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';

/**
 * Translates an IDagDefinition into a ComfyUI-compatible IPromptRequest.
 *
 * Mapping:
 * - node.nodeId  → prompt key
 * - node.nodeType → class_type
 * - edges (from/to with bindings) → TPromptLink [sourceNodeId, outputSlotIndex]
 * - node.config + input → inputs record
 */
export function translateDefinitionToPrompt(
    definition: IDagDefinition,
    input: TPortPayload
): TResult<IPromptRequest, IDagError> {
    if (definition.nodes.length === 0) {
        return {
            ok: false,
            error: buildValidationError(
                'ORCHESTRATOR_EMPTY_DEFINITION',
                'Definition has no nodes to translate',
                { dagId: definition.dagId }
            ),
        };
    }

    const outputSlotTracker = new Map<string, number>();
    const prompt: TPrompt = {};

    for (const node of definition.nodes) {
        const inputs: Record<string, TPromptInputValue> = {};

        for (const [key, value] of Object.entries(node.config)) {
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                inputs[key] = value;
            } else if (typeof value === 'object' && value !== null) {
                // ComfyUI accepts arbitrary JSON values in inputs (e.g., asset references).
                // Cast at translator boundary since TPromptInputValue only covers primitives + links.
                inputs[key] = value as TPromptInputValue;
            }
        }

        const incomingEdges = definition.edges.filter((edge) => edge.to === node.nodeId);
        for (const edge of incomingEdges) {
            const bindings = edge.bindings ?? [{ outputKey: 'output', inputKey: 'input' }];
            for (const binding of bindings) {
                const slotKey = `${edge.from}:${binding.outputKey}`;
                let slotIndex = outputSlotTracker.get(slotKey);
                if (typeof slotIndex !== 'number') {
                    const currentCount = countSlotsForNode(outputSlotTracker, edge.from);
                    slotIndex = currentCount;
                    outputSlotTracker.set(slotKey, slotIndex);
                }
                inputs[binding.inputKey] = [edge.from, slotIndex];
            }
        }

        if (node.nodeType === 'input') {
            for (const [key, value] of Object.entries(input)) {
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                    inputs[key] = value;
                }
            }
        }

        prompt[node.nodeId] = {
            class_type: node.nodeType,
            inputs,
            _meta: { title: node.nodeId },
        };
    }

    return {
        ok: true,
        value: {
            prompt,
        },
    };
}

function countSlotsForNode(tracker: Map<string, number>, nodeId: string): number {
    let count = 0;
    for (const key of tracker.keys()) {
        if (key.startsWith(`${nodeId}:`)) {
            count += 1;
        }
    }
    return count;
}
