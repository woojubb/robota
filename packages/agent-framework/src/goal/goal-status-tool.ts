/**
 * GOAL-001: the structured completion-signal tool.
 *
 * While an autonomous goal is active the agent reports its assessment by calling
 * `report_goal_status({ status, reason })`. The {@link GoalController} reads this call
 * deterministically from the completed turn's tool summaries — no fragile prose parsing. The
 * tool itself is stateless: it validates the arguments and acknowledges; the loop decision is
 * owned by the controller.
 */

import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

import type { IToolWithEventService } from '@robota-sdk/agent-core';

/** Tool name the agent calls to report goal status. Vendor-neutral, generic. */
export const GOAL_SIGNAL_TOOL_NAME = 'report_goal_status';

const goalStatusSchema = z.object({
  status: z
    .enum(['continue', 'satisfied'])
    .describe('"satisfied" when the assigned goal is fully achieved; otherwise "continue".'),
  reason: z
    .string()
    .describe('A short justification for the status — what was achieved or what remains.'),
});

/**
 * Create the goal completion-signal tool. Included in the session tool set only when goal
 * pursuit is enabled (interactive sessions). The agent must call it only while pursuing an
 * assigned goal; outside a goal it is a harmless no-op acknowledgement.
 */
export function createGoalStatusTool(): IToolWithEventService {
  return createZodFunctionTool(
    GOAL_SIGNAL_TOOL_NAME,
    'Report progress toward the currently assigned autonomous goal. Call this only when you have ' +
      'an assigned goal: use status "satisfied" once it is fully achieved, or "continue" with the ' +
      'remaining work. Do not call it when no goal has been assigned.',
    goalStatusSchema,
    async (parameters) => {
      const status = parameters['status'] === 'satisfied' ? 'satisfied' : 'continue';
      return { acknowledged: true, status };
    },
  ) as unknown as IToolWithEventService;
}
