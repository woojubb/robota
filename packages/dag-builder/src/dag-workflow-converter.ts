// Bidirectional converter between IDagDefinition (internal) and IDagWorkflowFile (.dag.json format).
//
// Node type naming convention:
//   internal kebab-case: "llm-text-anthropic"
//   workflow PascalCase: "RobotaLlmTextAnthropic"  (prefix "Robota" + each segment capitalized)

import type {
  IDagDefinition,
  IDagEdgeDefinition,
  IDagNode,
  IEdgeBinding,
  INodeConfigObject,
  TDagDefinitionStatus,
} from '@robota-sdk/dag-core';
import type {
  IDagRobotaCompanion,
  IDagRobotaCompanionNodeMeta,
  IDagWorkflowFile,
  IDagWorkflowNode,
  IDagWorkflowNodeInput,
  IDagWorkflowNodeOutput,
  TWorkflowLink,
} from '@robota-sdk/dag-core';

const WORKFLOW_VERSION = 0.4;
const ROBOTA_PREFIX = 'Robota';
const ROBOTA_CONFIG_PROPERTY = 'robota_config';

// ---------------------------------------------------------------------------
// Node type name mapping
// ---------------------------------------------------------------------------

/** Converts internal kebab-case nodeType to workflow PascalCase type (e.g. "llm-text-anthropic" → "RobotaLlmTextAnthropic"). */
export function toWorkflowNodeType(nodeType: string): string {
  const pascal = nodeType
    .split('-')
    .map((seg) => (seg.length > 0 ? seg[0]!.toUpperCase() + seg.slice(1) : ''))
    .join('');
  return `${ROBOTA_PREFIX}${pascal}`;
}

/** Converts workflow PascalCase type back to internal kebab-case (e.g. "RobotaLlmTextAnthropic" → "llm-text-anthropic"). */
export function fromWorkflowNodeType(workflowType: string): string {
  const withoutPrefix = workflowType.startsWith(ROBOTA_PREFIX)
    ? workflowType.slice(ROBOTA_PREFIX.length)
    : workflowType;
  return withoutPrefix
    .replace(/([A-Z])/g, (_, ch: string) => `-${ch.toLowerCase()}`)
    .replace(/^-/, '');
}

// ---------------------------------------------------------------------------
// IDagDefinition → IDagWorkflowFile + IDagRobotaCompanion
// ---------------------------------------------------------------------------

export interface IToWorkflowFileResult {
  readonly workflowFile: IDagWorkflowFile;
  readonly companion: IDagRobotaCompanion;
}

