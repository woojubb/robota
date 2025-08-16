import { createFunctionTool, type FunctionTool } from '@robota-sdk/agents';

// Dummy assignTask for example-driven verification (no agent creation)
export function createAssignTaskDummyTool(): FunctionTool {
  const parameters = {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'Task content to assign' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Optional priority' }
    },
    required: ['task']
  } as const;

  const executor = async (params: { task: string; priority?: 'low' | 'medium' | 'high' }) => {
    return JSON.stringify({ assigned: true, note: 'dummy-from-team', params });
  };

  return createFunctionTool(
    'assignTask',
    'Assign a task to another agent (dummy, no agent creation)',
    parameters as any,
    executor as any
  );
}


