// Main classes
export { TeamContainer } from './team-container';

// Convenience functions
export { createTeam } from './create-team';

// Types and interfaces
export type {
    TeamOptions,
    TeamContainerOptions,
    AgentConfig,
    TaskAgentConfig
} from './types';

// Internal types (not exported publicly)
// AssignTaskParams, AssignTaskResult are for internal use only 

// AssignTask tool implementation
export { createAssignTaskTool } from './assign-task/index';
export type { AssignTaskConfig, AssignTaskParams, AssignTaskResult } from './assign-task/index';

// Tool description utilities (for consistent descriptions across environments)
export { createToolDescription } from './task-assignment/tool-factory';
export type { TemplateInfo } from './types';