/** Converts an `IDagDefinition` to the `.dag.json` + `.dag.robota.json` pair. */
export function toDagWorkflowFile(definition: IDagDefinition): IToWorkflowFileResult {
  // Assign stable numeric IDs (1-based) in node-array order.
  const nodeToNumId = new Map<string, number>();
  definition.nodes.forEach((node, idx) => {
    nodeToNumId.set(node.nodeId, idx + 1);
  });

  // Build node → port name → slot-index maps for outputs and inputs.
  // We derive slot indices from the order the bindings appear across all edges.
  // The index is the position of first appearance in the edge list (0-based per node).
  const outputSlots = new Map<string, Map<string, number>>(); // nodeId → portKey → slotIdx
  const inputSlots = new Map<string, Map<string, number>>(); // nodeId → portKey → slotIdx

  for (const edge of definition.edges) {
    for (const binding of edge.bindings ?? []) {
      if (!outputSlots.has(edge.from)) outputSlots.set(edge.from, new Map());
      const srcMap = outputSlots.get(edge.from)!;
      if (!srcMap.has(binding.outputKey)) srcMap.set(binding.outputKey, srcMap.size);

      if (!inputSlots.has(edge.to)) inputSlots.set(edge.to, new Map());
      const tgtMap = inputSlots.get(edge.to)!;
      if (!tgtMap.has(binding.inputKey)) tgtMap.set(binding.inputKey, tgtMap.size);
    }
  }

  // Build per-node input/output slot arrays and link tuples.
  const links: TWorkflowLink[] = [];
  let nextLinkId = 1;

  // nodeNumId → slot arrays (filled while processing edges)
  const nodeInputSlotsMap = new Map<number, IDagWorkflowNodeInput[]>();
  const nodeOutputSlotsMap = new Map<number, IDagWorkflowNodeOutput[]>();

  for (const node of definition.nodes) {
    const numId = nodeToNumId.get(node.nodeId)!;
    nodeInputSlotsMap.set(numId, []);
    nodeOutputSlotsMap.set(numId, []);
  }

  for (const edge of definition.edges) {
    const srcNumId = nodeToNumId.get(edge.from);
    const tgtNumId = nodeToNumId.get(edge.to);
    if (srcNumId === undefined || tgtNumId === undefined) continue;

    for (const binding of edge.bindings ?? []) {
      const linkId = nextLinkId++;
      const srcSlot = outputSlots.get(edge.from)?.get(binding.outputKey) ?? 0;
      const tgtSlot = inputSlots.get(edge.to)?.get(binding.inputKey) ?? 0;

      const portTypeStr = 'STRING'; // simplified — all ports are STRING-typed in workflow format

      links.push([linkId, srcNumId, srcSlot, tgtNumId, tgtSlot, portTypeStr]);

      // Register output slot on source node.
      const srcOutputs = nodeOutputSlotsMap.get(srcNumId)!;
      let srcOutputSlot = srcOutputs.find((o) => o.name === binding.outputKey);
      if (!srcOutputSlot) {
        srcOutputSlot = { name: binding.outputKey, type: portTypeStr, links: [] };
        srcOutputs.push(srcOutputSlot);
      }
      srcOutputSlot.links.push(linkId);

      // Register input slot on target node.
      const tgtInputs = nodeInputSlotsMap.get(tgtNumId)!;
      if (!tgtInputs.find((i) => i.name === binding.inputKey)) {
        tgtInputs.push({ name: binding.inputKey, type: portTypeStr, link: linkId });
      }
    }
  }

  // Build workflow nodes.
  const workflowNodes: IDagWorkflowNode[] = definition.nodes.map((node) => {
    const numId = nodeToNumId.get(node.nodeId)!;
    const inputs = nodeInputSlotsMap.get(numId)!;
    const outputs = nodeOutputSlotsMap.get(numId)!;

    const wfNode: IDagWorkflowNode = {
      id: numId,
      type: toWorkflowNodeType(node.nodeType),
      pos: [node.position?.x ?? 0, node.position?.y ?? 0],
      properties: {
        [ROBOTA_CONFIG_PROPERTY]: node.config,
      },
      widgets_values: Object.values(node.config),
    };

    if (inputs.length > 0) wfNode.inputs = inputs;
    if (outputs.length > 0) wfNode.outputs = outputs;

    return wfNode;
  });

  const workflowFile: IDagWorkflowFile = {
    last_node_id: definition.nodes.length,
    last_link_id: nextLinkId - 1,
    nodes: workflowNodes,
    links,
    version: WORKFLOW_VERSION,
  };

  // Build companion.
  const companionNodes: Record<string, IDagRobotaCompanionNodeMeta> = {};
  for (const node of definition.nodes) {
    const numId = nodeToNumId.get(node.nodeId)!;
    const meta: IDagRobotaCompanionNodeMeta = { nodeId: node.nodeId };
    if (node.retryPolicy) meta.retryPolicy = node.retryPolicy;
    if (node.timeoutMs !== undefined) meta.timeoutMs = node.timeoutMs;
    if (node.costPolicy) meta.costPolicy = node.costPolicy;
    companionNodes[String(numId)] = meta;
  }

  const companion: IDagRobotaCompanion = {
    dagId: definition.dagId,
    version: definition.version,
    status: definition.status,
    nodes: companionNodes,
  };
  if (definition.costPolicy) companion.costPolicy = definition.costPolicy;
  if (definition.inputSchema) companion.inputSchema = definition.inputSchema;
  if (definition.outputSchema) companion.outputSchema = definition.outputSchema;

  return { workflowFile, companion };
}

// ---------------------------------------------------------------------------
// IDagWorkflowFile → IDagDefinition
// ---------------------------------------------------------------------------

