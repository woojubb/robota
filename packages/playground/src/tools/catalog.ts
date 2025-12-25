import type { IEventService, ToolInterface } from '@robota-sdk/agents';
import { createAssignTaskRelayTool } from '@robota-sdk/team';
import { CURRENT_TIME_META, createCurrentTimeTool } from './current-time/index';
import type { IPlaygroundToolMeta } from './types';

export type { IPlaygroundToolMeta } from './types';

const ASSIGN_TASK_META: IPlaygroundToolMeta = {
    id: 'assignTask',
    name: 'AssignTask',
    type: 'builtin',
    description: 'Assign a task to a specialist agent using a selected template',
    tags: ['task', 'delegation', 'agent', 'specialist']
};

// Static tool catalog (UI-only metadata)
export function getPlaygroundToolCatalog(): IPlaygroundToolMeta[] {
    return [
        ASSIGN_TASK_META,
        CURRENT_TIME_META
    ];
}

// Static tool registry (id -> factory with eventService injection)
export const ToolRegistry: Record<string, (eventService: IEventService) => ToolInterface> = {
    assignTask: (eventService: IEventService) => createAssignTaskRelayTool(eventService),
    'current-time': (_eventService: IEventService) => createCurrentTimeTool()
};


