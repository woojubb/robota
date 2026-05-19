import { describe, it, expect } from 'vitest';
import { eventsToFlow } from '../events-to-flow';
import type { IConversationEvent } from '../../../../lib/playground/robota-executor';

function edge(source: string, target: string) {
  return expect.objectContaining({ source, target });
}

function hasEdge(edges: { source: string; target: string }[], src: string, tgt: string): boolean {
  return edges.some((e) => e.source === src && e.target === tgt);
}

function edgeCount(edges: { source: string; target: string }[], src: string, tgt: string): number {
  return edges.filter((e) => e.source === src && e.target === tgt).length;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function userMsg(id: string): IConversationEvent {
  return { id, type: 'user_message', timestamp: new Date(), content: 'test' };
}

function toolStart(id: string, toolName: string, toolCallId: string): IConversationEvent {
  return {
    id,
    type: 'tool_call_start',
    timestamp: new Date(),
    toolName,
    content: '',
    metadata: { toolCallId },
  };
}

function toolComplete(id: string, toolCallId: string): IConversationEvent {
  return {
    id,
    type: 'tool_call_complete',
    timestamp: new Date(),
    content: 'done',
    metadata: { toolCallId },
  };
}

function agentJobCreated(taskId: string, originToolCallId: string): IConversationEvent {
  return {
    id: `job-created-${taskId}`,
    type: 'agent_job_created',
    timestamp: new Date(),
    taskId,
    content: `task ${taskId}`,
    metadata: { originToolCallId, label: `task ${taskId}` },
  };
}

function agentJobCompleted(taskId: string): IConversationEvent {
  return {
    id: `job-completed-${taskId}`,
    type: 'agent_job_completed',
    timestamp: new Date(),
    taskId,
    content: 'done',
    metadata: { label: `task ${taskId}` },
  };
}

function agentJobFailed(taskId: string): IConversationEvent {
  return {
    id: `job-failed-${taskId}`,
    type: 'agent_job_failed',
    timestamp: new Date(),
    taskId,
    content: 'failed',
    metadata: { label: `task ${taskId}` },
  };
}

function assistantResponse(id: string): IConversationEvent {
  return {
    id,
    type: 'assistant_response',
    timestamp: new Date(),
    content: 'Here is my response.',
    metadata: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('eventsToFlow', () => {
  it('returns empty for no events', () => {
    const { nodes, edges } = eventsToFlow([]);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });

  it('creates sequential edges for linear flow', () => {
    const events = [
      userMsg('u1'),
      toolStart('tc1', 'search', 'call-1'),
      toolComplete('tcc1', 'call-1'),
      assistantResponse('ar1'),
    ];
    const { nodes, edges } = eventsToFlow(events);

    expect(nodes).toHaveLength(4);
    expect(hasEdge(edges, 'u1', 'tc1')).toBe(true);
    expect(hasEdge(edges, 'tc1', 'tcc1')).toBe(true);
    expect(hasEdge(edges, 'tcc1', 'ar1')).toBe(true);
  });

  describe('parallel tool calls (no agents)', () => {
    it('forks from the same source and converges at the next main event', () => {
      const events = [
        userMsg('u1'),
        toolStart('tc1', 'search', 'call-1'),
        toolStart('tc2', 'search', 'call-2'),
        toolComplete('tcc1', 'call-1'),
        toolComplete('tcc2', 'call-2'),
        assistantResponse('ar1'),
      ];
      const { edges } = eventsToFlow(events);

      // Both tools fork from user message
      expect(hasEdge(edges, 'u1', 'tc1')).toBe(true);
      expect(hasEdge(edges, 'u1', 'tc2')).toBe(true);

      // Each tool maps to its completion
      expect(hasEdge(edges, 'tc1', 'tcc1')).toBe(true);
      expect(hasEdge(edges, 'tc2', 'tcc2')).toBe(true);

      // Both tails converge to assistant
      expect(hasEdge(edges, 'tcc1', 'ar1')).toBe(true);
      expect(hasEdge(edges, 'tcc2', 'ar1')).toBe(true);
    });
  });

  describe('single agent branch (one tool → one agent)', () => {
    it('forks agent from tool_call_start and joins at assistant_response', () => {
      const events = [
        userMsg('u1'),
        toolStart('tc1', 'robota_command_agent', 'call-1'),
        agentJobCreated('T1', 'call-1'),
        agentJobCompleted('T1'),
        toolComplete('tcc1', 'call-1'),
        assistantResponse('ar1'),
      ];
      const { edges } = eventsToFlow(events);

      expect(hasEdge(edges, 'u1', 'tc1')).toBe(true);
      expect(hasEdge(edges, 'tc1', 'job-created-T1')).toBe(true);
      expect(hasEdge(edges, 'job-created-T1', 'job-completed-T1')).toBe(true);
      expect(hasEdge(edges, 'job-completed-T1', 'ar1')).toBe(true);
    });
  });

  describe('parallel agents: one completes, one fails', () => {
    // This is the primary regression scenario.
    // Event order (from playground-session-submit.ts):
    //   tool_call_start × 2 → agent_job_created × 2 →
    //   agent_job_completed / agent_job_failed →
    //   tool_call_complete × 2 → assistant_response

    function makeParallelAgentEvents(options: { devFirst?: boolean } = {}) {
      return [
        userMsg('u1'),
        toolStart('tc1', 'robota_command_agent', 'call-1'),
        toolStart('tc2', 'robota_command_agent', 'call-2'),
        agentJobCreated('T1', 'call-1'),
        agentJobCreated('T2', 'call-2'),
        ...(options.devFirst
          ? [agentJobCompleted('T1'), agentJobFailed('T2')]
          : [agentJobFailed('T2'), agentJobCompleted('T1')]),
        toolComplete('tcc1', 'call-1'),
        toolComplete('tcc2', 'call-2'),
        assistantResponse('ar1'),
      ];
    }

    it('forks both agents from their respective tool_call_start nodes', () => {
      const { edges } = eventsToFlow(makeParallelAgentEvents({ devFirst: true }));

      expect(hasEdge(edges, 'tc1', 'job-created-T1')).toBe(true);
      expect(hasEdge(edges, 'tc2', 'job-created-T2')).toBe(true);
    });

    it('connects agent_job_completed and agent_job_failed to their created nodes', () => {
      const { edges } = eventsToFlow(makeParallelAgentEvents({ devFirst: true }));

      expect(hasEdge(edges, 'job-created-T1', 'job-completed-T1')).toBe(true);
      expect(hasEdge(edges, 'job-created-T2', 'job-failed-T2')).toBe(true);
    });

    it('converges both branches to the assistant_response node', () => {
      const { edges } = eventsToFlow(makeParallelAgentEvents({ devFirst: true }));

      expect(hasEdge(edges, 'job-completed-T1', 'ar1')).toBe(true);
      expect(hasEdge(edges, 'job-failed-T2', 'ar1')).toBe(true);
    });

    it('converges tool_call_complete tails to the assistant_response node', () => {
      const { edges } = eventsToFlow(makeParallelAgentEvents({ devFirst: true }));

      expect(hasEdge(edges, 'tcc1', 'ar1')).toBe(true);
      expect(hasEdge(edges, 'tcc2', 'ar1')).toBe(true);
    });

    it('produces no duplicate edges to assistant_response', () => {
      const { edges } = eventsToFlow(makeParallelAgentEvents({ devFirst: true }));

      // The main-join check must not add a duplicate tcc2→ar1 edge
      expect(edgeCount(edges, 'tcc2', 'ar1')).toBe(1);
      expect(edgeCount(edges, 'tcc1', 'ar1')).toBe(1);
    });

    it('works the same way when designer fails before developer completes', () => {
      const { edges } = eventsToFlow(makeParallelAgentEvents({ devFirst: false }));

      expect(hasEdge(edges, 'job-completed-T1', 'ar1')).toBe(true);
      expect(hasEdge(edges, 'job-failed-T2', 'ar1')).toBe(true);
      expect(hasEdge(edges, 'tcc1', 'ar1')).toBe(true);
      expect(hasEdge(edges, 'tcc2', 'ar1')).toBe(true);
      expect(edgeCount(edges, 'tcc2', 'ar1')).toBe(1);
    });

    it('includes all expected nodes', () => {
      const { nodes } = eventsToFlow(makeParallelAgentEvents());
      const nodeIds = nodes.map((n) => n.id);

      expect(nodeIds).toContain('u1');
      expect(nodeIds).toContain('tc1');
      expect(nodeIds).toContain('tc2');
      expect(nodeIds).toContain('job-created-T1');
      expect(nodeIds).toContain('job-created-T2');
      expect(nodeIds).toContain('job-completed-T1');
      expect(nodeIds).toContain('job-failed-T2');
      expect(nodeIds).toContain('tcc1');
      expect(nodeIds).toContain('tcc2');
      expect(nodeIds).toContain('ar1');
    });
  });
});
