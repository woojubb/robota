import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { IConversationEvent } from '../../../lib/playground/robota-executor';

const NODE_WIDTH = 220;
const NODE_HEIGHT: Record<string, number> = {
  user_message: 80,
  assistant_response: 100,
  tool_call_start: 64,
  tool_call_complete: 64,
  tool_call_error: 64,
  agent_job_created: 72,
  agent_job_completed: 100,
  agent_job_failed: 72,
};
const DEFAULT_NODE_HEIGHT = 80;
const DAGRE_RANKSEP = 60;
const DAGRE_NODESEP = 40;

function nodeHeight(type: string): number {
  return NODE_HEIGHT[type] ?? DEFAULT_NODE_HEIGHT;
}

export interface IFlowNodeData {
  content: string;
  toolName: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
  taskId?: string;
  [key: string]: unknown;
}

/** Returns true for event types that belong to a background agent job (have a taskId). */
function isAgentJobEvent(type: string): boolean {
  return (
    type === 'agent_job_created' || type === 'agent_job_completed' || type === 'agent_job_failed'
  );
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
      taskId: event.taskId,
    } satisfies IFlowNodeData,
  }));

  const edges: Edge[] = [];

  // Main-thread cursor
  let lastMainId: string | null = null;

  // Per-task branch tracking
  const taskLastId = new Map<string, string>();
  const taskDone = new Map<string, boolean>();
  const openBranches = new Set<string>();

  // The main-thread node that caused the fork (used to avoid a self-loop in convergence)
  let forkSourceId: string | null = null;

  for (const event of events) {
    if (!isAgentJobEvent(event.type) || !event.taskId) {
      // ── Main-thread event ──────────────────────────────────────────────

      // Converge only when ALL open branches have completed.
      const allDone =
        openBranches.size > 0 && [...openBranches].every((tid) => taskDone.get(tid) === true);

      if (allDone) {
        // Draw join edges from every completed branch endpoint to this event.
        for (const tid of openBranches) {
          const branchTail = taskLastId.get(tid);
          if (branchTail) {
            edges.push({
              id: `edge-join-${tid}-${event.id}`,
              source: branchTail,
              target: event.id,
              animated: false,
              style: { stroke: '#6366f1', strokeDasharray: '4 2' },
            });
          }
        }
        // Also pull in any main-thread events that occurred while branches were open.
        if (lastMainId && lastMainId !== forkSourceId) {
          edges.push({
            id: `edge-main-join-${lastMainId}-${event.id}`,
            source: lastMainId,
            target: event.id,
            animated: false,
            style: { stroke: '#6366f1', strokeDasharray: '4 2' },
          });
        }
        openBranches.clear();
        taskDone.clear();
        forkSourceId = null;
      } else if (lastMainId) {
        // Sequential edge — branches still open or no branches.
        edges.push({
          id: `edge-${lastMainId}-${event.id}`,
          source: lastMainId,
          target: event.id,
          animated: false,
        });
      }

      lastMainId = event.id;
    } else {
      // ── Branch event ────────────────────────────────────────────────────
      const { taskId } = event;

      if (event.type === 'agent_job_created') {
        // Fork from the last main-thread node.
        if (lastMainId) {
          edges.push({
            id: `edge-fork-${lastMainId}-${event.id}`,
            source: lastMainId,
            target: event.id,
            animated: true,
            style: { stroke: '#a78bfa' },
          });
          forkSourceId = lastMainId;
        }
        taskLastId.set(taskId, event.id);
        taskDone.set(taskId, false);
        openBranches.add(taskId);
      } else {
        // agent_job_completed or agent_job_failed
        const prevInBranch = taskLastId.get(taskId);
        if (prevInBranch) {
          edges.push({
            id: `edge-branch-${prevInBranch}-${event.id}`,
            source: prevInBranch,
            target: event.id,
            animated: false,
            style: { stroke: '#a78bfa' },
          });
        }
        taskLastId.set(taskId, event.id);
        taskDone.set(taskId, true); // Mark this branch as completed.
      }
    }
  }

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