/** Converts a `.dag.json` workflow file (optionally with companion) back to `IDagDefinition`. */
export function fromDagWorkflowFile(
  workflowFile: IDagWorkflowFile,
  companion?: IDagRobotaCompanion,
): IDagDefinition {
  // Build linkId → link map for edge reconstruction.
  const linkMap = new Map<number, TWorkflowLink>();
  for (const link of workflowFile.links) {
    linkMap.set(link[0], link);
  }

  // Build numId → companion node meta.
  const companionNodes = companion?.nodes ?? {};

  // Reconstruct nodes.
  const nodes: IDagNode[] = workflowFile.nodes.map((wfNode) => {
    const meta = companionNodes[String(wfNode.id)];
    const nodeId = meta?.nodeId ?? `node-${wfNode.id}`;
    const nodeType = fromWorkflowNodeType(wfNode.type);

    // Recover config from properties.robota_config (authoritative) or fallback to widgets_values.
    const rawConfig =
      (wfNode.properties?.[ROBOTA_CONFIG_PROPERTY] as INodeConfigObject | undefined) ?? {};

    const node: IDagNode = {
      nodeId,
      nodeType,
      dependsOn: [], // filled below
      config: rawConfig,
      position:
        wfNode.pos[0] !== 0 || wfNode.pos[1] !== 0
          ? { x: wfNode.pos[0], y: wfNode.pos[1] }
          : undefined,
    };
    if (meta?.retryPolicy) node.retryPolicy = meta.retryPolicy;
    if (meta?.timeoutMs !== undefined) node.timeoutMs = meta.timeoutMs;
    if (meta?.costPolicy) node.costPolicy = meta.costPolicy;
    return node;
  });

  // Build numId → node for edge reconstruction.
  const numIdToNode = new Map<number, IDagNode>();
  workflowFile.nodes.forEach((wfNode, idx) => {
    numIdToNode.set(wfNode.id, nodes[idx]!);
  });

  // Reconstruct edges from links.
  // Group links by (srcNodeId, tgtNodeId) pair → IEdgeBinding[].
  const edgeMap = new Map<string, IEdgeBinding[]>(); // key: "srcNodeId:tgtNodeId"
  const dependsOnSets = new Map<string, Set<string>>(); // nodeId → Set<depNodeId>

  for (const link of workflowFile.links) {
    const [, srcNumId, , tgtNumId] = link;
    const srcNode = numIdToNode.get(srcNumId);
    const tgtNode = numIdToNode.get(tgtNumId);
    if (!srcNode || !tgtNode) continue;

    // Look up port names from the workflow node slot arrays.
    const srcWfNode = workflowFile.nodes.find((n) => n.id === srcNumId);
    const tgtWfNode = workflowFile.nodes.find((n) => n.id === tgtNumId);

    const srcSlotIdx = link[2];
    const tgtSlotIdx = link[4];
    const outputKey = srcWfNode?.outputs?.[srcSlotIdx]?.name ?? `out${srcSlotIdx}`;
    const inputKey = tgtWfNode?.inputs?.[tgtSlotIdx]?.name ?? `in${tgtSlotIdx}`;

    const edgeKey = `${srcNode.nodeId}:${tgtNode.nodeId}`;
    if (!edgeMap.has(edgeKey)) edgeMap.set(edgeKey, []);
    edgeMap.get(edgeKey)!.push({ outputKey, inputKey });

    // Track dependsOn.
    if (!dependsOnSets.has(tgtNode.nodeId)) dependsOnSets.set(tgtNode.nodeId, new Set());
    dependsOnSets.get(tgtNode.nodeId)!.add(srcNode.nodeId);
  }

  // Apply dependsOn.
  for (const node of nodes) {
    const deps = dependsOnSets.get(node.nodeId);
    if (deps) node.dependsOn = [...deps];
  }

  // Build edges array.
  const edges: IDagEdgeDefinition[] = [];
  for (const [key, bindings] of edgeMap) {
    const [from, to] = key.split(':') as [string, string];
    edges.push({ from, to, bindings });
  }

  return {
    dagId: companion?.dagId ?? 'unknown',
    version: companion?.version ?? 1,
    status: (companion?.status ?? 'active') as TDagDefinitionStatus,
    nodes,
    edges,
    ...(companion?.costPolicy ? { costPolicy: companion.costPolicy } : {}),
    ...(companion?.inputSchema ? { inputSchema: companion.inputSchema } : {}),
    ...(companion?.outputSchema ? { outputSchema: companion.outputSchema } : {}),
  };
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** Returns true if the parsed object looks like an IDagWorkflowFile (new format). */
export function isWorkflowFileFormat(parsed: unknown): parsed is IDagWorkflowFile {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  return (
    Array.isArray(obj['nodes']) &&
    Array.isArray(obj['links']) &&
    typeof obj['version'] === 'number' &&
    !('dagId' in obj)
  );
}

/** Returns true if the parsed object looks like an IDagDefinition (legacy format). */
export function isLegacyDefinitionFormat(parsed: unknown): parsed is IDagDefinition {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  const obj = parsed as Record<string, unknown>;
  return typeof obj['dagId'] === 'string' && Array.isArray(obj['nodes']);
}
