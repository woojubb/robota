// Workflow shared in-memory state (domain-neutral, path-only compliant)
// Minimal state for join barriers and basic execution tracking only

class WorkflowStateStore {
    // Map executionId (or parentExecutionId) → last aggregation nodeId
    private lastAggregationByExecution = new Map<string, string>();
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
    // Map thinkingNodeId -> Set of tool_response node ids collected for that thinking (legacy)
    private toolResponsesByThinking = new Map<string, Set<string>>();
    // === Path-Only join barrier (essential) ===
    // groupPath (thinking scope path) → expected branch paths
    private expectedBranchesByGroupPath = new Map<string, Set<string>>();
    // groupPath (thinking scope path) → collected branch paths
    private collectedBranchesByGroupPath = new Map<string, Set<string>>();
    // groupPath (thinking scope path) → collected tool_response node ids (ordered by arrival)
    private toolResponseIdsByGroupPath = new Map<string, string[]>();

    setLastAggregation(executionId: string, aggregationNodeId: string): void {
        if (!executionId || !aggregationNodeId) return;
        this.lastAggregationByExecution.set(String(executionId), String(aggregationNodeId));
    }

    getLastAggregation(executionId?: string): string | undefined {
        if (!executionId) return undefined;
        return this.lastAggregationByExecution.get(String(executionId));
    }



    clear(): void {
        this.lastAggregationByExecution.clear();
        this.lastUserMessageByExecution.clear();
        this.agentNodeByExecution.clear();
        this.toolCallContextById.clear();
        this.agentNodeByRoot.clear();
        this.toolCallCountByMainExecution.clear();
        this.toolResponsesByThinking.clear();
        this.expectedBranchesByGroupPath.clear();
        this.collectedBranchesByGroupPath.clear();
        this.toolResponseIdsByGroupPath.clear();
        // no pending queues under no-fallback policy
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

    // === Tool response collection by thinking ===
    addToolResponseForThinking(thinkingNodeId?: string, responseNodeId?: string): void {
        if (!thinkingNodeId || !responseNodeId) return;
        const key = String(thinkingNodeId);
        const set = this.toolResponsesByThinking.get(key) || new Set<string>();
        set.add(String(responseNodeId));
        this.toolResponsesByThinking.set(key, set);
    }

    getToolResponsesForThinking(thinkingNodeId?: string): string[] {
        if (!thinkingNodeId) return [];
        return Array.from(this.toolResponsesByThinking.get(String(thinkingNodeId)) || []);
    }

    clearToolResponsesForThinking(thinkingNodeId?: string): void {
        if (!thinkingNodeId) return;
        this.toolResponsesByThinking.delete(String(thinkingNodeId));
    }

    // === Path-Only Join Barrier API ===
    addExpectedBranch(groupPath?: string, branchPath?: string): void {
        if (!groupPath || !branchPath) return;
        const key = String(groupPath);
        const set = this.expectedBranchesByGroupPath.get(key) || new Set<string>();
        set.add(String(branchPath));
        this.expectedBranchesByGroupPath.set(key, set);
    }

    addCollectedBranch(groupPath?: string, branchPath?: string): void {
        if (!groupPath || !branchPath) return;
        const key = String(groupPath);
        const set = this.collectedBranchesByGroupPath.get(key) || new Set<string>();
        set.add(String(branchPath));
        this.collectedBranchesByGroupPath.set(key, set);
    }

    addToolResponseForGroup(groupPath?: string, toolResponseNodeId?: string): void {
        if (!groupPath || !toolResponseNodeId) return;
        const key = String(groupPath);
        const arr = this.toolResponseIdsByGroupPath.get(key) || [];
        arr.push(String(toolResponseNodeId));
        this.toolResponseIdsByGroupPath.set(key, arr);
    }

    getToolResponsesForGroup(groupPath?: string): string[] {
        if (!groupPath) return [];
        return [...(this.toolResponseIdsByGroupPath.get(String(groupPath)) || [])];
    }

    isGroupJoinReady(groupPath?: string): boolean {
        if (!groupPath) return false;
        const key = String(groupPath);
        const expected = this.expectedBranchesByGroupPath.get(key) || new Set<string>();
        const collected = this.collectedBranchesByGroupPath.get(key) || new Set<string>();
        return expected.size > 0 && expected.size === collected.size;
    }

    clearGroup(groupPath?: string): void {
        if (!groupPath) return;
        const key = String(groupPath);
        this.expectedBranchesByGroupPath.delete(key);
        this.collectedBranchesByGroupPath.delete(key);
        this.toolResponseIdsByGroupPath.delete(key);
    }


}

export const WorkflowState = new WorkflowStateStore();


