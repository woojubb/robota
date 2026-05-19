import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { IConversationEvent } from '../../../lib/playground/robota-executor';

const NODE_WIDTH = 220;
const NODE_HEIGHT: Record<string, number> = {
  user_message: 80,
  assistant_response: 100,
  tool_call_start: 100,
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

  // ── Main-thread cursor ──────────────────────────────────────────────────
  let lastMainId: string | null = null;

  // ── Agent-branch tracking ───────────────────────────────────────────────
  const taskLastId = new Map<string, string>();
  const taskDone = new Map<string, boolean>();
  const openBranches = new Set<string>();
  let agentForkSourceId: string | null = null;

  // ── Parallel tool-call tracking ─────────────────────────────────────────
  // Open tool_call_start nodeIds, in arrival order. FIFO-matched with completes.
  const openToolStarts: string[] = [];
  // toolCallId → tool_call_start nodeId (for ID-based matching when IDs are reliable)
  const toolStartById = new Map<string, string>();
  // Source node before the current parallel group forked
  let parallelGroupForkId: string | null = null;
  // Whether the current group has more than 1 tool (i.e., truly parallel)
  let parallelGroupSize = 0;
  // tool_call_complete nodeIds for the current parallel group (converge later)
  const parallelTails = new Set<string>();

  // FIFO queue of agent-spawning tool_call_start nodeIds, for matching agent_job_created
  const agentToolStartQueue: string[] = [];

  for (const event of events) {
    // ── tool_call_start ───────────────────────────────────────────────────
    if (event.type === 'tool_call_start') {
      const toolCallId = (event.metadata?.toolCallId as string) ?? event.id;

      if (openToolStarts.length === 0) {
        // First tool in a new group — sequential from lastMainId
        parallelGroupForkId = lastMainId;
        parallelGroupSize = 0;
        if (lastMainId) {
          edges.push({
            id: `edge-${lastMainId}-${event.id}`,
            source: lastMainId,
            target: event.id,
            animated: false,
          });
        }
        lastMainId = event.id;
      } else {
        // Parallel sibling — fork from same source as the first tool
        parallelGroupSize += 1;
        if (parallelGroupForkId) {
          edges.push({
            id: `edge-pf-${parallelGroupForkId}-${event.id}`,
            source: parallelGroupForkId,
            target: event.id,
            animated: false,
            style: { stroke: '#a78bfa' },
          });
        }
        // Keep lastMainId pointing to the first tool so agent_job_created forks from it
      }

      openToolStarts.push(event.id);
      toolStartById.set(toolCallId, event.id);

      if (event.toolName === 'robota_command_agent') {
        agentToolStartQueue.push(event.id);
      }

      continue;
    }

    // ── tool_call_complete ────────────────────────────────────────────────
    if (event.type === 'tool_call_complete') {
      const toolCallId = (event.metadata?.toolCallId as string) ?? '';
      let startNodeId: string | undefined;

      // Try ID-based match first
      if (toolCallId && toolStartById.has(toolCallId)) {
        startNodeId = toolStartById.get(toolCallId)!;
        toolStartById.delete(toolCallId);
        const idx = openToolStarts.indexOf(startNodeId);
        if (idx !== -1) openToolStarts.splice(idx, 1);
      } else if (openToolStarts.length > 0) {
        // Fallback: FIFO order
        startNodeId = openToolStarts.shift()!;
        for (const [k, v] of toolStartById) {
          if (v === startNodeId) {
            toolStartById.delete(k);
            break;
          }
        }
      }

      if (startNodeId) {
        edges.push({
          id: `edge-tc-${startNodeId}-${event.id}`,
          source: startNodeId,
          target: event.id,
          animated: false,
        });

        if (parallelGroupSize > 0) {
          // Part of a truly parallel group — collect tails for later convergence
          parallelTails.add(event.id);
        } else {
          // Single (sequential) tool call — clean state
          parallelGroupForkId = null;
        }
        lastMainId = event.id;
      } else {
        // No matching start — sequential fallback
        if (lastMainId) {
          edges.push({
            id: `edge-${lastMainId}-${event.id}`,
            source: lastMainId,
            target: event.id,
          });
        }
        lastMainId = event.id;
      }

      // If all parallel tools have completed, convergence will happen at the next main event
      continue;
    }

    // ── agent_job_* (branch events) ────────────────────────────────────────
    if (isAgentJobEvent(event.type) && event.taskId) {
      const { taskId } = event;

      if (event.type === 'agent_job_created') {
        // Use explicit originToolCallId when available, fall back to FIFO queue
        const originToolCallId = event.metadata?.originToolCallId as string | undefined;
        const agentToolStart = originToolCallId
          ? toolStartById.get(originToolCallId)
          : agentToolStartQueue.shift();
        const forkFrom = agentToolStart ?? lastMainId;

        if (forkFrom) {
          edges.push({
            id: `edge-fork-${forkFrom}-${event.id}`,
            source: forkFrom,
            target: event.id,
            animated: true,
            style: { stroke: '#a78bfa' },
          });
          agentForkSourceId = forkFrom;
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
        taskDone.set(taskId, true);
      }

      continue;
    }

    // ── Main-thread events (user_message, assistant_response, etc.) ────────

    const allBranchesDone =
      openBranches.size > 0 && [...openBranches].every((tid) => taskDone.get(tid) === true);

    // Parallel group is done when all starts have been matched to completes
    const parallelGroupDone = parallelTails.size > 0 && openToolStarts.length === 0;

    const shouldConverge = allBranchesDone || (parallelGroupDone && openBranches.size === 0);

    if (shouldConverge) {
      // Snapshot tails before clearing so the main-join check below can test membership.
      const parallelTailsSnapshot = new Set(parallelTails);

      // Converge parallel tool tails (if any)
      if (parallelGroupDone) {
        for (const tail of parallelTails) {
          edges.push({
            id: `edge-pconv-${tail}-${event.id}`,
            source: tail,
            target: event.id,
            animated: false,
            style: { stroke: '#6366f1', strokeDasharray: '4 2' },
          });
        }
        parallelTails.clear();
        parallelGroupForkId = null;
        parallelGroupSize = 0;
      }

      // Converge agent branches
      if (allBranchesDone) {
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
        // Pull in the main-thread node that was active while branches were open,
        // but skip it if it was already converged as a parallel tool tail above.
        if (
          lastMainId &&
          lastMainId !== agentForkSourceId &&
          !parallelTailsSnapshot.has(lastMainId)
        ) {
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
        agentForkSourceId = null;
      }
    } else if (parallelGroupDone) {
      // Parallel tools done but agent branches still open → converge tool tails now
      for (const tail of parallelTails) {
        edges.push({
          id: `edge-pconv-${tail}-${event.id}`,
          source: tail,
          target: event.id,
          animated: false,
          style: { stroke: '#6366f1', strokeDasharray: '4 2' },
        });
      }
      parallelTails.clear();
      parallelGroupForkId = null;
      parallelGroupSize = 0;
    } else if (lastMainId) {
      // Plain sequential edge
      edges.push({
        id: `edge-${lastMainId}-${event.id}`,
        source: lastMainId,
        target: event.id,
        animated: false,
      });
    }

    lastMainId = event.id;
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
