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

  // Build edges with fork-join logic for parallel agent jobs.
  // Main thread events (no taskId) connect sequentially.
  // agent_job_created events fork from the last main-thread event.
  // agent_job_completed/failed events continue from their matching created event.
  // The first main-thread event AFTER all forks joins from each last-job event.

  const edges: Edge[] = [];

  // Track the last event id for the main thread and for each task branch.
  let lastMainId: string | null = null;
  // taskId → last event id in that branch
  const taskLastId = new Map<string, string>();
  // When we hit a fork: remember which main id was the fork source
  let forkSourceId: string | null = null;
  // Track all open branches (tasks that have been created but not yet converged)
  const openBranches = new Set<string>();

  for (const event of events) {
    if (!isAgentJobEvent(event.type) || !event.taskId) {
      // Main thread event
      const taskId = event.taskId; // always undefined here but satisfies the guard
      void taskId;

      if (openBranches.size > 0 && lastMainId !== forkSourceId) {
        // We're back on main thread with open branches — skip, wait for convergence
      }

      // If there are open branches and this is the first main event after the fork,
      // converge: draw edges from all last-branch events to this event.
      if (openBranches.size > 0) {
        for (const tid of openBranches) {
          const branchLastId = taskLastId.get(tid);
          if (branchLastId) {
            edges.push({
              id: `edge-join-${tid}-${event.id}`,
              source: branchLastId,
              target: event.id,
              animated: false,
              style: { stroke: '#6366f1', strokeDasharray: '4 2' },
            });
          }
        }
        openBranches.clear();
        forkSourceId = null;
      } else if (lastMainId) {
        edges.push({
          id: `edge-${lastMainId}-${event.id}`,
          source: lastMainId,
          target: event.id,
          animated: false,
        });
      }

      lastMainId = event.id;
    } else {
      // Agent job event — belongs to a task branch
      const { taskId } = event;

      if (event.type === 'agent_job_created') {
        // Fork from the last main thread event
        const forkFrom = lastMainId;
        if (forkFrom) {
          edges.push({
            id: `edge-fork-${forkFrom}-${event.id}`,
            source: forkFrom,
            target: event.id,
            animated: true,
            style: { stroke: '#a78bfa' },
          });
          forkSourceId = forkFrom;
        }
        taskLastId.set(taskId, event.id);
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
