import type { IDagDefinition, IDagEdgeDefinition, IDagNode } from '@robota-sdk/dag-core';
import { findOutputKey, toNodeIdBase } from './dag-chat-catalog.js';
import type {
  ICatalogEntry,
  IDagChatDraftResult,
  IDagChatDraftWarning,
  IDraftAccumulator,
  IDraftNodeInput,
  TDagChatDraftStatus,
} from './dag-chat-draft-types.js';

const CANVAS_X_START = 120;
const CANVAS_Y_START = 80;
const CANVAS_COLUMN_WIDTH = 500;
const CANVAS_ROW_HEIGHT = 180;

export function createDraftAccumulator(definition: IDagDefinition): IDraftAccumulator {
  return {
    usedNodeIds: new Set(definition.nodes.map((node) => node.nodeId)),
    nodes: [],
    edges: [],
    addedNodeIds: [],
  };
}

export function appendNode(accumulator: IDraftAccumulator, node: IDagNode): void {
  accumulator.nodes.push(node);
  accumulator.addedNodeIds.push(node.nodeId);
}

export function appendNodes(accumulator: IDraftAccumulator, nodes: IDagNode[]): void {
  for (const node of nodes) {
    appendNode(accumulator, node);
  }
}

export function appendEdge(accumulator: IDraftAccumulator, edge: IDagEdgeDefinition): void {
  accumulator.edges.push(edge);
}

export function createImageSourceNodes(input: {
  entry: ICatalogEntry;
  count: number;
  usedNodeIds: Set<string>;
}): IDagNode[] {
  const nodes: IDagNode[] = [];
  for (let index = 0; index < input.count; index += 1) {
    nodes.push(
      createDraftNode({
        entry: input.entry,
        nodeId: allocateNodeId(input.entry.nodeType, input.usedNodeIds),
        column: 0,
        row: index,
      }),
    );
  }
  return nodes;
}

export function createPromptSourceNode(input: {
  baseId: string;
  prompt: string;
  promptSource?: ICatalogEntry;
  usedNodeIds: Set<string>;
  column: number;
  row: number;
}): IDagNode | undefined {
  if (!input.promptSource || !findOutputKey(input.promptSource, 'text')) {
    return undefined;
  }
  return createDraftNode({
    entry: input.promptSource,
    nodeId: allocateNodeIdFromBase(input.baseId, input.usedNodeIds),
    column: input.column,
    row: input.row,
    config: { text: input.prompt },
  });
}

export function createDraftNode(input: IDraftNodeInput): IDagNode {
  return {
    nodeId: input.nodeId,
    nodeType: input.entry.nodeType,
    position: {
      x: CANVAS_X_START + input.column * CANVAS_COLUMN_WIDTH,
      y: CANVAS_Y_START + input.row * CANVAS_ROW_HEIGHT,
    },
    dependsOn: [],
    config: input.config ?? {},
  };
}

export function allocateNodeId(nodeType: string, usedNodeIds: Set<string>): string {
  return allocateNodeIdFromBase(toNodeIdBase(nodeType), usedNodeIds);
}

export function allocateNodeIdFromBase(base: string, usedNodeIds: Set<string>): string {
  let index = 1;
  let nodeId = `${base}_${index}`;
  while (usedNodeIds.has(nodeId)) {
    index += 1;
    nodeId = `${base}_${index}`;
  }
  usedNodeIds.add(nodeId);
  return nodeId;
}

export function createAppliedResult(input: {
  definition: IDagDefinition;
  prompt: string;
  accumulator: IDraftAccumulator;
}): IDagChatDraftResult {
  const nextEdges = [...input.definition.edges, ...input.accumulator.edges];
  const nextNodes = recomputeNodeDependencies(
    [...input.definition.nodes, ...input.accumulator.nodes].map(stripRuntimePorts),
    nextEdges,
  );
  return {
    status: 'applied',
    definition: {
      ...input.definition,
      nodes: nextNodes,
      edges: nextEdges,
    },
    message: {
      role: 'assistant',
      content: `Built a DAG draft from: ${input.prompt}`,
    },
    addedNodeIds: input.accumulator.addedNodeIds,
    warnings: [],
  };
}

export function createUnchangedResult(input: {
  status: Exclude<TDagChatDraftStatus, 'applied'>;
  definition: IDagDefinition;
  message: string;
  warnings: IDagChatDraftWarning[];
}): IDagChatDraftResult {
  return {
    status: input.status,
    definition: input.definition,
    message: {
      role: 'assistant',
      content: input.message,
    },
    addedNodeIds: [],
    warnings: input.warnings,
  };
}

function recomputeNodeDependencies(nodes: IDagNode[], edges: IDagEdgeDefinition[]): IDagNode[] {
  const upstreamByTarget = new Map<string, Set<string>>();
  for (const edge of edges) {
    const current = upstreamByTarget.get(edge.to) ?? new Set<string>();
    current.add(edge.from);
    upstreamByTarget.set(edge.to, current);
  }
  return nodes.map((node) => ({
    ...node,
    dependsOn: [...(upstreamByTarget.get(node.nodeId) ?? new Set<string>())],
  }));
}

function stripRuntimePorts(node: IDagNode): IDagNode {
  const stripped: IDagNode = {
    nodeId: node.nodeId,
    nodeType: node.nodeType,
    dependsOn: node.dependsOn,
    config: node.config,
  };
  if (node.position) stripped.position = node.position;
  if (node.triggerPolicy) stripped.triggerPolicy = node.triggerPolicy;
  if (node.retryPolicy) stripped.retryPolicy = node.retryPolicy;
  if (typeof node.timeoutMs === 'number') stripped.timeoutMs = node.timeoutMs;
  if (node.costPolicy) stripped.costPolicy = node.costPolicy;
  return stripped;
}
