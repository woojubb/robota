/** The goal tools: the agent sets up, lists and steers goals the person asked it to keep working on. */
import { registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

import { GoalRefusedError } from './goal-book.js';

import type { FunctionTool, TUniversalValue } from '@robota-sdk/agent-core';
import type { GoalBook } from './goal-book.js';
import type { IGoal } from './types.js';

export const GOAL_TOOL_NAMES = {
  create: 'GoalCreate',
  list: 'GoalList',
  update: 'GoalUpdate',
} as const;

/** Declared on every build: registration merges, and a host that cleared the registry gets them back. */
function registerProfiles(): void {
  registerToolPermissionProfile(GOAL_TOOL_NAMES.list, { riskClass: 'inspect' });
  registerToolPermissionProfile(GOAL_TOOL_NAMES.create, { riskClass: 'modify' });
  registerToolPermissionProfile(GOAL_TOOL_NAMES.update, { riskClass: 'modify' });
}

export function renderGoal(goal: IGoal): string {
  const schedule = goal.everyMinutes === undefined ? 'once' : `every ${goal.everyMinutes} min`;
  const next = goal.nextRunAt === undefined ? '' : `, next ${goal.nextRunAt}`;
  return `- ${goal.title} [${goal.id}] (${goal.status}, ${schedule}${goal.readOnly ? ', read-only' : ''}${next})`;
}

async function guarded(run: () => Promise<TUniversalValue>): Promise<TUniversalValue> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GoalRefusedError) return { error: error.message };
    throw error;
  }
}

export function createGoalTools(book: GoalBook): FunctionTool[] {
  registerProfiles();
  return [
    createZodFunctionTool(
      GOAL_TOOL_NAMES.create,
      'Set up a goal you keep working on in the background, once or on a schedule, while the person is away. Only when the person asks for something ongoing or later. Results and anything needing their approval go to their feed.',
      z.object({
        title: z.string().min(1),
        instructions: z.string().min(1),
        everyMinutes: z.number().int().min(1).optional(),
        readOnly: z.boolean().optional(),
      }),
      async (input) =>
        guarded(async () => {
          const goal = await book.create({
            title: input.title,
            instructions: input.instructions,
            ...(input.everyMinutes !== undefined && { everyMinutes: input.everyMinutes }),
            ...(input.readOnly !== undefined && { readOnly: input.readOnly }),
          });
          return { created: goal.id, status: goal.status };
        }),
    ),
    createZodFunctionTool(
      GOAL_TOOL_NAMES.list,
      'List the goals you keep working on, with their status and schedule.',
      z.object({}),
      async () =>
        guarded(async () => {
          const goals = await book.list();
          return goals.length === 0 ? 'No goals.' : goals.map(renderGoal).join('\n');
        }),
    ),
    createZodFunctionTool(
      GOAL_TOOL_NAMES.update,
      'Pause, resume, run now or stop one of your goals, when the person asks.',
      z.object({ id: z.string().min(1), action: z.enum(['pause', 'resume', 'run-now', 'stop']) }),
      async ({ id, action }) =>
        guarded(async () => {
          if (action === 'stop') {
            await book.remove(id);
            return { stopped: id };
          }
          const goal = action === 'pause' ? await book.pause(id) : await book.resume(id);
          return { id: goal.id, status: goal.status };
        }),
    ),
  ];
}

export const GOAL_INSTRUCTIONS = [
  'You can keep working on goals in the background (GoalCreate, GoalList, GoalUpdate) when the person asks for something ongoing or for later.',
  "A goal run reports its result to the person's feed; actions that need their approval wait there until they answer.",
].join('\n');

/** What a goal run's session is told, on top of the agent's usual instructions. */
export function goalRunInstructions(goal: IGoal): string {
  return [
    `You are working in the background on the goal "${goal.title}". The person is not watching.`,
    goal.readOnly ? 'This goal is read-only: look things up, change nothing.' : '',
    'Do the work, then end with a short report for the person: what you found or did, and what is waiting for their approval.',
    'Anything that needs their approval waits for them; do not ask questions you cannot get answered now.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
