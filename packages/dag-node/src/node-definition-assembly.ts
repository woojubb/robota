import type { IDagNodeDefinition, INodeDefinitionAssembly, INodeManifest, TResult, IDagError } from '@robota-sdk/dag-core';
import { buildConfigSchema } from './utils/node-descriptor.js';

/**
 * Build manifests and handler registry from an array of node definitions.
 * @param nodeDefinitions - Node definitions to assemble
 * @returns Assembly of manifests and handlers, or an error if config schema validation fails
 */
export function buildNodeDefinitionAssembly(nodeDefinitions: IDagNodeDefinition[]): TResult<INodeDefinitionAssembly, IDagError> {
    const manifests: INodeManifest[] = [];
    const handlersByType: Record<string, IDagNodeDefinition['taskHandler']> = {};
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
