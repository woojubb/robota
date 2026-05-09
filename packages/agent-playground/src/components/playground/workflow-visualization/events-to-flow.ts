import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { IConversationEvent } from '../../../lib/playground/robota-executor';

const NODE_WIDTH = 208;
const NODE_HEIGHT: Record<string, number> = {
  user_message: 80,
  assistant_response: 100,
  tool_call_start: 64,
  tool_call_complete: 64,
  tool_call_error: 64,
};
const DEFAULT_NODE_HEIGHT = 80;
const DAGRE_RANKSEP = 50;
const DAGRE_NODESEP = 30;

function nodeHeight(type: string): number {
  return NODE_HEIGHT[type] ?? DEFAULT_NODE_HEIGHT;
}

export interface IFlowNodeData {
  content: string;
  toolName: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  [key: string]: unknown;
}

export function eventsToFlow(events: IConversationEvent[]): { nodes: Node[]; edges: Edge[] } {
  if (events.length === 0) return { nodes: [], edges: [] };

  const nodes: Node[] = events.map((event) => ({
    id: event.id,
    type: event.type,
    position: { x: 0, y: 0 },
    data: {
      content: event.content ?? '',
      toolName: event.toolName ?? '',
      timestamp: event.timestamp,
      metadata: event.metadata ?? {},
    } satisfies IFlowNodeData,
  }));

  const edges: Edge[] = events.slice(1).map((event, i) => ({
    id: `edge-${events[i].id}-${event.id}`,
    source: events[i].id,
    target: event.id,
    animated: false,
  }));

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', ranksep: DAGRE_RANKSEP, nodesep: DAGRE_NODESEP });

  events.forEach((event) => {
    graph.setNode(event.id, { width: NODE_WIDTH, height: nodeHeight(event.type) });
  });
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));

  dagre.layout(graph);

  const layoutedNodes = nodes.map((node) => {
    const { x, y } = graph.node(node.id);
    const h = nodeHeight(events.find((e) => e.id === node.id)?.type ?? '');
    return { ...node, position: { x: x - NODE_WIDTH / 2, y: y - h / 2 } };
  });

  return { nodes: layoutedNodes, edges };
}
