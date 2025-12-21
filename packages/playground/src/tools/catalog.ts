import type { EventService, FunctionTool } from '@robota-sdk/agents';
import { createAssignTaskRelayTool } from '@robota-sdk/team';
import { CURRENT_TIME_META, createCurrentTimeTool } from './current-time/index';

export interface PlaygroundToolMeta {
    id: string;
    name: string;
    type?: 'builtin' | 'mcp' | 'openapi' | 'zod';
    description?: string;
    category?: string;
    tags?: string[];
    parametersSummary?: Array<{ name: string; type: string; required?: boolean; description?: string }>;
}

const ASSIGN_TASK_META: PlaygroundToolMeta = {
    id: 'assignTask',
    name: 'AssignTask',
    type: 'builtin',
    description: 'Assign a task to a specialist agent using a selected template',
    tags: ['task', 'delegation', 'agent', 'specialist']
};

// Static tool catalog (UI-only metadata)
export function getPlaygroundToolCatalog(): PlaygroundToolMeta[] {
    return [
        ASSIGN_TASK_META,
        CURRENT_TIME_META
    ];
}

// Static tool registry (id -> factory with eventService injection)
export const ToolRegistry: Record<string, (eventService: EventService) => FunctionTool> = {
    assignTask: (eventService: EventService) => createAssignTaskRelayTool(eventService),
    'current-time': (_eventService: EventService) => createCurrentTimeTool()
};


