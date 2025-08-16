import { z } from 'zod';
import { createZodFunctionTool, type FunctionTool } from '@robota-sdk/agents';

// Local meta definition for the playground tool catalog
export interface PlaygroundToolMeta {
    id: string;
    name: string;
    type?: 'builtin' | 'mcp' | 'openapi' | 'zod';
    description?: string;
    tags?: string[];
    parametersSummary?: Array<{ name: string; type: string; required?: boolean; description?: string }>;
}

export const ASSIGN_TASK_META: PlaygroundToolMeta = {
    id: 'assignTask',
    name: 'AssignTask',
    type: 'builtin',
    description: 'Delegate a task to another agent (demo-dummy implementation in web sandbox).',
    tags: ['task', 'team', 'demo'],
    parametersSummary: [
        { name: 'task', type: 'string', required: true, description: 'Task content to assign' },
        { name: 'priority', type: "'low'|'medium'|'high'", required: false, description: 'Optional priority' }
    ]
};

// Zod schema aligned with team assignTask semantics (kept minimal for demo)
export const assignTaskSchema = z.object({
    task: z.string().describe('Task content to assign'),
    priority: z.enum(['low', 'medium', 'high']).optional()
});

// Dummy executor — returns demo data. Real implementation is deferred by design.
async function executeAssignTaskDummy(params: z.infer<typeof assignTaskSchema>) {
    return { data: { assigned: true, note: 'demo-dummy', params } };
}

export function createAssignTaskTool(): FunctionTool {
    return createZodFunctionTool(
        'assignTask',
        'Assign a task to another agent',
        assignTaskSchema,
        executeAssignTaskDummy
    );
}


