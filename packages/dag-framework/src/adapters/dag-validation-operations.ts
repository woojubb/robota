import type {
  IDagDefinition,
  IDagValidationPort,
  IDagValidationResult,
  INodeManifest,
} from '@robota-sdk/dag-core';

/** In-process definition validation, independent of HTTP. */
export class DagFrameworkValidationOperations implements IDagValidationPort {
  constructor(private readonly manifests: readonly INodeManifest[]) {}

  async validateDag(definition: IDagDefinition): Promise<IDagValidationResult> {
    const knownTypes = new Set(this.manifests.map((manifest) => manifest.nodeType));
    const nodeIds = new Set(definition.nodes.map((node) => node.nodeId));
    const errors: string[] = [];

    for (const node of definition.nodes) {
      if (!knownTypes.has(node.nodeType)) {
        errors.push(`Unknown node type "${node.nodeType}" for node "${node.nodeId}"`);
      }
    }
    for (const edge of definition.edges) {
      if (!nodeIds.has(edge.from)) {
        errors.push(`Edge references unknown source node "${edge.from}"`);
      }
      if (!nodeIds.has(edge.to)) {
        errors.push(`Edge references unknown target node "${edge.to}"`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
