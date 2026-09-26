/** Provider-neutral, per-turn decision signal for self-paced session loops. */

import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';

import '../tools/tool-permission-profiles.js';

import type { TSelfPacedLoopDecision } from './session-loop-transitions.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { IToolSummary } from '@robota-sdk/agent-interface-session';

export const LOOP_DECISION_TOOL_NAME = 'report_loop_decision';

const schema = z
  .object({
    action: z.enum(['continue', 'stop']),
    delaySeconds: z.number().int().min(60).max(3600).optional(),
    reason: z.string().min(1).max(280).optional(),
  })
  .strict();

export function createSessionLoopDecisionTool(): IToolWithEventService {
  return createZodFunctionTool(
    LOOP_DECISION_TOOL_NAME,
    'Only during a self-paced /loop iteration: stop this loop, or choose the next delay in seconds ' +
      '(60–3600) and give a short reason. This decision applies only to the current loop turn; ' +
      'there is no loop ID argument. A continue decision is committed after this turn completes.',
    schema,
    async (parameters) => {
      if (parameters['action'] === 'continue') {
        if (parameters['delaySeconds'] === undefined || !parameters['reason']?.trim()) {
          throw new Error('Continuing a loop requires a delay and reason.');
        }
      }
      return { acknowledged: true, action: parameters['action'] };
    },
  ) as unknown as IToolWithEventService;
}

/** Parse only the last call in this turn; a malformed last call consumes the fallback allowance. */
export function extractSelfPacedLoopDecision(
  toolSummaries: readonly IToolSummary[],
  toolExecutions: readonly { name: string; args: unknown; success: boolean }[],
): TSelfPacedLoopDecision | null {
  for (let index = toolSummaries.length - 1; index >= 0; index--) {
    const summary = toolSummaries[index];
    if (summary?.name !== LOOP_DECISION_TOOL_NAME) continue;
    let value: unknown;
    try {
      value = JSON.parse(summary.args) as unknown;
    } catch {
      return null;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const matching = toolExecutions.filter((execution) => execution.name === LOOP_DECISION_TOOL_NAME);
    if (matching.length !== 1 || !matching[0]?.success || !isDeepStrictEqual(matching[0].args, value)) {
      return null;
    }
    const args = value as Record<string, unknown>;
    if (args['action'] === 'stop' && Object.keys(args).length === 1) {
      return { action: 'stop' };
    }
    if (
      args['action'] === 'continue' &&
      Object.keys(args).length === 3 &&
      Number.isSafeInteger(args['delaySeconds']) &&
      typeof args['delaySeconds'] === 'number' &&
      args['delaySeconds'] >= 60 &&
      args['delaySeconds'] <= 3600 &&
      typeof args['reason'] === 'string' &&
      args['reason'].trim().length > 0 &&
      args['reason'].length <= 280
    ) {
      return {
        action: 'continue',
        delaySeconds: args['delaySeconds'],
        reason: args['reason'].trim(),
      };
    }
    return null;
  }
  return null;
}
