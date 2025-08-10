// Workflow shared in-memory state (domain-neutral)
// Stores minimal linkage hints computed from prior events to help handlers
// choose correct prev connections without relying on domain-specific IDs.

class WorkflowStateStore {
    // Map executionId (or parentExecutionId) → last aggregation nodeId
    private lastAggregationByExecution = new Map<string, string>();
    // Map executionId → last assistant_message_start nodeId
    private lastAssistantStartByExecution = new Map<string, string>();
    // Map executionId → last user_message nodeId
    private lastUserMessageByExecution = new Map<string, string>();
    // Map executionId → agent node id
    private agentNodeByExecution = new Map<string, string>();
    // Map rootExecutionId or conversationId → agent node id
    private agentNodeByRoot = new Map<string, string>();
    // Map toolCallId → { thinkingId: string, mainExecutionId: string }
    private toolCallContextById = new Map<string, { thinkingId?: string; mainExecutionId?: string }>();
    // Map mainExecutionId → tool call count (for response timing decisions)
    private toolCallCountByMainExecution = new Map<string, number>();

    setLastAggregation(executionId: string, aggregationNodeId: string): void {
        if (!executionId || !aggregationNodeId) return;
        this.lastAggregationByExecution.set(String(executionId), String(aggregationNodeId));
    }

    getLastAggregation(executionId?: string): string | undefined {
        if (!executionId) return undefined;
        return this.lastAggregationByExecution.get(String(executionId));
    }

    setLastAssistantStart(executionId: string, assistantStartNodeId: string): void {
        if (!executionId || !assistantStartNodeId) return;
        this.lastAssistantStartByExecution.set(String(executionId), String(assistantStartNodeId));
    }

    getLastAssistantStart(executionId?: string): string | undefined {
        if (!executionId) return undefined;
        return this.lastAssistantStartByExecution.get(String(executionId));
    }

    clear(): void {
        this.lastAggregationByExecution.clear();
        this.lastAssistantStartByExecution.clear();
        this.lastUserMessageByExecution.clear();
        this.agentNodeByExecution.clear();
        this.toolCallContextById.clear();
        this.agentNodeByRoot.clear();
        this.toolCallCountByMainExecution.clear();
    }

    setAgentForExecution(executionId: string, agentNodeId: string): void {
        if (!executionId || !agentNodeId) return;
        this.agentNodeByExecution.set(String(executionId), String(agentNodeId));
    }

    getAgentForExecution(executionId?: string): string | undefined {
        if (!executionId) return undefined;
        return this.agentNodeByExecution.get(String(executionId));
    }

    setAgentForRoot(rootId: string, agentNodeId: string): void {
        if (!rootId || !agentNodeId) return;
        this.agentNodeByRoot.set(String(rootId), String(agentNodeId));
    }

    getAgentForRoot(rootId?: string): string | undefined {
        if (!rootId) return undefined;
        return this.agentNodeByRoot.get(String(rootId));
    }

    setLastUserMessage(executionId: string, userMessageNodeId: string): void {
        if (!executionId || !userMessageNodeId) return;
        this.lastUserMessageByExecution.set(String(executionId), String(userMessageNodeId));
    }

    getLastUserMessage(executionId?: string): string | undefined {
        if (!executionId) return undefined;
        return this.lastUserMessageByExecution.get(String(executionId));
    }

    setToolCallContext(toolCallId: string, context: { thinkingId?: string; mainExecutionId?: string }): void {
        if (!toolCallId) return;
        const prev = this.toolCallContextById.get(String(toolCallId)) || {};
        this.toolCallContextById.set(String(toolCallId), { ...prev, ...context });
    }

    getToolCallContext(toolCallId?: string): { thinkingId?: string; mainExecutionId?: string } | undefined {
        if (!toolCallId) return undefined;
        return this.toolCallContextById.get(String(toolCallId));
    }

    incrementToolCallCount(mainExecutionId?: string): void {
        if (!mainExecutionId) return;
        const key = String(mainExecutionId);
        const current = this.toolCallCountByMainExecution.get(key) || 0;
        this.toolCallCountByMainExecution.set(key, current + 1);
    }

    getToolCallCount(mainExecutionId?: string): number {
        if (!mainExecutionId) return 0;
        return this.toolCallCountByMainExecution.get(String(mainExecutionId)) || 0;
    }
}

export const WorkflowState = new WorkflowStateStore();


