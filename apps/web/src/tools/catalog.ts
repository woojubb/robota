import type { FunctionTool } from '@robota-sdk/agents';
import { ASSIGN_TASK_META, createAssignTaskTool, type PlaygroundToolMeta } from './assign-task/index';

// Static tool catalog (UI-only metadata)
export function getPlaygroundToolCatalog(): PlaygroundToolMeta[] {
    return [ASSIGN_TASK_META];
}

// Static tool registry (id -> factory)
export const ToolRegistry: Record<string, () => FunctionTool> = {
    // Use the shared assignTask implementation from team package
    assignTask: createAssignTaskTool
};


