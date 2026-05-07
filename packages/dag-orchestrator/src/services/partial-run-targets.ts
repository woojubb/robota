import type { IDagDefinition, IDagError, IPartialRunRequest, TResult } from '@robota-sdk/dag-core';
import { buildValidationError } from '@robota-sdk/dag-core';

export function resolvePartialExecutionTargets(
  definition: IDagDefinition,
  partialRun: IPartialRunRequest,
): TResult<string[], IDagError> {
  const startNodeId = partialRun.startNodeId.trim();
  if (!definition.nodes.some((node) => node.nodeId === startNodeId)) {
    return {
      ok: false,
      error: buildValidationError(
        'ORCHESTRATOR_PARTIAL_RUN_START_NODE_NOT_FOUND',
        'Partial run start node was not found in definition',
        { dagId: definition.dagId, startNodeId },
      ),
    };
  }

  const affectedNodeIds = collectNodeAndDownstreamIds(definition, startNodeId);
  return {
    ok: true,
    value: definition.nodes
      .filter((node) => affectedNodeIds.has(node.nodeId))
      .map((node) => node.nodeId),
  };
}

function collectNodeAndDownstreamIds(definition: IDagDefinition, nodeId: string): Set<string> {
  const affectedNodeIds = new Set<string>([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of definition.nodes) {
      if (affectedNodeIds.has(node.nodeId)) {
        continue;
      }
      const dependsOnAffectedNode = node.dependsOn.some((dependencyId) =>
        affectedNodeIds.has(dependencyId),
      );
      const hasIncomingAffectedEdge = definition.edges.some(
        (edge) => edge.to === node.nodeId && affectedNodeIds.has(edge.from),
      );
      if (dependsOnAffectedNode || hasIncomingAffectedEdge) {
        affectedNodeIds.add(node.nodeId);
        changed = true;
      }
    }
  }
  return affectedNodeIds;
}
