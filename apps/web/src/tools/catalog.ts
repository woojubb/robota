import type { FunctionTool } from '@robota-sdk/agents';
import { ASSIGN_TASK_META, type PlaygroundToolMeta } from './assign-task/index';
import { createAssignTaskDummyTool } from '@robota-sdk/team';

// Static tool catalog (UI-only metadata)
export function getPlaygroundToolCatalog(): PlaygroundToolMeta[] {
    return [ASSIGN_TASK_META];
}

// Static tool registry (id -> factory)
export const ToolRegistry: Record<string, () => FunctionTool> = {
    // Route assignTask to team dummy tool to match example behavior (no agent creation)
    assignTask: createAssignTaskDummyTool
};


