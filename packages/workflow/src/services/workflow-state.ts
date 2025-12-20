// Workflow shared in-memory state (domain-neutral, path-only compliant)
// Minimal read-only indices only: do NOT store barrier/queue/guess state.

class WorkflowStateStore {
    // Map executionId → last user_message nodeId
    private lastUserMessageByExecution = new Map<string, string>();
    // Map executionId → agent node id
    private agentNodeByExecution = new Map<string, string>();
    // Map rootExecutionId or conversationId → agent node id
    private agentNodeByRoot = new Map<string, string>();
    clear(): void {
        this.lastUserMessageByExecution.clear();
        this.agentNodeByExecution.clear();
        this.agentNodeByRoot.clear();
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
}

export const WorkflowState = new WorkflowStateStore();


