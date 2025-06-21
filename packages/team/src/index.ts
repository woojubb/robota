// Main classes
export { TeamContainer } from './team-container';
export { AgentFactory } from './agent-factory';

// Convenience functions
export { createTeam } from './create-team';

// Workflow formatting utilities
export {
    generateWorkflowFlowchart,
    generateAgentRelationshipDiagram,
    workflowHistoryToJSON,
    workflowHistoryToCSV,
    extractPerformanceMetrics,
    getAgentConversation,
    getAllMessagesChronologically
} from './workflow-formatter';

// Types and interfaces
export type {
    TeamContainerOptions,
    AgentConfig,
    AssignTaskParams,
    AssignTaskResult,
    TaskAgentConfig,
    TeamStats,
    TeamExecutionStructure,
    AgentNode
} from './types';

export type { TaskAgent } from './agent-factory';

// Workflow history types (now part of TeamContainer)
export type {
    WorkflowHistory,
    AgentConversationData,
    AgentTreeNode
} from './team-container'; 