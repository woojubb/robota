// Main classes
export { TeamContainer } from './team-container';
export { AgentFactory } from './agent-factory';

// Convenience functions
export { createTeam } from './create-team';

// Types and interfaces
export type {
    TeamContainerOptions,
    AgentConfig,
    DelegateWorkParams,
    DelegateWorkResult,
    TaskAgentConfig,
    TeamStats
} from './types';

export type { TaskAgent } from './agent-factory'; 