/**
 * Workflow History Types
 * 
 * This module defines types for workflow history tracking and formatting.
 */

/**
 * Tool call structure for workflow messages
 */
export interface WorkflowToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * Message interface for workflow tracking
 */
export interface WorkflowMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content?: string;
    timestamp?: string | Date;
    toolCallId?: string;
    toolCalls?: WorkflowToolCall[];
}

/**
 * Agent conversation data
 */
export interface AgentConversationData {
    agentId: string;
    parentAgentId?: string;
    taskDescription?: string;
    agentTemplate?: string;
    aiProvider?: string;
    aiModel?: string;
    createdAt: Date;
    messages: WorkflowMessage[];
}

/**
 * Workflow history structure
 */
export interface WorkflowHistory {
    executionId: string;
    userRequest: string;
    startTime: Date;
    endTime?: Date;
    success: boolean;
    error?: string;
    finalResult: string;
    agentConversations: AgentConversationData[];
}

/**
 * Agent tree node for visualization
 */
export interface AgentTreeNode {
    agentId: string;
    taskDescription?: string;
    messageCount: number;
    children: AgentTreeNode[];
}

/**
 * Performance metrics
 */
export interface WorkflowPerformanceMetrics {
    executionId: string;
    totalAgents: number;
    coordinators: number;
    taskAgents: number;
    totalMessages: number;
    executionTimeMs: number | null;
    success: boolean;
    error?: string;
    userRequest: string;
    startTime: Date;
    endTime?: Date;
} 