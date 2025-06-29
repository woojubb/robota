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